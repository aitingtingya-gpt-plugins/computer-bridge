/** Lossless oversized-message fallback through the existing ordinary Chat attachment lifecycle. */
import {sha256} from '@noble/hashes/sha2.js';
import {CHAT_EVENT_BYTES,jsonBytes} from './context';

export interface TextAttachmentView {id:string;name:string;size:number;mime_type:string;sha256?:string}
export interface TextAttachmentPort {
  start(args:{name:string;size:number;mime_type:string;sha256:string;request_key:string}):Promise<{attachment:{id:string;state?:string};chunk_size:number}>;
  chunk(args:{attachment_id:string;offset:number;data:string}):Promise<unknown>;
  complete(args:{attachment_id:string}):Promise<{attachment:TextAttachmentView}>;
}
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
function base64(bytes:Uint8Array):string {
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary);
}
/** Pass a complete minimal event, not text.length or a context-only JSON object. */
export function requiresTextAttachment(minimalEvent:unknown,maximum=CHAT_EVENT_BYTES):boolean {
  return jsonBytes(minimalEvent)>maximum;
}
export function textAttachmentPlan(text:string,requestKey:string,format:'txt'|'md'='txt') {
  const bytes=new TextEncoder().encode(text),checksum=hex(sha256(bytes));
  const keyDigest=hex(sha256(new TextEncoder().encode(requestKey)));
  return {bytes,upload:{name:'message-'+checksum.slice(0,16)+'.'+format,size:bytes.length,
    mime_type:format==='md'?'text/markdown; charset=utf-8':'text/plain; charset=utf-8',sha256:checksum,
    request_key:'message-text:'+keyDigest}};
}
/** Stable request_key, exact bytes and checksum make retries reuse the same saved attachment. */
export async function storeTextAttachment(text:string,requestKey:string,port:TextAttachmentPort,format:'txt'|'md'='txt'):Promise<TextAttachmentView> {
  const plan=textAttachmentPlan(text,requestKey,format),started=await port.start(plan.upload),chunkSize=started.chunk_size;
  if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>1024*1024)throw Object.assign(new Error('Invalid attachment chunk size'),{code:'invalid_attachment_chunk_size'});
  if(started.attachment.state!=='ready')for(let offset=0;offset<plan.bytes.length;offset+=chunkSize){
    await port.chunk({attachment_id:started.attachment.id,offset,data:base64(plan.bytes.subarray(offset,offset+chunkSize))});
  }
  const {attachment}=await port.complete({attachment_id:started.attachment.id});
  if(attachment.size!==plan.bytes.length||attachment.sha256!==plan.upload.sha256)throw Object.assign(new Error('Completed text attachment did not match the original bytes'),{code:'attachment_checksum'});
  return attachment;
}
