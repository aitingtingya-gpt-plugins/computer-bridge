import {DatabaseSync} from "node:sqlite";
import type {KeyStore, Store} from "../runtime";

interface Row {key: string; value: string; expires: number | null; metadata: string | null}

/** One ordinary SQLite file; only authentication and routing metadata are stored here. */
export class Database {
  readonly sql: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  private sweep: NodeJS.Timeout;
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS kv(namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        expires INTEGER, metadata TEXT, PRIMARY KEY(namespace,key));
      CREATE INDEX IF NOT EXISTS kv_expiration ON kv(expires) WHERE expires IS NOT NULL;`);
    this.sweep = setInterval(() => {void this.run(() => this.sql.prepare(
      "DELETE FROM kv WHERE expires IS NOT NULL AND expires <= ?").run(Math.floor(Date.now()/1000)));}, 60_000);
    this.sweep.unref();
  }
  run<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
  read(namespace: string, key: string): Row | undefined {
    const row = this.sql.prepare("SELECT key,value,expires,metadata FROM kv WHERE namespace=? AND key=?").get(namespace,key) as Row | undefined;
    return row && (row.expires === null || row.expires > Date.now()/1000) ? row : undefined;
  }
  write(namespace: string, key: string, value: string, expires: number | null = null, metadata: unknown = null): void {
    this.sql.prepare("INSERT OR REPLACE INTO kv(namespace,key,value,expires,metadata) VALUES(?,?,?,?,?)")
      .run(namespace,key,value,expires,metadata === null ? null : JSON.stringify(metadata));
  }
  rows(namespace: string, prefix: string, cursor = "", limit = -1): Row[] {
    return this.sql.prepare(`SELECT key,value,expires,metadata FROM kv WHERE namespace=? AND key>=? AND key<?
      AND key>? AND (expires IS NULL OR expires>?) ORDER BY key LIMIT ?`)
      .all(namespace,prefix,prefix+"\uffff",cursor,Math.floor(Date.now()/1000),limit) as unknown as Row[];
  }
  async close(): Promise<void> {clearInterval(this.sweep);await this.tail;this.sql.close();}
}

class DirectStore implements KeyStore {
  constructor(protected db: Database, protected namespace: string) {}
  async get<T>(key: string): Promise<T | undefined> {
    const row = this.db.read(this.namespace,key);
    return row ? JSON.parse(row.value) as T : undefined;
  }
  async put<T>(key: string | Record<string,T>, value?: T): Promise<void> {
    const entries: [string,T | undefined][] = typeof key === "string" ? [[key,value]] : Object.entries(key);
    for (const [name,item] of entries) {
      this.db.write(this.namespace,name,JSON.stringify(item));
    }
  }
  async delete(key: string | string[]): Promise<number> {
    let removed = 0;
    for (const item of typeof key === "string" ? [key] : key) removed += Number(this.db.sql.prepare(
      "DELETE FROM kv WHERE namespace=? AND key=?").run(this.namespace,item).changes);
    return removed;
  }
  async list<T>({prefix}: {prefix: string}): Promise<Map<string,T>> {
    return new Map(this.db.rows(this.namespace,prefix).map(row => [row.key,JSON.parse(row.value) as T]));
  }
}

export class SQLiteStore implements Store {
  private direct: DirectStore;
  private alarm?: NodeJS.Timeout;
  onAlarm: () => Promise<void> = async () => {};
  constructor(private db: Database) {this.direct = new DirectStore(db,"hub");}
  get<T>(key: string) {return this.db.run(() => this.direct.get<T>(key));}
  put<T>(key: string | Record<string,T>, value?: T) {return this.db.run(() => this.direct.put(key,value));}
  delete(key: string | string[]) {return this.db.run(() => this.direct.delete(key));}
  list<T>(options: {prefix: string}) {return this.db.run(() => this.direct.list<T>(options));}
  transaction<T>(body: (transaction: KeyStore) => Promise<T>): Promise<T> {
    return this.db.run(async () => {
      this.db.sql.exec("BEGIN IMMEDIATE");
      try {const result = await body(this.direct);this.db.sql.exec("COMMIT");return result;}
      catch (error) {this.db.sql.exec("ROLLBACK");throw error;}
    });
  }
  async setAlarm(time: number): Promise<void> {
    await this.put("runtime:alarm",time);
    this.schedule(time);
  }
  private schedule(time: number): void {
    clearTimeout(this.alarm);
    this.alarm = setTimeout(() => {void this.onAlarm().then(() => this.delete("runtime:alarm")).catch(console.error);},Math.max(0,time-Date.now()));
    this.alarm.unref();
  }
  async restoreAlarm(): Promise<void> {const time = await this.get<number>("runtime:alarm");if (time) this.schedule(time);}
  close(): void {clearTimeout(this.alarm);}
}

/** The OAuth library's KV contract, backed by the same database in a separate namespace. */
export class OAuthKV {
  constructor(private db: Database) {}
  get(key: string, options?: {type?: string} | string): Promise<unknown> {
    return this.db.run(() => {
      const row = this.db.read("oauth",key);
      if (!row) return null;
      return (typeof options === "string" ? options : options?.type) === "json" ? JSON.parse(row.value) : row.value;
    });
  }
  put(key: string, value: string, options: {expiration?: number;expirationTtl?: number;metadata?: unknown} = {}): Promise<void> {
    return this.db.run(() => this.db.write("oauth",key,value,
      options.expiration ?? (options.expirationTtl ? Math.floor(Date.now()/1000)+options.expirationTtl : null),options.metadata ?? null));
  }
  delete(key: string): Promise<void> {
    return this.db.run(() => {this.db.sql.prepare("DELETE FROM kv WHERE namespace='oauth' AND key=?").run(key);});
  }
  list(options: {prefix?: string;cursor?: string;limit?: number} = {}) {
    return this.db.run(() => {
      const limit = options.limit ?? 1000;
      const rows = this.db.rows("oauth",options.prefix || "",options.cursor || "",limit+1);
      const page = rows.slice(0,limit);
      return {keys: page.map(row => ({name:row.key,...(row.expires === null ? {} : {expiration:row.expires}),
        ...(row.metadata === null ? {} : {metadata:JSON.parse(row.metadata)})})),
        list_complete: rows.length <= limit, cursor: rows.length > limit ? page[page.length-1].key : ""};
    });
  }
}
