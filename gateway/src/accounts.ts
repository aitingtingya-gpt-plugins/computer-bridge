/** Account identities and shared-device grants. Neither is an operating-system identity. */
import type {KeyStore, Store} from './runtime';
import {hashPassword, matchesPassword, type PasswordRecord} from './password';
import {hash, opaque, type Data} from './types';

export interface Actor {
  id: string;
  username: string;
  role: 'admin' | 'user';
  epoch: number;
}

export interface AccountInfo extends Actor {
  enabled: boolean;
  created_at: string;
}

interface Account extends AccountInfo {password: PasswordRecord}
interface Grant {user: string; device: string}
export interface Credentials {id?: string; epoch?: number; legacy?: boolean}

const accountKey = (id: string) => 'account:' + id;
const nameKey = (username: string) => 'account-name:' + username.toLowerCase();
const grantKey = (user: string, device: string) => 'account-grant:' + user + ':' + device;
const failure = (code: string, message: string) => Object.assign(new Error(message), {code});
const actor = ({id, username, role, epoch}: AccountInfo): Actor => ({id, username, role, epoch});
const info = ({password: _, ...value}: Account): AccountInfo => value;

function usernameValue(value: string): string {
  const username = value.trim();
  if (!username) throw failure('invalid_username', '用户名不能为空');
  return username;
}

function passwordValue(value: string): string {
  if (Array.from(value).length < 6) throw failure('invalid_password', '密码至少需要 6 位');
  return value;
}

export class Accounts {
  constructor(private storage: Store, private initialSecret: string,
    private equal: (a: Uint8Array, b: Uint8Array) => boolean) {}

  /** The sole pre-account administrator keeps both their password and existing OAuth identity. */
  async ensure(): Promise<Actor> {
    return this.storage.transaction(async tx => {
      const existing = await tx.get<Account>(accountKey('u1'));
      if (existing) return actor(existing);
      const password = await tx.get<PasswordRecord>('auth:password') || await hashPassword(this.initialSecret);
      const admin: Account = {id: 'u1', username: 'admin', role: 'admin', epoch: 0,
        enabled: true, created_at: new Date().toISOString(), password};
      await tx.put({[accountKey(admin.id)]: admin, [nameKey(admin.username)]: admin.id, 'sequence:u': 1});
      return actor(admin);
    });
  }

  async login(username: string, password: string): Promise<Actor | null> {
    await this.ensure();
    const id = await this.storage.get<string>(nameKey(username.trim()));
    const value = id ? await this.storage.get<Account>(accountKey(id)) : undefined;
    if (!value?.enabled || !await matchesPassword(password, value.password, this.equal)) return null;
    // Password checks finish against the current identity, including concurrent rename/reset.
    return this.storage.transaction(async tx => {
      const current = await tx.get<Account>(accountKey(value.id));
      return current?.enabled && current.epoch === value.epoch &&
        nameKey(current.username) === nameKey(username.trim()) ? actor(current) : null;
    });
  }

  async authenticate(credentials: Credentials): Promise<Actor | null> {
    await this.ensure();
    const id = credentials.legacy ? 'u1' : credentials.id;
    const epoch = credentials.legacy ? 0 : credentials.epoch;
    if (!id || epoch === undefined) return null;
    const value = await this.storage.get<Account>(accountKey(id));
    return value?.enabled && value.epoch === epoch ? actor(value) : null;
  }

  async require(id: string, epoch?: number): Promise<Actor> {
    await this.ensure();
    const value = await this.storage.get<Account>(accountKey(id));
    if (!value?.enabled || epoch !== undefined && value.epoch !== epoch) {
      throw failure('account_unavailable', '账号已失效，请重新登录');
    }
    return actor(value);
  }

  async list(): Promise<AccountInfo[]> {
    await this.ensure();
    return [...(await this.storage.list<Account>({prefix: 'account:'})).values()]
      .map(info).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  }

  async create(username: string, password?: string): Promise<{user: Actor; initial_password: string}> {
    await this.ensure();
    const display = usernameValue(username);
    const initialPassword = password === undefined ?
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replaceAll('+', '-').replaceAll('/', '_') :
      passwordValue(password);
    const passwordRecord = await hashPassword(initialPassword);
    const user = await this.storage.transaction(async tx => {
      if (await tx.get(nameKey(display))) throw failure('username_taken', '该用户名已被使用');
      const number = (await tx.get<number>('sequence:u'))! + 1;
      const value: Account = {id: 'u' + number, username: display, role: 'user', epoch: 0,
        enabled: true, created_at: new Date().toISOString(), password: passwordRecord};
      await tx.put({[accountKey(value.id)]: value, [nameKey(display)]: value.id, 'sequence:u': number});
      return actor(value);
    });
    return {user, initial_password: initialPassword};
  }

