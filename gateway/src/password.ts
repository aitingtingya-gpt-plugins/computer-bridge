/** Human administrator password. Device credentials and OAuth grants have separate lifecycles. */
import type {KeyStore} from "./runtime";
export interface PasswordRecord {
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  hash: string;
}

const bytes = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const base64 = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value)));

async function derive(password: string, salt: string, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations}, key, 256);
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
  const iterations = 100_000;
  return {algorithm: "PBKDF2-SHA256", iterations, salt, hash: base64(await derive(password, salt, iterations))};
}

export async function matchesPassword(password: string, record: PasswordRecord,
  equal: (a: Uint8Array, b: Uint8Array) => boolean): Promise<boolean> {
  return equal(new Uint8Array(await derive(password, record.salt, record.iterations)), bytes(record.hash));
}

export class AdminPassword {
  constructor(private storage: KeyStore, private initial: string,
    private equal: (a: Uint8Array, b: Uint8Array) => boolean) {}

  async matches(password: string): Promise<boolean> {
    const record = await this.storage.get<PasswordRecord>("auth:password");
    if (record) return matchesPassword(password, record, this.equal);
    const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return this.equal(new Uint8Array(await digest(password)), new Uint8Array(await digest(this.initial)));
  }

  async change(password: string): Promise<boolean> {
    if (Array.from(password).length < 6) return false;
    await this.storage.put<PasswordRecord>("auth:password", await hashPassword(password));
    return true;
  }
}
