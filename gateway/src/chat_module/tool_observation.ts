/** Actual MCP boundary observations. Capturing context never replaces tool authorization. */
import type {KeyStore} from '../runtime';
import type {Data} from '../types';
import {recordObservedTrace,type TraceScope} from './trace';
import {assertContextSafe} from './context_safety';
export interface ChatToolBinding {chat_id:string;connection:string;source_message_ids:string[];capture?:'metadata'|'content';round_id?:string;review_id?:string}
export interface ObservedToolTicket {
  chatId:string;writerId:string;account:string;epoch:number;caller:string;callId:string;
  sourceMessageIds:string[];callTraceId?:string;capture:'metadata'|'content';tool:string;
  logicalCallId?:string;captureState:'recorded'|'unavailable';roundId?:string;reviewId?:string;
}
export interface ObservedToolReceipt {chat_id:string;call_trace_id?:string;result_trace_id?:string;call_id:string;logical_call_id?:string;provenance:'server_observed';capture:'metadata'|'content';state:'recorded'|'unavailable';execution_evidence:'gateway_observation_only'}
type MessageReader=(id:string)=>Promise<{id:string;sequence:number;role:string;text:string;attachments?:unknown[]}|undefined>;
const forbidden=/^(?:chat_context|authorization|proxy_authorization|cookie|set_cookie|password|passwd|passphrase|token|.*_token|api_?key|client_secret|secret|.*_secret|private_?key|credential|credentials|connection|connection_hash|event_connection|signing_key|signature|base64)$/i;
const metadataKeys=new Set(['id','device_id','session','operation','request_id','action','state','status','saved','applied','completed','exit_code','type','mime_type','mimeType','size','length','offset','next_offset','eof','sha256','stdout','stderr','stdout_complete','stderr_complete','file_ref','file_id','files','result','error','code','recover','arguments','tool','method','written']);
function metadataString(key:string,value:string):boolean {
  if(['stdout','stderr','id','file_ref','file_id','device_id','session','request_id'].includes(key))return /^[a-z][1-9]\d*$/.test(value);
  if(['result','error','files','arguments','recover'].includes(key))return false;
  if(key==='sha256')return /^[a-f0-9]{64}$/.test(value);
  if(key==='mime_type'||key==='mimeType')return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value);
  return /^[a-z][a-z0-9_.:-]{0,127}$/i.test(value);
}
function cleanString(value:string):string {
  return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,'[private key omitted]')
    .replace(/\bBearer\s+[a-z0-9._~+\/-]+/gi,'Bearer [credential omitted]')
    .replace(/([?&](?:token|access_token|api_key|key|signature|sig|credential|secret|password|code)=)[^&#\s]+/gi,'$1[credential omitted]')
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{24,}/gi,'[credential omitted]');
}
/** A limited redactor, not a sensitive-data authorization system. Content capture
 * is explicit: the host must first ensure these exact data may enter this chat. */
