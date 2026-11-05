/** Human chat access is either a current account grant or this registered computer. */
import type {Accounts, Actor} from './accounts';
import type {KeyStore} from './runtime';
import {hash, type Data} from './types';

export type ChatIdentity = {kind:'account';actor:Actor} | {kind:'device';device:string;key_hash:string};
export type ChatPrincipal = Actor | ChatIdentity;
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});

export function normalizeIdentity(value:ChatPrincipal):ChatIdentity {
  return 'kind' in value?value:{kind:'account',actor:value};
}
export function principalScope(value:ChatPrincipal):string {
  const identity=normalizeIdentity(value);
  return identity.kind==='account'?identity.actor.id:'device:'+identity.device;
}
export function modelActor(value:ChatPrincipal):Actor {
  const identity=normalizeIdentity(value);
  if(identity.kind!=='account')throw fail('model_connection_required','模型连接需要账号授权');
  return identity.actor;
}
export async function validateIdentity(accounts:Accounts,store:KeyStore,value:ChatPrincipal,tx?:KeyStore):Promise<void> {
  const identity=normalizeIdentity(value),storage=tx??store;
  if(identity.kind==='account') {
    if(!tx){await accounts.require(identity.actor.id,identity.actor.epoch);return;}
    const current=await storage.get<Data>('account:'+identity.actor.id);
    if(!current?.enabled||current.epoch!==identity.actor.epoch)throw fail('account_unavailable','账号已失效，请重新登录');
    return;
  }
  const device=await storage.get<Data>('device:'+identity.device);
  if(!device||device.key_hash!==identity.key_hash)throw fail('device_unauthorized','电脑注册凭据无效');
}
export async function authorizeIdentity(accounts:Accounts,store:KeyStore,value:ChatPrincipal,device:string,tx?:KeyStore):Promise<void> {
  const identity=normalizeIdentity(value);
  if(identity.kind==='account'){await accounts.assertAccessIn(tx??store,identity.actor,device);return;}
  await validateIdentity(accounts,store,identity,tx);
  if(identity.device!==device)throw fail('device_forbidden','本机身份只能访问本机对话');
}
export async function authenticateDeviceIdentity(store:KeyStore,device:string,credential:string):Promise<ChatIdentity> {
  const row=await store.get<Data>('device:'+device),key_hash=await hash(credential);
  if(!row||row.key_hash!==key_hash)throw fail('device_unauthorized','电脑注册凭据无效');
  return {kind:'device',device,key_hash};
}
