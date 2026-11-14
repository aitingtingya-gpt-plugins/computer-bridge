/** Bounded plugin-channel failure evidence and retry classification. Never retain URLs, secrets, or payloads. */
import type {KeyStore} from '../runtime';
import {cfRay,requestId,type CallbackCategory} from './callback_diagnostics';

const extraCategories=['network_error','timeout','callback_address','gone_removed','unconfigured'] as const;
export type ChannelDiagnosticCategory=CallbackCategory|typeof extraCategories[number];
const allowedCategories=new Set<string>([
  'http_rejected','edge_challenge','signature_rejected','timestamp_rejected',
  'subscription_unavailable','authentication_rejected','permission_denied','rate_limited',
  ...extraCategories,
]);
const allowedPhases=new Set<string>(['verification','delivery','cleanup']);

export type ChannelAction='connect'|'disconnect'|'delete';

export interface ChannelDiagnostic {
  at:string;
  phase:'verification'|'delivery'|'cleanup';
  action?:ChannelAction;
  chat_id?:string;
  subscription_id?:string;
  status:number;
  category:ChannelDiagnosticCategory;
  request_id?:string;
  cf_ray?:string;
  attempt?:number;
  retry_scheduled?:boolean;
}

export interface ChannelCommandSummary {
  action:ChannelAction;
  chat_id:string;
  state:'notified'|'retrying'|'failed'|'unconfigured';
  active:number;
  delivered:number;
  failed:number;
  retrying:number;
  sequence:number;
  updated_at:string;
  last_error?:ChannelDiagnostic;
}

export const channelDiagnosticsKey=(account:string)=>'chat-channel-diagnostics:'+account;
export const channelCommandKey=(chat:string)=>'chat-channel-command:'+chat;
export const channelOutboxKey=(chat:string,subscription:string)=>'chat-channel-outbox:'+chat+':'+subscription;

const chatIdValid=(value:unknown):value is string=>typeof value==='string'&&/^t[1-9][0-9]*$/.test(value);
const subIdValid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const isChannelAction=(value:unknown):value is ChannelAction=>value==='connect'||value==='disconnect'||value==='delete';

export function sanitizeChannelDiagnostic(row:Partial<ChannelDiagnostic>|null|undefined):ChannelDiagnostic|undefined{
  if(!row||typeof row.at!=='string'||!allowedPhases.has(row.phase??'')||!allowedCategories.has(row.category??''))return undefined;
  const status=Number.isInteger(row.status)&&row.status!>=0&&row.status!<=999?row.status!:0;
  return {
    at:row.at,
    phase:row.phase as ChannelDiagnostic['phase'],
    ...(isChannelAction(row.action)?{action:row.action}:{}),
    ...(chatIdValid(row.chat_id)?{chat_id:row.chat_id}:{}),
    ...(subIdValid(row.subscription_id)?{subscription_id:row.subscription_id}:{}),
    status,
    category:row.category as ChannelDiagnosticCategory,
    ...(requestId(row.request_id)?{request_id:row.request_id}:{}),
    ...(cfRay(row.cf_ray)?{cf_ray:row.cf_ray}:{}),
    ...(Number.isSafeInteger(row.attempt)&&row.attempt!>=0?{attempt:row.attempt}:{}),
    ...(typeof row.retry_scheduled==='boolean'?{retry_scheduled:row.retry_scheduled}:{}),
  };
}

export function sanitizeChannelCommand(row:Partial<ChannelCommandSummary>|null|undefined):ChannelCommandSummary|undefined{
  if(!row||!isChannelAction(row.action)||!chatIdValid(row.chat_id))return undefined;
  if(!['notified','retrying','failed','unconfigured'].includes(row.state??''))return undefined;
  const error=sanitizeChannelDiagnostic(row.last_error);
  return {
    action:row.action,
    chat_id:row.chat_id,
    state:row.state as ChannelCommandSummary['state'],
    active:Number.isSafeInteger(row.active)&&row.active!>=0?row.active!:0,
    delivered:Number.isSafeInteger(row.delivered)&&row.delivered!>=0?row.delivered!:0,
    failed:Number.isSafeInteger(row.failed)&&row.failed!>=0?row.failed!:0,
    retrying:Number.isSafeInteger(row.retrying)&&row.retrying!>=0?row.retrying!:0,
    sequence:Number.isSafeInteger(row.sequence)&&row.sequence!>=0?row.sequence!:0,
    updated_at:typeof row.updated_at==='string'?row.updated_at:new Date(0).toISOString(),
    ...(error?{last_error:error}:{}),
  };
}

export function classifyChannelError(error:unknown):{status:number;category:ChannelDiagnosticCategory}{
  const name=(error as {name?:unknown}|null)?.name;
  const message=typeof (error as {message?:unknown}|null)?.message==='string'?(error as {message:string}).message:'';
  const code=(error as {code?:unknown}|null)?.code;
  if(name==='TimeoutError'||(name==='AbortError'&&/timeout/i.test(message)))return {status:0,category:'timeout'};
  if(code==='invalid_webhook_url'||/回调|DNS|重定向|公共地址/.test(message))return {status:0,category:'callback_address'};
  return {status:0,category:'network_error'};
}

export function isChannelRetryable(status:number,category:ChannelDiagnosticCategory):boolean{
  if(category==='gone_removed'||category==='callback_address'||category==='unconfigured')return false;
  if(category==='timeout'||category==='network_error'||category==='rate_limited')return true;
  if(status===408||status===429||status>=500)return true;
  if(status===403&&(category==='http_rejected'||category==='edge_challenge'))return true;
  return false;
}

export async function readChannelDiagnostics(tx:KeyStore,account:string,chatId?:string):Promise<ChannelDiagnostic[]>{
  const rows=await tx.get<ChannelDiagnostic[]>(channelDiagnosticsKey(account));
  const clean=(rows??[]).map(row=>sanitizeChannelDiagnostic(row)).filter((row):row is ChannelDiagnostic=>!!row);
  return (chatId?clean.filter(row=>row.chat_id===chatId):clean).slice(-12);
}

export async function recordChannelDiagnostic(tx:KeyStore,account:string,row:ChannelDiagnostic):Promise<void>{
  const clean=sanitizeChannelDiagnostic(row);
  if(!clean)return;
  const rows=await readChannelDiagnostics(tx,account);
  await tx.put(channelDiagnosticsKey(account),[...rows,clean].slice(-12));
}

export async function eraseChannelDiagnosticsForChat(tx:KeyStore,account:string,chatId:string):Promise<void>{
  const rows=await readChannelDiagnostics(tx,account);
  const kept=rows.filter(row=>row.chat_id!==chatId);
  if(kept.length===rows.length)return;
  if(kept.length)await tx.put(channelDiagnosticsKey(account),kept);
  else await tx.delete(channelDiagnosticsKey(account));
}
