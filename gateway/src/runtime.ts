/** The shared service needs key/value transactions and live device sockets, not a hosting platform. */
export interface KeyStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  put<T = unknown>(entries: Record<string, T>): Promise<void>;
  delete(key: string | string[]): Promise<unknown>;
  list<T = unknown>(options: {prefix: string}): Promise<Map<string, T>>;
}

export interface Store extends KeyStore {
  transaction<T>(body: (transaction: KeyStore) => Promise<T>): Promise<T>;
  setAlarm(time: number): Promise<void>;
}

export interface DeviceSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface HubContext {
  storage: Store;
  waitUntil?(work:Promise<unknown>):void;
  acceptWebSocket(socket: DeviceSocket, tags: string[]): void;
  /** Currently OPEN sockets only; closing sockets do not represent an online computer. */
  getWebSockets(tag: string): DeviceSocket[];
  equal(a: Uint8Array, b: Uint8Array): boolean;
}

export interface ServiceEnv {
  PUBLIC_URL: string;
  BRIDGE_SECRET: string;
  GITHUB_RELEASE_TOKEN?:string;
  RUNTIME?:'node'|'cloudflare';
  updateServer?(request:Record<string,any>):Promise<Record<string,any>>;
}

export interface ApplicationEnv extends ServiceEnv {
  OAUTH_KV: KVNamespace;
  service(request: Request): Promise<Response>;
}
