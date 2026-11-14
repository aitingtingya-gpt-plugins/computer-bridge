/** Host-authored semantic memory. This store does not run a model or invent a summary. */
import type {KeyStore} from '../runtime';
import {hash} from '../types';
import {assertContextSafe} from './context_safety';

export const MAX_SUMMARY_TEXT_BYTES=32_000;
export interface SummaryWriter {account:string;epoch:number;caller:string}
export interface ChatSummary {
  id:string;revision:number;text:string;covered_through:number;source_message_ids:string[];source_trace_ids:string[];
  created_at:string;source:'host';provenance:{kind:'host_reported';recorded_by:SummaryWriter};context_only:true;
  evidence_through?:number;previous_revision?:number;generation?:{kind:'mcp_sampling';model?:string};
}
export interface SummaryWrite {
  text:string;covered_through:number;source_message_ids:string[];source_trace_ids?:string[];
  expected_revision:number;request_key:string;evidence_through?:number;maintenance?:boolean;
}
export type SummaryTraceReader=(id:string)=>Promise<{anchor_sequence:number}|undefined>;
const pad=(n:number)=>String(n).padStart(16,'0');
const prefix=(chatId:string)=>'chat-summary:'+chatId+':';
const failure=(code:string,message:string)=>Object.assign(new Error(message),{code});
function whole(value:unknown,name:string):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw failure('invalid_chat_summary',name+' must be a nonnegative integer');
  return value;
}
function references(value:unknown,pattern:RegExp,name:string):string[] {
  if(!Array.isArray(value)||value.length>500||!value.every(id=>typeof id==='string'&&pattern.test(id)))throw failure('invalid_chat_summary','Invalid '+name);
  return [...new Set(value)].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
}

/** Caller must enforce current chat access. Historical reads never include a future summary. */
export async function readChatSummary(store:KeyStore,chatId:string,through?:number,beforeAt?:string):Promise<ChatSummary|null> {
  if(through!==undefined)whole(through,'through');
  const before=beforeAt===undefined?Infinity:Date.parse(beforeAt);
  if(!Number.isFinite(before)&&before!==Infinity)throw failure('invalid_chat_summary','Invalid summary snapshot time');
  const p=prefix(chatId),head=await store.get<{revision:number}>(p+'head');
  if(!head)return null;
  let endBefore=p+'version:'+pad(head.revision+1);
  for(;;){
    const rows=await store.list<ChatSummary>({prefix:p+'version:',endBefore,reverse:true,limit:100});
    if(!rows.size)return null;
    for(const [key,value] of rows){
      if((through===undefined||Math.max(value.covered_through,value.evidence_through??0)<=through)&&Date.parse(value.created_at)<=before)return value;
      endBefore=key;
    }
    if(rows.size<100)return null;
  }
}

/** Runs inside the caller's authorized transaction; temporary writer credentials never enter storage. */
export async function writeChatSummary(tx:KeyStore,chatId:string,input:SummaryWrite,writer:SummaryWriter,readTrace?:SummaryTraceReader,generation?:ChatSummary['generation']):Promise<ChatSummary> {
  const covered=whole(input.covered_through,'covered_through'),expected=whole(input.expected_revision,'expected_revision');
  if(typeof input.text!=='string'||(!input.maintenance&&!input.text.trim())||new TextEncoder().encode(input.text).length>(input.maintenance?200_000:MAX_SUMMARY_TEXT_BYTES))throw failure('invalid_chat_summary','Summary text must be nonempty and at most 32000 UTF-8 bytes; it is never silently truncated');
  assertContextSafe(input.text);
  if(typeof input.request_key!=='string'||!input.request_key.length||input.request_key.length>256)throw failure('invalid_chat_summary','A stable request_key of at most 256 characters is required');
  const messages=references(input.source_message_ids,/^m[1-9]\d*$/,'source_message_ids'),traces=references(input.source_trace_ids??[],/^c[1-9]\d*$/,'source_trace_ids');
  if(!messages.length&&!traces.length)throw failure('invalid_chat_summary','A summary must cite saved messages or tool records');
  const p=prefix(chatId),dedupe=p+'request:'+await hash(input.request_key);
  const evidence=input.evidence_through===undefined?covered:whole(input.evidence_through,'evidence_through');
  const fingerprint=await hash(JSON.stringify([input.text,covered,messages,traces,evidence]));
  const previous=await tx.get<{fingerprint:string;revision:number}>(dedupe);
  if(previous){
    if(previous.fingerprint!==fingerprint)throw failure('request_key_conflict','Summary request_key was used for different content');
    const saved=await tx.get<ChatSummary>(p+'version:'+pad(previous.revision));
    if(!saved)throw failure('summary_receipt_missing','Saved summary receipt is unavailable');
    return saved;
  }
  const chat=await tx.get<{sequence:number;mode?:string}>('chat:'+chatId);
  if(!chat)throw failure('chat_not_found','Conversation does not exist');
  if(chat.mode&&chat.mode!=='chat')throw failure('chat_mode_mismatch','Semantic chat summaries are for Chat mode');
  if(evidence<covered||evidence>chat.sequence||covered>chat.sequence)throw failure('invalid_chat_summary','Summary coverage cannot include future messages');
  const latest=await readChatSummary(tx,chatId),revision=latest?.revision??0;
  if(expected!==revision)throw failure('summary_revision_conflict','Read the latest summary before updating it');
  if(latest&&covered<latest.covered_through)throw failure('invalid_chat_summary','Summary coverage cannot move backwards');
  for(const id of messages){
    const seq=Number(id.slice(1));
    if(seq>evidence||!await tx.get('chat-message:'+chatId+':'+pad(seq)))throw failure('invalid_chat_summary','Summary cites a missing or future message: '+id);
  }
  for(const id of traces){
    const trace=await readTrace?.(id);
    if(!trace||trace.anchor_sequence>evidence)throw failure('invalid_chat_summary','Summary cites a missing or future tool record: '+id);
  }
  const result:ChatSummary={id:'s'+(revision+1),revision:revision+1,text:input.text,covered_through:covered,
    source_message_ids:messages,source_trace_ids:traces,evidence_through:evidence,created_at:new Date().toISOString(),source:'host',
    provenance:{kind:'host_reported',recorded_by:{account:writer.account,epoch:writer.epoch,caller:writer.caller}},context_only:true,
    ...(latest?{previous_revision:latest.revision}:{}),...(generation?{generation}: {})};
  await tx.put({[p+'head']:{revision:result.revision},[p+'version:'+pad(result.revision)]:result,[dedupe]:{fingerprint,revision:result.revision}});
  return result;
}

export async function eraseChatSummary(tx:KeyStore,chatId:string):Promise<void> {
  for(;;){const rows=await tx.list({prefix:prefix(chatId),limit:100});if(!rows.size)return;await tx.delete([...rows.keys()]);}
}

