import {hash, type Data} from "./types";
import type {Store} from "./runtime";
import {installedModules} from "./modules";

export interface Reference {
  id: string;
  account?: string;
  kind: string;
  raw: string;
  scope: string;
  index: string;
  device?: string;
  path?: string;
  source?: string;
  locator?: Data;
}

const baseKinds:Record<string,string>={computer:'c',workspace:'s',operation:'o'};
const baseIdentityFields=['id','ids','session','session_id','device_id','operation'];
const originalFields = new Set(["text", "content", "body", "diff", "patch", "command", "feedback", "comment"]);
const moduleFile = (path:string) => installedModules.some(module=>module.ownsFile(path));

function kind(value: string): string | undefined {
  const match = /^(.+)_([0-9a-f]{32})$/.exec(value);
  return match ? {...baseKinds,...Object.assign({},...installedModules.map(m=>m.kinds))}[match[1]] : undefined;
}

/** Present file-operation metadata relative to its workspace, including existing agents. */
export function relativeFiles(value: Data, root: string): Data {
  const base = root.replaceAll("\\", "/").replace(/\/$/, "");
  const fold = (path: string) => /^[a-z]:/i.test(base) || base.startsWith("//") ? path.toLowerCase() : path;
  const relative = (path: string) => {
    const normalized = path.replaceAll("\\", "/");
    if (fold(normalized) === fold(base) || fold(normalized) === fold(base + "/")) return ".";
    return fold(normalized).startsWith(fold(base + "/")) ? normalized.slice(base.length + 1) : path;
  };
  const file = (entry: Data) => typeof entry.path === "string" ? {...entry, path: relative(entry.path)} : entry;
  const result = file(value);
  for (const key of ["entries", "matches"]) if (Array.isArray(result[key])) result[key] = result[key].map(file);
  return result;
}

/** Small routing references only; scientific text, commands and files never enter this store. */
export class References {
  constructor(private storage: Store) {}

  async assign(prefix: string, raw: string, scope = "", metadata: Data = {}): Promise<string> {
    const index = "reference-index:" + await hash(JSON.stringify([prefix, scope, raw]));
    return this.storage.transaction(async tx => {
      const existing = await tx.get<string>(index);
      if (existing) return existing;
      const number = (await tx.get<number>("sequence:" + prefix) || 0) + 1;
      const id = prefix + number;
      await tx.put({[index]: id, ["sequence:" + prefix]: number,
        ["reference:" + id]: {id, kind: prefix, raw, scope, index, ...metadata}});
      return id;
    });
  }

  async get(id: string): Promise<Reference | undefined> {
    return this.storage.get<Reference>("reference:" + id);
  }

  async raw(value: string, scope?: string): Promise<string> {
    if (!/^[a-z][1-9][0-9]*$/.test(value)) return value;
    const ref = await this.get(value);
    if (!ref || scope !== undefined && ref.scope !== scope) {
      throw new Error("短编号不属于当前电脑或工作目录：" + value);
    }
    return ref.raw;
  }

  async forget(id: string): Promise<void> {
    const ref = await this.get(id);
    if (ref) await this.storage.delete(["reference:" + id, ref.index]);
  }

  async input(value: any, scope: string, field = ""): Promise<any> {
    if (typeof value === "string") return new Set([...baseIdentityFields,...installedModules.flatMap(m=>m.identityFields)]).has(field) ? this.raw(value, scope) : value;
    if (Array.isArray(value)) return Promise.all(value.map(item => this.input(item, scope, field)));
    if (!value || typeof value !== "object") return value;
    const result: Data = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = originalFields.has(key) ? child : await this.input(child, scope, key);
    }
    return result;
  }

  async output(value: any, scope: string, field = "", owner?: string): Promise<any> {
    if (typeof value === "string") {
      const prefix = new Set([...baseIdentityFields,...installedModules.flatMap(m=>m.identityFields)]).has(field) ? kind(value) : undefined;
      return prefix ? this.assign(prefix, value, prefix === "c" || prefix === "s" ? "" : scope) : value;
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => this.output(item, scope, field, owner)));
    if (!value || typeof value !== "object") return value;
    const result: Data = {};
    for (const [key, child] of Object.entries(value)) {
      if ((key === "stdout_path" || key === "stderr_path" || key === 'raw_path' || key === 'content_path' ||
           key === "path" && typeof child === "string" && moduleFile(child)) &&
          typeof child === "string") {
        const ref = await this.assign("f", child, scope);
        result[key === "path" ? "file_ref" : key.replace("_path", "")] = ref;
        // Command outputs are reclaimed with their operation. Work Tree material copies have their own lifetime.
        if (owner && !moduleFile(child)) {
          await this.storage.put("owned:" + owner + ":" + ref, ref);
        }
      } else result[key] = originalFields.has(key) ? child : await this.output(child, scope, key, owner);
    }
    return result;
  }

  async release(operation: string): Promise<void> {
    const children = await this.storage.list<string>({prefix: "owned:" + operation + ":"});
    for (const [key, id] of children) {
      await this.forget(id);
      await this.storage.delete(key);
    }
    await this.forget(operation);
  }
}
