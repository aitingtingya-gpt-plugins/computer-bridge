/** Conversation bookkeeping, never a task dispatcher or authority to replay an operation. */
import type {KeyStore} from '../runtime';

export interface InputMessage {id:string;sequence:number;role:string;created_at:string;approval_id?:string}
export interface ProcessingRecord {
  message_id:string;sequence:number;state:'pending'|'active'|'blocked'|'resolved'|'legacy_unknown';
  source:'server_saved'|'host_reported'|'legacy_unknown';revision:number;updated_at:string;
  reason?:string;reported_by?:{account:string;epoch:number;caller:string};last_saved_reply_id?:string;
}
export interface ReliabilityMeta {revision:number;unresolved_count:number;legacy_untracked_through:number}
const padded=(n:number)=>String(n).padStart(16,'0');
const metaKey=(chat:string)=>'chat-processing-meta:'+chat;
const rowKey=(chat:string,seq:number)=>'chat-processing:'+chat+':'+padded(seq);
const openKey=(chat:string,seq:number)=>'chat-processing-open:'+chat+':'+padded(seq);
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});

export async function processingMeta(store:KeyStore,chat:string,legacyThrough:number):Promise<ReliabilityMeta>{
  return await store.get<ReliabilityMeta>(metaKey(chat))??{revision:0,unresolved_count:0,legacy_untracked_through:legacyThrough};
}
export async function processingRecord(store:KeyStore,chat:string,message:InputMessage):Promise<ProcessingRecord>{
  return await store.get<ProcessingRecord>(rowKey(chat,message.sequence))??{
    message_id:message.id,sequence:message.sequence,state:'legacy_unknown',source:'legacy_unknown',revision:0,updated_at:message.created_at};
}
export async function queueInput(tx:KeyStore,chat:string,message:InputMessage):Promise<void>{
  if(message.role!=='user'||message.approval_id)return;
  if(await tx.get(rowKey(chat,message.sequence)))return;
  const meta=await processingMeta(tx,chat,message.sequence-1);meta.revision++;meta.unresolved_count++;
  const row:ProcessingRecord={message_id:message.id,sequence:message.sequence,state:'pending',source:'server_saved',revision:meta.revision,updated_at:message.created_at};
  await tx.put({[metaKey(chat)]:meta,[rowKey(chat,message.sequence)]:row,[openKey(chat,message.sequence)]:message.sequence});
}
export async function listPending(store:KeyStore,chat:string,latestSequence:number,after:number,limit:number){
  const meta=await processingMeta(store,chat,latestSequence);
  const entries=await store.list<number>({prefix:'chat-processing-open:'+chat+':',startAfter:openKey(chat,after),limit:limit+1});
  const sequences=[...entries.values()],page=sequences.slice(0,limit),items:ProcessingRecord[]=[];
  for(const seq of page){const row=await store.get<ProcessingRecord>(rowKey(chat,seq));if(row)items.push(row);}
  return {...meta,latest_sequence:latestSequence,items,next_cursor:sequences.length>limit?page.at(-1)!:null,
    recovery:'Read the latest user instructions and inspect uncertain effects. These records never authorize replay or require a separate reply to each message.'};
}
export async function reportProcessing(tx:KeyStore,chat:string,latestSequence:number,messages:InputMessage[],request:{
  state:'active'|'blocked'|'resolved';reason?:string;expected_revision:number;
},reporter:{account:string;epoch:number;caller:string},replyId?:string){
  const meta=await processingMeta(tx,chat,latestSequence);
  if(!Number.isSafeInteger(request.expected_revision)||request.expected_revision!==meta.revision)throw fail('stale_processing_revision','处理记录已变化，请读取最新待处理消息和用户指示后再更新');
  if(!['active','blocked','resolved'].includes(request.state))throw fail('invalid_chat_argument','无效的处理状态');
  if(request.reason!==undefined&&(typeof request.reason!=='string'||request.reason.length>1000))throw fail('invalid_chat_argument','reason 最多 1000 个字符');
  if(!messages.length||messages.length>100||new Set(messages.map(m=>m.id)).size!==messages.length)throw fail('invalid_chat_argument','message_ids 必须包含 1 到 100 条不同消息');
  const rows:ProcessingRecord[]=[];meta.revision++;
  for(const message of messages){
    if(message.role!=='user'||message.approval_id)throw fail('invalid_processing_message','处理回执只可引用本对话的用户输入');
    const old=await tx.get<ProcessingRecord>(rowKey(chat,message.sequence));
    if(old?.state==='resolved'&&request.state!=='resolved')throw fail('processing_resolved','已处理输入不能作为新请求重新执行');
    const wasOpen=!!old&&old.state!=='resolved',isOpen=request.state!=='resolved';
    meta.unresolved_count+=Number(isOpen)-Number(wasOpen);
    const row:ProcessingRecord={message_id:message.id,sequence:message.sequence,state:request.state,source:'host_reported',
      revision:meta.revision,updated_at:new Date().toISOString(),reported_by:reporter,
      ...(request.reason!==undefined?{reason:request.reason}:{}),
      ...(replyId||old?.last_saved_reply_id?{last_saved_reply_id:replyId??old!.last_saved_reply_id}:{})};
    await tx.put(rowKey(chat,message.sequence),row);
    if(isOpen)await tx.put(openKey(chat,message.sequence),message.sequence);else await tx.delete(openKey(chat,message.sequence));
    rows.push(row);
  }
  await tx.put(metaKey(chat),meta);return {...meta,latest_sequence:latestSequence,items:rows};
}
export async function noteSavedReply(tx:KeyStore,chat:string,sequence:number,replyId:string):Promise<void>{
  const row=await tx.get<ProcessingRecord>(rowKey(chat,sequence));
  if(row){row.last_saved_reply_id=replyId;await tx.put(rowKey(chat,sequence),row);}
}
export async function eraseProcessing(tx:KeyStore,chat:string):Promise<void>{
  for(const prefix of ['chat-processing:','chat-processing-open:'])await tx.delete([...(await tx.list({prefix:prefix+chat+':'})).keys()]);
  await tx.delete(metaKey(chat));
}
