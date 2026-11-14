/** Explicitly scoped host reports and gateway observations, never a permission grant.
 * Gateway observations describe requests/returns, not proof of a separate execution.
 * The caller MUST check current chat ACLs and, for record, the current writer inside
 * the same transaction before calling this module. No connection credential is stored.
 */
import type {KeyStore} from '../runtime';
import {assertContextSafe} from './context_safety';
export interface TraceRequest {
  kind?:'tool_call'|'tool_result'|'task_result';call_id?:string;tool_name?:string;text?:string;
  source_message_ids?:string[];task_id?:string;task_label?:string;returned_message_id?:string;request_key?:string;
}
export interface TraceEntry {
  id:string;sequence:number;kind:'tool_call'|'tool_result'|'task_result';text:string;
  source:{message_ids:string[];call_id?:string;tool_name?:string;task_id?:string;task_label?:string;returned_message_id?:string;logical_call_id?:string};
  anchor_sequence:number;recorded_at:string;
  provenance:{kind:'host_reported'|'server_observed';recorded_by:{account:string;epoch:number;caller:string}};
  context_only:true;text_truncated?:boolean;total_length?:number;
}
export interface TraceGroup {group_id:string;first_sequence:number;last_sequence:number;entries:TraceEntry[];complete:boolean;context_only:true}
type Stored=Omit<TraceEntry,'text'>&{chunks:number;text_length:number};
type Message={id:string;sequence:number;role:string;text:string;attachments?:unknown[]};
const prefix=(chat:string)=>'chat-trace:'+chat+':';
const pad=(value:number)=>String(value).padStart(16,'0');
const entryKey=(chat:string,sequence:number)=>prefix(chat)+'entry:'+pad(sequence);
const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code});};
const bounded=(value:unknown,name:string,max:number,required=false):string|undefined=>{
  if(value===undefined&&!required)return undefined;
  if(typeof value!=='string'||!value.trim()||value.length>max)return fail('invalid_trace',name+' is invalid');
  return value;
};
const integer=(value:unknown,fallback:number,min=0,max=Number.MAX_SAFE_INTEGER)=>value===undefined?fallback:
  typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max?value:fail('invalid_trace','Invalid trace range');