export function observationText(value:unknown,capture:'metadata'|'content',phase:'request'|'response'):string {
  let omitted=false;
  const scrub=(item:unknown,depth=0):unknown=>{
    if(depth>8){omitted=true;return '[depth omitted]';}
    if(typeof item==='string'){const clean=cleanString(item);if(clean!==item)omitted=true;try{assertContextSafe(clean);}catch{omitted=true;return '[possible credential content omitted]';}if(clean.length>8192){omitted=true;return clean.slice(0,8192)+' [remaining text omitted]';}return clean;}
    if(item===null||typeof item==='number'||typeof item==='boolean')return item;
    if(Array.isArray(item)){if(item.length>50)omitted=true;return item.slice(0,50).map(value=>scrub(value,depth+1));}
    if(typeof item==='object'&&item){const result:Data=Object.create(null);let count=0;for(const [key,value] of Object.entries(item)){
      if(++count>100){omitted=true;break;}
      if(forbidden.test(key)||/(?:token|secret|password|credential|privatekey)$/i.test(key.replace(/[-_]/g,''))||key==='data'&&typeof value==='string'){omitted=true;continue;}
      if(capture==='metadata'&&(!metadataKeys.has(key)||typeof value==='string'&&!metadataString(key,value)||Array.isArray(value)&&value.some(entry=>typeof entry==='string'))){omitted=true;continue;}
      result[key]=scrub(value,depth+1);
    }return result;}
    omitted=true;return '[unsupported value omitted]';
  };
  const data=scrub(value),envelope={observation:'mcp_'+phase,capture,data,content_omitted:omitted,execution_evidence:'gateway_observation_only'};
  let text=JSON.stringify(envelope);
  try{assertContextSafe(text);}catch{return JSON.stringify({...envelope,data:null,content_omitted:true,omission_reason:'possible_credentials'});}
  if(new TextEncoder().encode(text).length>65536){text=JSON.stringify({...envelope,data:null,content_omitted:true,omission_reason:'observation_size_limit'});}
  return text;
}
async function logicalCallId(tool:string,input:Data):Promise<string|undefined>{
  if(typeof input.request_key!=='string'||!input.request_key)return undefined;
  // Excludes chat credentials; hashes tool name, original session/device scope and stable retry key (not an argument fingerprint).
  const data=new TextEncoder().encode(JSON.stringify([tool,input.session??null,input.device_id??null,input.request_key]));
  const hash=await crypto.subtle.digest('SHA-256',data);return 'logical:'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function observeToolCall(tx:KeyStore,scope:TraceScope,binding:ChatToolBinding,tool:string,input:Data,readMessage:MessageReader):Promise<ObservedToolTicket>{
  const ticket:ObservedToolTicket={chatId:scope.chatId,writerId:scope.writer.id,account:scope.writer.account,epoch:scope.writer.epoch,caller:scope.writer.caller,
    callId:'mcp:'+crypto.randomUUID(),sourceMessageIds:[...binding.source_message_ids],capture:binding.capture??'metadata',tool,
    logicalCallId:await logicalCallId(tool,input),captureState:'recorded',roundId:binding.round_id,reviewId:binding.review_id};
  const saved=await recordObservedTrace(tx,scope,{kind:'tool_call',call_id:ticket.callId,tool_name:tool,text:observationText(input,ticket.capture,'request'),source_message_ids:ticket.sourceMessageIds,request_key:ticket.callId+':request'},readMessage,ticket.logicalCallId);
  ticket.callTraceId=saved.trace.id;return ticket;
}
export function unavailableToolTicket(scope:TraceScope,binding:ChatToolBinding,tool:string):ObservedToolTicket {
  return {chatId:scope.chatId,writerId:scope.writer.id,account:scope.writer.account,epoch:scope.writer.epoch,caller:scope.writer.caller,
    callId:'mcp:'+crypto.randomUUID(),sourceMessageIds:[...binding.source_message_ids],capture:binding.capture??'metadata',tool,captureState:'unavailable',
    roundId:binding.round_id,reviewId:binding.review_id};
}
export function toolObservationReceipt(ticket:ObservedToolTicket,resultTraceId?:string):ObservedToolReceipt {
  return {chat_id:ticket.chatId,...(ticket.callTraceId?{call_trace_id:ticket.callTraceId}:{}),...(resultTraceId?{result_trace_id:resultTraceId}:{}),call_id:ticket.callId,
    ...(ticket.logicalCallId?{logical_call_id:ticket.logicalCallId}:{}),provenance:'server_observed',capture:ticket.capture,state:resultTraceId?'recorded':'unavailable',execution_evidence:'gateway_observation_only'};
}
export async function observeToolResult(tx:KeyStore,scope:TraceScope,ticket:ObservedToolTicket,output:Data,readMessage:MessageReader):Promise<ObservedToolReceipt>{
  if(ticket.captureState==='unavailable')return toolObservationReceipt(ticket);
  const saved=await recordObservedTrace(tx,scope,{kind:'tool_result',call_id:ticket.callId,tool_name:ticket.tool,text:observationText(output,ticket.capture,'response'),source_message_ids:ticket.sourceMessageIds,request_key:ticket.callId+':response'},readMessage,ticket.logicalCallId);
  return toolObservationReceipt(ticket,saved.trace.id);
}