  async update(id: string, changes: {username?: string; enabled?: boolean; password?: string}): Promise<Actor> {
    await this.ensure();
    const username = changes.username === undefined ? undefined : usernameValue(changes.username);
    const password = changes.password === undefined ? undefined : await hashPassword(passwordValue(changes.password));
    return this.storage.transaction(async tx => {
      const value = await tx.get<Account>(accountKey(id));
      if (!value) throw failure('account_missing', '账号不存在');
      if (value.role === 'admin' && changes.enabled === false) throw failure('admin_required', '不能停用管理员账号');
      if (username !== undefined) {
        const other = await tx.get<string>(nameKey(username));
        if (other && other !== id) throw failure('username_taken', '该用户名已被使用');
        await tx.delete(nameKey(value.username));
        value.username = username;
        await tx.put(nameKey(username), id);
      }
      if (password) value.password = password;
      const statusChanged = changes.enabled !== undefined && changes.enabled !== value.enabled;
      if (changes.enabled !== undefined) value.enabled = changes.enabled;
      if (password || statusChanged) value.epoch += 1;
      await tx.put(accountKey(id), value);
      return actor(value);
    });
  }

  async delete(id: string): Promise<void> {
    await this.ensure();
    await this.storage.transaction(async tx => {
      const value = await tx.get<Account>(accountKey(id));
      if (!value) throw failure('account_missing', '账号不存在');
      if (value.role === 'admin') throw failure('admin_required', '不能删除管理员账号');
      const keys = [...(await tx.list<Grant>({prefix: 'account-grant:' + id + ':'})).keys()];
      await tx.delete([accountKey(id), nameKey(value.username), ...keys]);
    });
  }

  async canAccess(identity: Actor, device: string): Promise<boolean> {
    await this.ensure();
    return this.storage.transaction(async tx => {
      const current = await tx.get<Account>(accountKey(identity.id));
      if (!current?.enabled || current.epoch !== identity.epoch) return false;
      return current.role === 'admin' || !!await tx.get(grantKey(current.id, device));
    });
  }

  async assertAccess(identity: Actor, device: string): Promise<void> {
    if (!await this.canAccess(identity, device)) throw failure('device_forbidden', '无权访问这台电脑');
  }

  private async grantUser(tx: KeyStore, id: string): Promise<Account> {
    const user = await tx.get<Account>(accountKey(id));
    if (!user || user.role !== 'user') throw failure('account_missing', '普通账号不存在');
    return user;
  }

  async grant(user: string, device: string): Promise<void> {
    await this.ensure();
    await this.storage.transaction(async tx => {
      await this.grantUser(tx, user);
      if (!await tx.get('device:' + device)) throw failure('device_missing', '电脑不存在');
      await tx.put(grantKey(user, device), {user, device} satisfies Grant);
    });
  }

  async revoke(user: string, device: string): Promise<void> {
    await this.ensure();
    await this.storage.transaction(async tx => {
      await this.grantUser(tx, user);
      await tx.delete(grantKey(user, device));
    });
  }

  /** Claiming a pairing code and granting its computer are one authorization transaction. */
  async approvePair(code: string, identity: Actor): Promise<{device_id: string; name: string}> {
    await this.ensure();
    const key = opaque();
    const keyHash = await hash(key);
    return this.storage.transaction(async tx => {
      const current = await tx.get<Account>(accountKey(identity.id));
      if (!current?.enabled || current.epoch !== identity.epoch) {
        throw failure('account_unavailable', '账号已失效，请重新登录');
      }
      const id = await tx.get<string>('code:' + code.toUpperCase());
      const record = id ? await tx.get<Data>('pair:' + id) : undefined;
      if (!record || record.expires_at < Date.now() / 1000) {
        throw failure('pair_expired', '配对码不存在或已经过期');
      }
      const previous = await tx.get<Data>('device:' + record.device_id);
      const permitted = current.role === 'admin' || !!await tx.get(grantKey(current.id, record.device_id));
      if (record.status === 'approved') {
        if (current.role !== 'admin' && ((record.approved_by || 'u1') !== current.id || !permitted)) {
          throw failure('device_forbidden', '这次配对已由其他账号批准');
        }
        if (!previous) throw failure('device_missing', '电脑已经注销');
        return {device_id: record.device_id, name: previous.display_name ?? record.name};
      }
      if (record.status !== 'pending') throw failure('pair_expired', '这次配对已结束');
      if (previous && !permitted) throw failure('device_forbidden', '无权重新注册这台电脑');
      await tx.put('device:' + record.device_id, {...previous, id: record.device_id,
        name: record.name, system: record.system, modules: previous?.modules || [],
        key_hash: keyHash, registered_at: Date.now(),
        access: previous?.access || {full_access: !!previous, workspaces: [], revision: 1}});
      if (current.role === 'user') {
        await tx.put(grantKey(current.id, record.device_id), {user: current.id, device: record.device_id} satisfies Grant);
      }
      await tx.put('pair:' + id, {...record, status: 'approved', device_key: key, approved_by: current.id});
      return {device_id: record.device_id, name: previous?.display_name ?? record.name};
    });
  }

  async grants(device: string): Promise<string[]> {
    await this.ensure();
    return [...(await this.storage.list<Grant>({prefix: 'account-grant:'})).values()]
      .filter(value => value.device === device).map(value => value.user)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  }

  async devices(identity: Actor): Promise<Set<string> | null> {
    await this.ensure();
    return this.storage.transaction(async tx => {
      const current = await tx.get<Account>(accountKey(identity.id));
      if (!current?.enabled || current.epoch !== identity.epoch) {
        throw failure('account_unavailable', '账号已失效，请重新登录');
      }
      if (current.role === 'admin') return null;
      const values = await tx.list<Grant>({prefix: 'account-grant:' + current.id + ':'});
      return new Set([...values.values()].map(value => value.device));
    });
  }
}