async function digest(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
async function body(store:KeyStore,chat:string,entry:Stored){let text='';for(let i=0;i<entry.chunks;i++){const part=await store.get<string>(prefix(chat)+'body:'+pad(entry.sequence)+':'+pad(i));if(part===undefined)fail('trace_unavailable','Saved trace body is unavailable');text+=part;}return text;}
function visible(entry:Stored,text:string):TraceEntry{const {chunks:_,text_length:__,...meta}=entry;return {...meta,text};}
function split(text:string){const parts:string[]=[];let offset=0;while(offset<text.length){let end=Math.min(offset+16384,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push(text.slice(offset,end));offset=end;}return parts;}

export interface TraceScope {chatId:string;latestSequence:number;writer:{id:string;account:string;epoch:number;caller:string}}
type MessageReader=(id:string)=>Promise<Message|undefined>;
export function recordTrace(tx:KeyStore,scope:TraceScope,request:TraceRequest,readMessage:MessageReader){return recordEntry(tx,scope,request,readMessage,'host_reported');}
/** Internal producer only. No MCP tool accepts provenance or a server-observed flag. */
export function recordObservedTrace(tx:KeyStore,scope:TraceScope,request:TraceRequest,readMessage:MessageReader,logicalCallId?:string){
  if(request.kind==='task_result')return fail('invalid_trace','Server observations only cover actual Bridge tool calls');
  return recordEntry(tx,scope,request,readMessage,'server_observed',logicalCallId);
}
async function recordEntry(tx:KeyStore,scope:TraceScope,request:TraceRequest,readMessage:MessageReader,provenance:'host_reported'|'server_observed',logicalCallId?:string):Promise<{saved:true;trace:TraceEntry&{text_truncated:boolean};reused:boolean}>{
  const {chatId,writer}=scope;
  const kind=request.kind;if(!kind||!['tool_call','tool_result','task_result'].includes(kind))return fail('invalid_trace','Unknown trace kind');
  const key=bounded(request.request_key,'request_key',256,true)!;
  const ids=request.source_message_ids??[];
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!/^m[1-9]\d*$/.test(id))||new Set(ids).size!==ids.length)fail('invalid_trace','Invalid source_message_ids');
  const call=bounded(request.call_id,'call_id',256,kind!=='task_result'),tool=bounded(request.tool_name,'tool_name',256,kind==='tool_call');
  const task=bounded(request.task_id,'task_id',256,kind==='task_result'),label=bounded(request.task_label,'task_label',512);
  const returned=bounded(request.returned_message_id,'returned_message_id',64,kind==='task_result');
  if(kind==='task_result'&&(call||tool||request.text!==undefined))fail('invalid_trace','Task result text is derived only from its saved assistant message');
  if(kind!=='task_result'&&(task||label||returned))fail('invalid_trace','Task source fields are only valid for task results');
  if(kind!=='task_result'&&(typeof request.text!=='string'||request.text.length>524288||!ids.length))fail('invalid_trace','Tool traces require a bounded text body and source messages');
  assertContextSafe([call,tool,task,label,request.text].filter(value=>value!==undefined).join("\n"));
  const signature=await digest({kind,call,tool,task,label,returned,ids,text:request.text,...(provenance==='server_observed'?{provenance,logicalCallId}:{})});
  const retryKey=prefix(chatId)+'retry:'+await digest(key),old=await tx.get<{signature:string;sequence:number}>(retryKey);
  const result=async(sequence:number,reused:boolean)=>{const row=await tx.get<Stored>(entryKey(chatId,sequence));if(!row)return fail('trace_unavailable','Saved trace is unavailable');const text=await body(tx,chatId,row);let preview=text.slice(0,2048);if(/[\uD800-\uDBFF]$/.test(preview))preview=preview.slice(0,-1);return {saved:true as const,trace:{...visible(row,preview),text_truncated:preview.length<text.length},reused};};
  if(old){if(old.signature!==signature)fail('request_key_conflict','Retry key was used for a different trace');return result(old.sequence,true);}
  for(const id of ids){const source=await readMessage(id);if(!source||source.id!==id||source.sequence>scope.latestSequence)fail('invalid_trace_source','Source message must exist in this conversation');}
  let text=request.text??'',source:TraceEntry['source']={message_ids:[...ids]},groupFirst=0,callIndexKey:string|undefined,callIndex:{call:number;result?:number}|undefined;
  if(kind==='task_result'){
    if(!/^m[1-9]\d*$/.test(returned!))fail('invalid_trace_source','Invalid returned message ID');
    const message=await readMessage(returned!);
    if(!message||message.id!==returned||message.role!=='assistant'||message.sequence>scope.latestSequence)return fail('invalid_trace_source','Task results must already be returned as an assistant message in this conversation');
    text=message.text;if(text.length>524288)fail('invalid_trace','Task result body exceeds trace storage limit; read the saved message instead');
    source={message_ids:[...new Set([...ids,returned!])],task_id:task,...(label?{task_label:label}:{}),returned_message_id:returned};
  }else{
    callIndexKey=prefix(chatId)+'call:'+await digest(call);callIndex=await tx.get(callIndexKey);
    if(kind==='tool_call'&&callIndex)fail('trace_call_exists','This call ID already has a saved call; retry the original request key');
    if(kind==='tool_result'&&(!callIndex||callIndex.result))fail(callIndex?'trace_result_exists':'trace_call_missing',callIndex?'This call already has a result; retry the original request key':'A result needs a saved call in this conversation');
    const original=callIndex&&await tx.get<Stored>(entryKey(chatId,callIndex.call));
    if(kind==='tool_result'&&(!original||tool&&tool!==original.source.tool_name))fail('invalid_trace_source','Result tool name must match the saved call');
    source={message_ids:[...ids],call_id:call,tool_name:tool??original?.source.tool_name};groupFirst=callIndex?.call??0;
  }
  if(logicalCallId)source.logical_call_id=logicalCallId;
  assertContextSafe(text);
  const sequence=(await tx.get<number>(prefix(chatId)+'sequence')??0)+1;
  const chunks=split(text),entry:Stored={id:'c'+sequence,sequence,kind,source,anchor_sequence:scope.latestSequence,recorded_at:new Date().toISOString(),provenance:{kind:provenance,recorded_by:{account:writer.account,epoch:writer.epoch,caller:writer.caller}},context_only:true,chunks:chunks.length,text_length:text.length};
  await tx.put(entryKey(chatId,sequence),entry);await tx.put(prefix(chatId)+'sequence',sequence);
  for(let i=0;i<chunks.length;i++)await tx.put(prefix(chatId)+'body:'+pad(sequence)+':'+pad(i),chunks[i]);
  if(callIndexKey)await tx.put(callIndexKey,kind==='tool_call'?{call:sequence}:{...callIndex,result:sequence});
  groupFirst ||= sequence;await tx.put(prefix(chatId)+'group:'+pad(groupFirst),{first:groupFirst,last:sequence,entries:kind==='tool_result'?[groupFirst,sequence]:[sequence]});
  await tx.put(retryKey,{signature,sequence});return result(sequence,false);
}
export async function listTrace(store:KeyStore,chatId:string,options:{after?:number;limit?:number;throughSequence?:number;beforeAt?:string}={}){
  const after=integer(options.after,0),limit=integer(options.limit,10,1,50),through=integer(options.throughSequence,Number.MAX_SAFE_INTEGER);
  const before=options.beforeAt===undefined?Infinity:Date.parse(options.beforeAt);if(Number.isNaN(before))fail('invalid_trace','Invalid trace time boundary');
  const groupPrefix=prefix(chatId)+'group:',reverse=options.after===undefined;
  const groups:TraceGroup[]=[];let remainingBytes=160000,cursor=reverse?undefined:groupPrefix+pad(after);
  outer:while(true){
  const rows=await store.list<{first:number;last:number;entries:number[]}>({prefix:groupPrefix,limit:100,...(reverse?{reverse:true,...(cursor?{endBefore:cursor}:{})}:{startAfter:cursor})});
  if(!rows.size)break;
  for(const [key,row] of rows){cursor=key;
    const entries:TraceEntry[]=[];
    for(const seq of row.entries){const entry=await store.get<Stored>(entryKey(chatId,seq));if(entry&&entry.anchor_sequence<=through&&Date.parse(entry.recorded_at)<=before)entries.push(visible(entry,await body(store,chatId,entry)));}
    if(!entries.length)continue;
    const bytes=new TextEncoder().encode(JSON.stringify(entries)).length;
    if(bytes>remainingBytes)for(const entry of entries){entry.total_length=entry.text.length;entry.text='';entry.text_truncated=true;}
    remainingBytes-=Math.min(remainingBytes,new TextEncoder().encode(JSON.stringify(entries)).length);
    groups.push({group_id:'c'+row.first,first_sequence:row.first,last_sequence:entries.at(-1)!.sequence,entries,complete:entries[0].kind==='task_result'||entries.some(entry=>entry.kind==='tool_result'),context_only:true});
    if(groups.length>limit)break outer;
  }
  if(rows.size<100)break;
  }
  const more=groups.length>limit;if(more)groups.pop();if(options.after===undefined)groups.reverse();
  return {groups,next_cursor:more&&options.after!==undefined?groups.at(-1)!.first_sequence:null,has_older:options.after===undefined&&more,availability:'host_reported_or_gateway_observed' as const};
}
export async function readTrace(store:KeyStore,chatId:string,options:{trace_id:string;offset?:number;length?:number}){
  if(!/^c[1-9]\d*$/.test(options.trace_id))return fail('invalid_trace','Invalid trace ID');
  const sequence=integer(Number(options.trace_id.slice(1)),0,1),entry=await store.get<Stored>(entryKey(chatId,sequence));if(!entry)return fail('trace_not_found','Trace does not exist in this conversation');
  const text=await body(store,chatId,entry);let start=integer(options.offset,0,0,text.length),end=Math.min(text.length,start+integer(options.length,8192,1,65536));
  if(start&&/[\uDC00-\uDFFF]/.test(text[start]??''))start--;
  if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]??''))end--;
  if(end<=start&&start<text.length)end=Math.min(text.length,start+2);
  return {trace:visible(entry,text.slice(start,end)),offset:start,length:end-start,total_length:text.length,next_offset:end<text.length?end:null,offset_unit:'utf16_code_units',availability:'host_reported_or_gateway_observed' as const};
}
export async function eraseTrace(tx:KeyStore,chatId:string){const keys=[...(await tx.list({prefix:prefix(chatId)})).keys()];for(let i=0;i<keys.length;i+=100)await tx.delete(keys.slice(i,i+100));}

/** Metadata-only provenance lookup; caller applies current chat ACLs. */
export async function readTraceEntry(store:KeyStore,chatId:string,id:string):Promise<Omit<TraceEntry,'text'>|undefined>{
  if(!/^c[1-9]\d*$/.test(id))return undefined;const entry=await store.get<Stored>(entryKey(chatId,Number(id.slice(1))));
  if(!entry)return undefined;const {chunks:_,text_length:__,...meta}=entry;return meta;
}
