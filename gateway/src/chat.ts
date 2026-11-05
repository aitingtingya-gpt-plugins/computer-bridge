/** Persistent, account-owned communication. Computer execution keeps its existing transport. */
import {sha256} from '@noble/hashes/sha2.js';
import {Webhook} from 'standardwebhooks';
import type {Accounts, Actor} from './accounts';
import type {KeyStore, Store} from './runtime';
import {hash, type Data} from './types';

export interface ChatDevice {id:string;raw:string;name:string;system:unknown}
export interface ChatBlobs {
  write(chat:string,attachment:string,index:number,bytes:Uint8Array):Promise<void>;
  read(chat:string,attachment:string,index:number):Promise<Uint8Array>;
  remove(chat:string,attachment:string):Promise<void>;
}
export interface ChatEnvironment {
  publicUrl:string;
  device(id:string,actor:Actor):Promise<ChatDevice>;
  webhookFetch(url:string,init:RequestInit):Promise<Response>;
  schedule(time:number):Promise<void>;
  equal(a:Uint8Array,b:Uint8Array):boolean;
  blobs?:ChatBlobs;
}
interface Conversation {id:string;owner:string;device:string;device_id:string;title:string;created_at:string;updated_at:string;sequence:number;attachments:number;active?:string}
interface Message {id:string;sequence:number;role:'user'|'assistant';source:'web'|'tui'|'model';text:string;attachments:AttachmentView[];created_at:string;delivery:'pending'|'delivered'|'replied'|'failed'|'none';reply_to?:string}
interface AttachmentView {id:string;name:string;size:number;mime_type:string;sha256?:string}
interface Attachment extends AttachmentView {offset:number;chunks:number;state:'uploading'|'ready';expires_at?:number;expected_sha256?:string}
interface Candidate {chat:string;account:string;epoch:number;caller:string;expires_at:number}
interface Subscription {id:string;chat:string;account:string;epoch:number;caller:string;connection_hash:string;url:string;secret:string;previous_secret?:string;rotation_until?:number;expires_at:number|null;cursor:number;verified_at:number}
interface Outbox {chat:string;sequence:number;subscription:string;attempts:number;next_at:number;state:'pending'|'delivered'|'failed';error?:string}
interface Link {id:string;code:string;device:string;token_hash:string;expires_at:number;approved_by?:string;epoch?:number;credential?:string}
interface Credential {account:string;epoch:number;device:string}
const CHUNK=262144;
const now=()=>new Date().toISOString();
const key=(id:string)=>'chat:'+id;
const messageKey=(id:string,seq:number)=>'chat-message:'+id+':'+String(seq).padStart(16,'0');
const attachmentKey=(id:string,a:string)=>'chat-attachment:'+id+':'+a;
const chunkKey=(id:string,a:string,index:number)=>'chat-chunk:'+id+':'+a+':'+String(index).padStart(10,'0');
const outboxKey=(chat:string,seq:number)=>'chat-event:'+chat+':'+String(seq).padStart(16,'0');
const subKey=(id:string)=>'chat-subscription:'+id;
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const secret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const from64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const to64=(bytes:Uint8Array)=>{let s='';for(let offset=0;offset<bytes.length;offset+=8192)s+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(s);};
const integer=(value:unknown,label:string,min=0)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw fail('invalid_chat_argument',label+' 必须为整数');return value;};
const limitOf=(value:unknown)=>Math.min(integer(value===undefined?50:value,'limit',1),100);
const textValue=(value:unknown,label:string)=>{if(typeof value!=='string')throw fail('invalid_chat_argument',label+' 必须为文本');return value;};
const cursorOf=(value:unknown)=>value===null||value===undefined?0:typeof value==='string'&&/^m\d+$/.test(value)?Number(value.slice(1)):integer(value,'cursor');
const viewAttachment=(a:Attachment):AttachmentView=>({id:a.id,name:a.name,size:a.size,mime_type:a.mime_type,...(a.sha256?{sha256:a.sha256}:{})});

export const chatEventDefinition={
  name:'chat.message',description:'A person sent a message or attachment to a Computer Bridge conversation. Available for Work and dots. Read chat.history, then answer with chat.reply; other computer tools remain available. Model replies do not create this event.',delivery:['webhook'],
  inputSchema:{type:'object',properties:{chat_id:{type:'string',description:'Stable short conversation ID, e.g. t1.'},connection:{type:'string',description:'Connection credential returned by chat.resume.'}},required:['chat_id','connection'],additionalProperties:false},
  payloadSchema:{type:'object',properties:{chat_id:{type:'string'},device_id:{type:'string'},message_id:{type:'string'},text:{type:'string'},text_truncated:{type:'boolean'},attachments:{type:'array',items:{type:'object'}},url:{type:'string'}},required:['chat_id','device_id','message_id','text','text_truncated','attachments','url'],additionalProperties:false}
};

export class ChatService {
  private running=false;
  constructor(private store:Store,private accounts:Accounts,private env:ChatEnvironment){}

  private async chat(id:string,actor:Actor):Promise<Conversation>{
    await this.accounts.require(actor.id,actor.epoch);
    const value=await this.store.get<Conversation>(key(id));
    if(!value||value.owner!==actor.id)throw fail('chat_not_found','对话不存在或不属于当前账号');
    await this.accounts.assertAccess(actor,value.device);
    await this.env.device(value.device,actor);
    if(value.active){
      const sub=await this.store.get<Subscription>(subKey(value.active));
      if(!sub||sub.epoch!==actor.epoch||sub.expires_at!==null&&sub.expires_at<=Date.now()){
        await this.release(value.id,value.active);delete value.active;
      }
    }
    return value;
  }
  private async summary(chat:Conversation,actor:Actor):Promise<Data>{
    const device=await this.env.device(chat.device,actor);
    const last=chat.sequence?await this.store.get<Message>(messageKey(chat.id,chat.sequence)):undefined;
    return {id:chat.id,title:chat.title,device_id:device.id,device_name:device.name,system:device.system,
      created_at:chat.created_at,updated_at:chat.updated_at,message_count:chat.sequence,state:chat.active?'connected':'waiting',delivery_state:last?(last.role==='assistant'?'replied':last.delivery):'none'};
  }
  private async next(tx:KeyStore,prefix:string):Promise<number>{const n=(await tx.get<number>('sequence:'+prefix)||0)+1;await tx.put('sequence:'+prefix,n);return n;}
  private async dedupe(tx:KeyStore,scope:string,requestKey:unknown,parameters:unknown):Promise<{key:string;fingerprint:string;result?:Data}>{
    if(typeof requestKey!=='string'||!requestKey)throw fail('request_key_required','请提供 request_key');
    const k='chat-request:'+scope+':'+await hash(requestKey),fingerprint=await hash(JSON.stringify(parameters));
    const previous=await tx.get<{fingerprint:string;result:Data}>(k);
    if(previous&&previous.fingerprint!==fingerprint)throw fail('request_key_conflict','同一 request_key 的参数不一致');
    return {key:k,fingerprint,result:previous?.result};
  }
  async action(action:string,args:Data,actor:Actor,caller=''):Promise<Data>{
    await this.accounts.require(actor.id,actor.epoch);
    if(action==='list'){
      const requested=args.device_id?await this.env.device(args.device_id,actor):null;
      const after=integer(args.after??0,'after'),limit=limitOf(args.limit);
      const rows=await this.store.list<string>({prefix:'chat-owner:'+actor.id+':',startAfter:'chat-owner:'+actor.id+':'+String(after).padStart(16,'0'),limit:limit+1});
      const chats=[];let last=after,more=false;
      for(const id of rows.values()){
        if(chats.length===limit){more=true;break;}
        last=Number(id.slice(1));
        try{const c=await this.chat(id,actor);if(!requested||c.device===requested.raw)chats.push(await this.summary(c,actor));}catch(e){if(!['chat_not_found','device_forbidden','device_missing'].includes((e as Data).code))throw e;}
      }
      return {chats,next_cursor:more||rows.size>limit?last:null};
    }
    if(action==='create'){
      const device=await this.env.device(args.device_id,actor);await this.accounts.assertAccess(actor,device.raw);
      const title=args.title===undefined?'新对话':textValue(args.title,'title').trim()||'新对话';
      const chat=await this.store.transaction(async tx=>{
        await this.accounts.assertAccessIn(tx,actor,device.raw);
        const d=await this.dedupe(tx,actor.id+':create',args.request_key,[device.raw,title]);
        if(d.result){const existing=await tx.get<Conversation>(key(d.result.id));if(!existing)throw fail('chat_deleted','原对话已删除');return existing;}
        const n=await this.next(tx,'t'),id='t'+n,stamp=now();
        const c:Conversation={id,owner:actor.id,device:device.raw,device_id:device.id,title,created_at:stamp,updated_at:stamp,sequence:0,attachments:0};
        await tx.put({[key(id)]:c,['chat-owner:'+actor.id+':'+String(n).padStart(16,'0')]:id,[d.key]:{fingerprint:d.fingerprint,result:{id}}});return c;
      });return {chat:await this.summary(chat,actor)};
    }
    const chat=await this.chat(textValue(args.chat_id,'chat_id'),actor);
    if(action==='get')return {chat:await this.summary(chat,actor)};
    if(action==='history')return this.history(chat,args,actor);
    if(action==='rename'){
      const title=textValue(args.title,'title').trim();if(!title)throw fail('invalid_chat_argument','标题不能为空');
      const updated=await this.store.transaction(async tx=>{await this.accounts.assertAccessIn(tx,actor,chat.device);const c=await tx.get<Conversation>(key(chat.id));if(!c)throw fail('chat_deleted','对话已删除');c.title=title;c.updated_at=now();await tx.put(key(c.id),c);return c;});
      return {chat:await this.summary(updated,actor)};
    }
    if(action==='delete'){await this.erase(chat);return {deleted:true};}
    if(action==='resume')return this.resume(chat,args,actor,caller);
    if(action==='disconnect'){
      await this.connection(chat,args.connection,actor,caller);await this.release(chat.id,chat.active!);return {disconnected:true,chat_id:chat.id};
    }
    if(action==='send'||action==='reply')return this.send(chat,args,actor,caller,action==='reply');
    if(action==='upload-start')return this.startUpload(chat,args,actor);
    if(action==='upload-chunk')return this.writeUpload(chat,args,actor);
    if(action==='upload-complete')return this.completeUpload(chat,args,actor);
    if(action==='attachment')return {attachment:viewAttachment(await this.attachment(chat.id,args.attachment_id,true))};
    if(action==='read-attachment')return this.readAttachment(chat,args);
    throw fail('unknown_chat_action','未知聊天操作');
  }
  private async history(chat:Conversation,args:Data,actor:Actor):Promise<Data>{
    const prefix='chat-message:'+chat.id+':',limit=limitOf(args.limit),forward=args.after!==undefined;
    const after=forward?integer(args.after,'after'):0,before=args.before===undefined?undefined:integer(args.before,'before',1);
    if(forward&&before!==undefined)throw fail('invalid_chat_argument','after 与 before 不能同时使用');
    const rows=await this.store.list<Message>({prefix,limit:limit+1,...(forward?{startAfter:messageKey(chat.id,after)}:{reverse:true,...(before?{endBefore:messageKey(chat.id,before)}:{})})});
    let messages=[...rows.values()].slice(0,limit);if(!forward)messages=messages.reverse();
    const first=messages[0]?.sequence??(before??after),last=messages.at(-1)?.sequence??after;
    return {chat:await this.summary(chat,actor),messages,next_cursor:last,first_cursor:first,eof:last>=chat.sequence,has_older:first>1};
  }
  private async resume(chat:Conversation,args:Data,actor:Actor,caller:string):Promise<Data>{
    if(!caller)throw fail('model_connection_required','请通过模型 MCP 连接恢复对话');
    if(chat.active){await this.connection(chat,args.connection,actor,caller);return {chat:await this.summary(chat,actor),connection:args.connection,subscribed:true,history:{chat_id:chat.id}};}
    let connection=args.connection;
    if(connection){const candidate=await this.store.get<Candidate>('chat-candidate:'+await hash(connection));if(!candidate||candidate.chat!==chat.id||candidate.account!==actor.id||candidate.epoch!==actor.epoch||candidate.caller!==caller||candidate.expires_at<=Date.now())throw fail('connection_expired','连接凭据已过期，请重新恢复对话');}
    else {connection=secret();await this.store.put('chat-candidate:'+await hash(connection),{chat:chat.id,account:actor.id,epoch:actor.epoch,caller,expires_at:Date.now()+600_000} satisfies Candidate);await this.env.schedule(Date.now()+600_000);}
    return {chat:await this.summary(chat,actor),connection,subscribed:false,event:{name:chatEventDefinition.name,arguments:{chat_id:chat.id,connection}},history:{chat_id:chat.id}};
  }
  private async connection(chat:Conversation,connection:unknown,actor:Actor,caller:string):Promise<Subscription>{
    const sub=chat.active?await this.store.get<Subscription>(subKey(chat.active)):undefined;
    if(!sub)throw fail('chat_not_connected','对话尚未连接模型');
    if(typeof connection!=='string'||sub.account!==actor.id||sub.epoch!==actor.epoch||sub.caller!==caller||sub.connection_hash!==await hash(connection))throw fail('chat_in_use','该对话正在被使用');
    return sub;
  }
  private async send(chat:Conversation,args:Data,actor:Actor,caller:string,model:boolean):Promise<Data>{
    const sub=model?await this.connection(chat,args.connection,actor,caller):undefined;
    const text=args.text===undefined?'':textValue(args.text,'text');
    // A stored message remains comfortably below a SQLite Durable Object's 2 MiB value limit.
    if(new TextEncoder().encode(text).length>512*1024)throw fail('message_too_large','单条消息最多 512 KiB，更长内容请作为附件发送');
    const ids=args.attachments??[];if(!Array.isArray(ids)||!ids.every(v=>typeof v==='string'))throw fail('invalid_chat_argument','attachments 必须为附件编号列表');
    const attachments=await Promise.all(ids.map(id=>this.attachment(chat.id,id,true)));
    if(!text.trim()&&!attachments.length)throw fail('empty_message','消息不能为空');
    const source=model?'model':args.source==='tui'?'tui':'web';
    const message=await this.store.transaction(async tx=>{
      await this.accounts.assertAccessIn(tx,actor,chat.device);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      if(model&&current.active!==sub!.id)throw fail('chat_not_connected','原模型连接已结束');
      const d=await this.dedupe(tx,chat.id+':'+(model?'reply':'send'),args.request_key,[text,ids,args.reply_to??null,model?sub!.id:null]);
      if(d.result)return (await tx.get<Message>(messageKey(chat.id,d.result.sequence)))!;
      const sequence=++current.sequence,id='m'+sequence;
      const m:Message={id,sequence,role:model?'assistant':'user',source,text,attachments:attachments.map(viewAttachment),created_at:now(),delivery:model?'none':'pending',...(args.reply_to?{reply_to:args.reply_to}:{})};
      current.updated_at=m.created_at;
      if(model&&args.reply_to){
        const seq=cursorOf(args.reply_to),old=await tx.get<Message>(messageKey(chat.id,seq));
        if(!old||old.role!=='user')throw fail('invalid_reply','reply_to 必须指向该对话的用户消息');
        old.delivery='replied';await tx.put(messageKey(chat.id,seq),old);
      }
      await tx.put({[key(chat.id)]:current,[messageKey(chat.id,sequence)]:m,[d.key]:{fingerprint:d.fingerprint,result:{sequence}}});
      if(!model&&current.active)await tx.put(outboxKey(chat.id,sequence),{chat:chat.id,sequence,subscription:current.active,attempts:0,next_at:Date.now(),state:'pending'} satisfies Outbox);
      return m;
    });
    if(!model)await this.env.schedule(Date.now());
    return {message,chat:await this.summary((await this.store.get<Conversation>(key(chat.id)))!,actor)};
  }
  private async attachment(chat:string,id:unknown,ready=false):Promise<Attachment>{
    if(typeof id!=='string')throw fail('attachment_not_found','附件不存在');
    const a=await this.store.get<Attachment>(attachmentKey(chat,id));
    if(!a||ready&&a.state!=='ready')throw fail('attachment_not_found','附件不存在或尚未上传完成');return a;
  }
  private async startUpload(chat:Conversation,args:Data,actor:Actor):Promise<Data>{
    const name=textValue(args.name,'name').replaceAll('\\','/').split('/').at(-1)!.trim();if(!name)throw fail('invalid_chat_argument','附件名称不能为空');
    const size=integer(args.size,'size'),mime_type=args.mime_type?textValue(args.mime_type,'mime_type'):'application/octet-stream';
    const expected=args.sha256===undefined?undefined:textValue(args.sha256,'sha256').toLowerCase();
    if(expected&&!/^[0-9a-f]{64}$/.test(expected))throw fail('invalid_chat_argument','sha256 格式不正确');
    const attachment=await this.store.transaction(async tx=>{
      await this.accounts.assertAccessIn(tx,actor,chat.device);
      const d=await this.dedupe(tx,chat.id+':upload',args.request_key,[name,size,mime_type,expected??null]);
      if(d.result){const a=await tx.get<Attachment>(attachmentKey(chat.id,d.result.id));if(!a)throw fail('upload_expired','上传已过期');return a;}
      const c=await tx.get<Conversation>(key(chat.id));if(!c)throw fail('chat_deleted','对话已删除');
      const a:Attachment={id:'a'+(++c.attachments),name,size,mime_type,offset:0,chunks:0,state:'uploading',expires_at:Date.now()+86_400_000,...(expected?{expected_sha256:expected}:{})};
      await tx.put({[key(chat.id)]:c,[attachmentKey(chat.id,a.id)]:a,[d.key]:{fingerprint:d.fingerprint,result:{id:a.id}}});return a;
    });if(attachment.expires_at)await this.env.schedule(attachment.expires_at);
    return {attachment,chunk_size:CHUNK};
  }
  private async writeUpload(chat:Conversation,args:Data,actor:Actor):Promise<Data>{
    const offset=integer(args.offset,'offset'),data=textValue(args.data,'data');let bytes:Uint8Array;
    try{bytes=from64(data);}catch{throw fail('invalid_chat_argument','附件分片不是有效 Base64');}
    if(!bytes.length||bytes.length>CHUNK||offset%CHUNK!==0)throw fail('invalid_chat_argument','分片必须按 chunk_size 对齐，且不可为空或超过 chunk_size');
    return this.store.transaction(async tx=>{
      await this.accounts.assertAccessIn(tx,actor,chat.device);
      if(!await tx.get(key(chat.id)))throw fail('chat_deleted','对话已删除');
      const a=await tx.get<Attachment>(attachmentKey(chat.id,args.attachment_id));
      if(!a||a.state!=='uploading')throw fail('upload_expired','上传不存在或已完成');
      if(offset+bytes.length>a.size||bytes.length<CHUNK&&offset+bytes.length!==a.size)throw fail('invalid_chat_argument','分片大小与附件大小不一致');
      const index=offset/CHUNK,checksum=hex(sha256(bytes)),hashKey=chunkKey(chat.id,a.id,index)+':hash';
      if(offset<a.offset){if(await tx.get<string>(hashKey)!==checksum)throw fail('upload_conflict','重复分片内容不同');return {offset,next_offset:a.offset};}
      if(offset!==a.offset)throw fail('upload_offset','分片不连续，下一偏移为 '+a.offset);
      if(this.env.blobs)await this.env.blobs.write(chat.id,a.id,index,bytes);else await tx.put(chunkKey(chat.id,a.id,index),to64(bytes));
      a.offset+=bytes.length;a.chunks++;a.expires_at=Date.now()+86_400_000;
      await tx.put({[attachmentKey(chat.id,a.id)]:a,[hashKey]:checksum});return {offset,next_offset:a.offset};
    });
  }
  private async chunk(chat:string,id:string,index:number):Promise<Uint8Array>{
    if(this.env.blobs)return this.env.blobs.read(chat,id,index);
    const raw=await this.store.get<string>(chunkKey(chat,id,index));if(raw===undefined)throw fail('attachment_incomplete','附件分片缺失');return from64(raw);
  }
  private async completeUpload(chat:Conversation,args:Data,actor:Actor):Promise<Data>{
    const a=await this.attachment(chat.id,args.attachment_id);if(a.state==='ready')return {attachment:{...viewAttachment(a),state:'ready'}};
    if(a.offset!==a.size)throw fail('upload_incomplete','附件尚未上传完整');
    const digest=sha256.create();let count=0;
    for(let index=0;index<a.chunks;index++){const bytes=await this.chunk(chat.id,a.id,index);count+=bytes.length;digest.update(bytes);}
    const checksum=hex(digest.digest());if(count!==a.size||a.expected_sha256&&checksum!==a.expected_sha256)throw fail('attachment_checksum','附件大小或 SHA256 校验不一致');
    await this.store.transaction(async tx=>{await this.accounts.assertAccessIn(tx,actor,chat.device);const current=await tx.get<Attachment>(attachmentKey(chat.id,a.id));if(!current)throw fail('upload_expired','上传已过期');current.sha256=checksum;current.state='ready';delete current.expires_at;delete current.expected_sha256;await tx.put(attachmentKey(chat.id,a.id),current);});
    return {attachment:{...viewAttachment({...a,sha256:checksum}),state:'ready'}};
  }
  private async bytes(chat:string,a:Attachment,offset:number,length:number):Promise<Uint8Array>{
    const end=Math.min(a.size,offset+length),parts:Uint8Array[]=[];let size=0;
    for(let index=Math.floor(offset/CHUNK);index<Math.ceil(end/CHUNK);index++){
      const chunk=await this.chunk(chat,a.id,index),start=Math.max(0,offset-index*CHUNK),stop=Math.min(chunk.length,end-index*CHUNK),part=chunk.subarray(start,stop);parts.push(part);size+=part.length;
    }
    const result=new Uint8Array(size);let pos=0;for(const part of parts){result.set(part,pos);pos+=part.length;}return result;
  }
  private async readAttachment(chat:Conversation,args:Data):Promise<Data>{
    const a=await this.attachment(chat.id,args.attachment_id,true),offset=integer(args.offset??0,'offset'),length=Math.min(integer(args.length??65536,'length',1),1048576);
    if(offset>a.size)throw fail('invalid_chat_argument','offset 超过附件大小');
    if(args.encoding&&args.encoding!=='base64'&&args.encoding!=='text')throw fail('invalid_chat_argument','encoding 必须是 base64 或 text');
    let bytes=await this.bytes(chat.id,a,offset,Math.min(length+(args.encoding==='text'?3:0),a.size-offset));
    if(args.encoding==='text'){
      let end=Math.min(length,bytes.length);
      if(offset+end<a.size){while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end++;}
      bytes=bytes.subarray(0,end);let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw fail('attachment_encoding','该范围不是完整 UTF-8 文本；原始字节请使用 base64');}
      return {attachment:viewAttachment(a),text,next_offset:offset+bytes.length,eof:offset+bytes.length>=a.size};
    }
    return {attachment:viewAttachment(a),data:to64(bytes),next_offset:offset+bytes.length,eof:offset+bytes.length>=a.size};
  }
  async download(chatId:string,id:string,actor:Actor):Promise<Response>{
    const chat=await this.chat(chatId,actor),a=await this.attachment(chat.id,id,true);let index=0;
    const stream=new ReadableStream<Uint8Array>({pull:async controller=>{
      try{await this.chat(chat.id,actor);if(index>=a.chunks){controller.close();return;}controller.enqueue(await this.chunk(chat.id,a.id,index++));}catch(e){controller.error(e);}
    }});
    return new Response(stream,{headers:{'Content-Type':a.mime_type,'Content-Length':String(a.size),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(a.name),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  private async erase(chat:Conversation):Promise<void>{
    const attachments=await this.store.transaction(async tx=>{
      const current=await tx.get<Conversation>(key(chat.id));if(!current)return [];
      const files=[...(await tx.list<Attachment>({prefix:'chat-attachment:'+chat.id+':'})).values()];
      const subscriptions=new Set<string>();
      for(const [k,sub] of await tx.list<Subscription>({prefix:'chat-subscription:'}))if(sub.chat===chat.id){subscriptions.add(sub.id);await tx.delete(k);}
      for(const [k,id] of await tx.list<string>({prefix:'chat-subscription-index:'}))if(subscriptions.has(id))await tx.delete(k);
      for(const [k,candidate] of await tx.list<Candidate>({prefix:'chat-candidate:'}))if(candidate.chat===chat.id)await tx.delete(k);
      for(const prefix of ['chat-message:','chat-attachment:','chat-chunk:','chat-event:','chat-request:','chat-import:'])await tx.delete([...(await tx.list({prefix:prefix+chat.id+':'})).keys()]);
      await tx.delete([key(chat.id),'chat-owner:'+chat.owner+':'+chat.id.slice(1).padStart(16,'0')]);
      return files;
    });
    // Deleting metadata first prevents a simultaneous uploader recreating a removed chunk folder.
    if(this.env.blobs)for(const a of attachments)await this.env.blobs.remove(chat.id,a.id);
  }
  async startLink(args:Data):Promise<Data>{
    const device=await this.store.get<Data>('device:'+textValue(args.device_id,'device_id'));
    if(!device||device.key_hash!==await hash(textValue(args.device_key,'device_key')))throw fail('device_unauthorized','电脑注册凭据无效');
    const id=secret(),poll=secret(),code=hex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();
    const link:Link={id,code,device:device.id,token_hash:await hash(poll),expires_at:Date.now()+600_000};
    await this.store.put({['chat-link:'+id]:link,['chat-link-code:'+code]:id});await this.env.schedule(link.expires_at);
    return {code,request_id:id,poll_token:poll,verification_url:this.env.publicUrl+'/chat/connect?code='+code,expires_at:link.expires_at};
  }
  private async link(code:string):Promise<Link>{
    const id=await this.store.get<string>('chat-link-code:'+code.toUpperCase()),link=id?await this.store.get<Link>('chat-link:'+id):undefined;
    if(!link||link.expires_at<=Date.now())throw fail('chat_link_expired','终端连接请求已过期');return link;
  }
  async linkDetails(code:string,actor:Actor):Promise<Data>{
    const link=await this.link(code);await this.accounts.assertAccess(actor,link.device);const d=await this.env.device(link.device,actor);return {device:{id:d.id,name:d.name,system:d.system},expires_at:link.expires_at,approved:!!link.approved_by};
  }
  async approveLink(code:string,actor:Actor):Promise<Data>{
    const link=await this.link(code);await this.accounts.assertAccess(actor,link.device);const token=secret();
    await this.store.transaction(async tx=>{
      await this.accounts.assertAccessIn(tx,actor,link.device);
      const current=await tx.get<Link>('chat-link:'+link.id);if(!current||current.expires_at<=Date.now())throw fail('chat_link_expired','终端连接请求已过期');
      if(current.approved_by){if(current.approved_by!==actor.id)throw fail('chat_link_claimed','终端已由其他账号连接');return;}
      current.approved_by=actor.id;current.epoch=actor.epoch;current.credential=token;
      await tx.put({['chat-link:'+link.id]:current,['chat-credential:'+await hash(token)]:{account:actor.id,epoch:actor.epoch,device:link.device} satisfies Credential});
    });return {approved:true,...await this.linkDetails(code,actor)};
  }
  async denyLink(code:string,actor:Actor):Promise<Data>{const link=await this.link(code);await this.accounts.assertAccess(actor,link.device);await this.store.put('chat-link-denied:'+link.id,link.expires_at);await this.store.delete(['chat-link:'+link.id,'chat-link-code:'+link.code]);return {denied:true};}
  async pollLink(args:Data):Promise<Data>{
    if(await this.store.get('chat-link-denied:'+args.request_id))return {state:'denied'};
    const link=await this.store.get<Link>('chat-link:'+args.request_id);
    if(!link||link.expires_at<=Date.now())return {state:'expired'};
    if(link.token_hash!==await hash(textValue(args.poll_token,'poll_token')))throw fail('chat_link_unauthorized','终端连接凭据无效');
    if(!link.approved_by)return {state:'pending'};
    const actor=await this.accounts.require(link.approved_by,link.epoch);await this.accounts.assertAccess(actor,link.device);const d=await this.env.device(link.device,actor);
    return {state:'approved',credential:link.credential,device:{id:d.id,name:d.name,system:d.system},account:{id:actor.id,username:actor.username}};
  }
  async authenticateCredential(token:string):Promise<{actor:Actor;device_id:string;raw_device:string}>{
    const credential=await this.store.get<Credential>('chat-credential:'+await hash(token));if(!credential)throw fail('chat_credential_invalid','终端登录已失效，请重新连接');
    const actor=await this.accounts.require(credential.account,credential.epoch);await this.accounts.assertAccess(actor,credential.device);const d=await this.env.device(credential.device,actor);return {actor,device_id:d.id,raw_device:d.raw};
  }
  async events(method:'list'|'subscribe'|'unsubscribe',args:Data,actor:Actor,caller:string):Promise<Data>{
    await this.accounts.require(actor.id,actor.epoch);
    if(method==='list')return {events:[chatEventDefinition]};
    if(args.name!==chatEventDefinition.name||args.delivery?.mode!=='webhook')throw fail('invalid_event','只支持 chat.message 的 webhook 订阅');
    const input=args.arguments;if(!input||Object.keys(input).some(k=>!['chat_id','connection'].includes(k))||typeof input.connection!=='string')throw fail('invalid_event','订阅需要 chat_id 和 connection');
    const chat=await this.chat(textValue(input.chat_id,'chat_id'),actor),connectionHash=await hash(input.connection);
    const url=textValue(args.delivery.url,'delivery.url'),parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw fail('invalid_callback','回调必须是无凭据的 HTTPS 地址');
    const index='chat-subscription-index:'+await hash(JSON.stringify([actor.id,caller,url,chatEventDefinition.name,{chat_id:chat.id,connection:input.connection}]));
    if(method==='unsubscribe'){
      const id=await this.store.get<string>(index);
      if(id){const sub=await this.store.get<Subscription>(subKey(id));if(sub&&sub.account===actor.id&&sub.caller===caller&&sub.connection_hash===connectionHash&&sub.url===url)await this.release(chat.id,id);}
      await this.store.delete('chat-candidate:'+connectionHash);return {};
    }
    const signingKey=textValue(args.delivery.secret,'delivery.secret');let decoded:Uint8Array;
    try{if(!signingKey.startsWith('whsec_'))throw Error();decoded=from64(signingKey.slice(6));}catch{throw fail('invalid_event_secret','签名密钥格式不正确');}
    if(decoded.length<24||decoded.length>64)throw fail('invalid_event_secret','签名密钥必须为 24 至 64 字节');
    let existing:Subscription|undefined;
    if(chat.active){existing=await this.connection(chat,input.connection,actor,caller);if(existing.url!==url)throw fail('chat_in_use','该对话正在被使用');}
    else{
      const candidate=await this.store.get<Candidate>('chat-candidate:'+connectionHash);
      if(!candidate||candidate.chat!==chat.id||candidate.account!==actor.id||candidate.epoch!==actor.epoch||candidate.caller!==caller||candidate.expires_at<=Date.now())throw fail('connection_expired','请先使用 chat.resume 获取连接凭据');
    }
    const ttl=args.ttlMs===null?null:args.ttlMs===undefined?86_400_000:integer(args.ttlMs,'ttlMs',1);
    const expires_at=ttl===null?null:Date.now()+ttl;
    const cursor=args.cursor===undefined||args.cursor===null?(existing?.cursor??0):cursorOf(args.cursor);
    if(cursor>chat.sequence)throw fail('invalid_event_cursor','事件游标超过现有消息');
    const id=await this.store.transaction(async tx=>{const previous=await tx.get<string>(index);if(previous)return previous;const value='v'+await this.next(tx,'chat-subscription');await tx.put(index,value);return value;});
    if(!existing||existing.verified_at<Date.now()-300_000)await this.verify(url,signingKey,id);
    const saved=await this.store.transaction(async tx=>{
      await this.accounts.assertAccessIn(tx,actor,chat.device);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_not_found','对话已删除');
      if(current.active&&current.active!==id)throw fail('chat_in_use','该对话正在被使用');
      const candidate=await tx.get<Candidate>('chat-candidate:'+connectionHash);
      const previous=await tx.get<Subscription>(subKey(id));
      if(!previous&&(!candidate||candidate.expires_at<=Date.now()))throw fail('connection_expired','连接请求已取消或过期');
      const sub:Subscription={id,chat:chat.id,account:actor.id,epoch:actor.epoch,caller,connection_hash:connectionHash,url,secret:signingKey,expires_at,cursor:Math.min(previous?.cursor??cursor,cursor),verified_at:Date.now()};
      if(previous&&previous.secret!==signingKey){sub.previous_secret=previous.secret;sub.rotation_until=Date.now()+60_000;}
      else if(previous?.rotation_until&&previous.rotation_until>Date.now()){sub.previous_secret=previous.previous_secret;sub.rotation_until=previous.rotation_until;}
      current.active=id;await tx.put({[subKey(id)]:sub,[key(chat.id)]:current});
      await tx.delete('chat-candidate:'+connectionHash);return sub;
    });
    let next=cursor;
    for(;;){
      const rows=await this.store.list<Message>({prefix:'chat-message:'+chat.id+':',startAfter:messageKey(chat.id,next),limit:100});
      if(!rows.size)break;
      await this.store.transaction(async tx=>{
        const current=await tx.get<Conversation>(key(chat.id));if(current?.active!==id)return;
        for(const message of rows.values())if(message.role==='user'&&message.delivery!=='replied'){
          const old=await tx.get<Outbox>(outboxKey(chat.id,message.sequence));
          if(!old||old.subscription!==id||old.state==='failed'||message.sequence>cursor&&old.state==='delivered')await tx.put(outboxKey(chat.id,message.sequence),{chat:chat.id,sequence:message.sequence,subscription:id,attempts:0,next_at:Date.now(),state:'pending'} satisfies Outbox);
        }
      });next=[...rows.values()].at(-1)!.sequence;if(rows.size<100)break;
    }
    await this.env.schedule(Date.now());return {id,refreshBefore:expires_at===null?null:new Date(expires_at).toISOString(),cursor:saved.cursor?'m'+saved.cursor:null,truncated:false};
  }
  private signed(sub:Pick<Subscription,'id'|'url'|'secret'|'previous_secret'|'rotation_until'>,event:Data):Promise<Response>{
    const body=JSON.stringify(event),id=String(event.eventId??'verify-'+secret()),date=new Date();
    if(new TextEncoder().encode(body).length>262144)throw fail('event_too_large','事件超过 256 KiB');
    let signature=new Webhook(sub.secret).sign(id,date,body);
    if(sub.previous_secret&&sub.rotation_until!>Date.now())signature+=' '+new Webhook(sub.previous_secret).sign(id,date,body);
    return this.env.webhookFetch(sub.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(date.getTime()/1000)),'webhook-signature':signature,'X-MCP-Subscription-Id':sub.id},body});
  }
  private async verify(url:string,signingKey:string,id:string):Promise<void>{
    const challenge=secret();let response:Response|undefined;
    try{
      response=await this.signed({url,secret:signingKey,id},{type:'verification',challenge});
      if(!response.ok)throw Object.assign(Error('Callback rejected'),{reason:'challenge_failed'});
      const reader=response.body?.getReader();if(!reader)throw Error('Empty verification');let bytes=new Uint8Array();
      try{for(;;){const part=await reader.read();if(part.done)break;if(bytes.length+part.value.length>4096)throw Error('Verification response too large');const merged=new Uint8Array(bytes.length+part.value.length);merged.set(bytes);merged.set(part.value,bytes.length);bytes=merged;}}finally{await reader.cancel();}
      const received=JSON.parse(new TextDecoder().decode(bytes)).challenge;
      if(typeof received!=='string'||!this.env.equal(new TextEncoder().encode(received),new TextEncoder().encode(challenge)))throw Error('Challenge mismatch');
    }catch(error){
      if(response?.body&&!response.body.locked)await response.body.cancel();
      throw Object.assign(new Error('无法验证事件回调地址'),{code:-32015,data:{reason:(error as Error).name==='TimeoutError'?'timeout':(error as Data).reason||'challenge_failed'}});
    }
  }
  private async release(chat:string,id:string):Promise<void>{
    await this.store.transaction(async tx=>{
      const current=await tx.get<Conversation>(key(chat));if(current?.active===id){delete current.active;await tx.put(key(chat),current);}
      await tx.delete(subKey(id));
      for(const [k,event] of await tx.list<Outbox>({prefix:'chat-event:'+chat+':'}))if(event.subscription===id&&event.state==='pending')await tx.delete(k);
    });
  }
  async revoke(account:string,device?:string):Promise<void>{
    for(const sub of (await this.store.list<Subscription>({prefix:'chat-subscription:'})).values()){
      const chat=await this.store.get<Conversation>(key(sub.chat));if(sub.account===account&&(!device||chat?.device===device))await this.release(sub.chat,sub.id);
    }
  }
  private async deliver(event:Outbox):Promise<void>{
    const sub=await this.store.get<Subscription>(subKey(event.subscription));
    if(!sub){await this.store.delete(outboxKey(event.chat,event.sequence));return;}
    let chat:Conversation;
    try{const actor=await this.accounts.require(sub.account,sub.epoch);chat=await this.chat(sub.chat,actor);if(chat.active!==sub.id)return;}
    catch{await this.release(sub.chat,sub.id);return;}
    const message=await this.store.get<Message>(messageKey(event.chat,event.sequence));
    if(!message){await this.store.delete(outboxKey(event.chat,event.sequence));return;}
    const claimed=await this.store.transaction(async tx=>{const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));if(!current||current.state!=='pending'||current.next_at>Date.now())return false;current.next_at=Date.now()+20_000;await tx.put(outboxKey(event.chat,event.sequence),current);return true;});
    if(!claimed)return;
    const preceding=[...(await this.store.list<Outbox>({prefix:'chat-event:'+chat.id+':'})).values()].filter(e=>e.subscription===sub.id&&e.sequence<message.sequence&&e.state!=='delivered');
    const safeCursor=preceding.length?Math.min(...preceding.map(e=>e.sequence))-1:message.sequence;
    const envelope={eventId:chat.id+'-'+message.id,name:chatEventDefinition.name,timestamp:message.created_at,data:{chat_id:chat.id,device_id:chat.device_id,message_id:message.id,text:message.text.slice(0,16384),text_truncated:message.text.length>16384,attachments:message.attachments,url:this.env.publicUrl+'/chat?id='+chat.id},cursor:safeCursor?'m'+safeCursor:null};
    let status=0,error:string|undefined;
    try{const response=await this.signed(sub,envelope);status=response.status;await response.body?.cancel();}catch(e){error=(e as Data).code==='invalid_callback'?'callback_address':'network';}
    await this.store.transaction(async tx=>{
      const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));const live=await tx.get<Subscription>(subKey(sub.id));const c=await tx.get<Conversation>(key(event.chat));
      if(!current||current.subscription!==sub.id||!live||c?.active!==sub.id)return;
      current.attempts++;
      const m=await tx.get<Message>(messageKey(event.chat,event.sequence));
      if(status>=200&&status<300){current.state='delivered';const outstanding=[...(await tx.list<Outbox>({prefix:'chat-event:'+event.chat+':'})).values()].filter(e=>e.subscription===sub.id&&e.sequence<event.sequence&&e.state!=='delivered');live.cursor=outstanding.length?Math.min(...outstanding.map(e=>e.sequence))-1:event.sequence;if(m&&m.delivery!=='replied'){m.delivery='delivered';await tx.put(messageKey(event.chat,event.sequence),m);}await tx.put(subKey(sub.id),live);}
      else if(status===410||status===413||status>=400&&status<500&&status!==408&&status!==429||current.attempts>=8){current.state='failed';current.error=status?'http_'+status:error;if(m&&m.delivery!=='replied'){m.delivery='failed';await tx.put(messageKey(event.chat,event.sequence),m);}}
      else{current.next_at=Date.now()+Math.min(300_000,1000*2**(current.attempts-1));current.error=status?'http_'+status:error;}
      await tx.put(outboxKey(event.chat,event.sequence),current);
    });
    if(status===410)await this.release(chat.id,sub.id);
  }
  async nextAlarm():Promise<number|undefined>{
    const deadlines:number[]=[];
    for(const s of (await this.store.list<Subscription>({prefix:'chat-subscription:'})).values())if(s.expires_at!==null)deadlines.push(s.expires_at);
    const firstByChat=new Map<string,Outbox>();
    for(const event of (await this.store.list<Outbox>({prefix:'chat-event:'})).values())if(event.state==='pending'&&!firstByChat.has(event.chat))firstByChat.set(event.chat,event);
    for(const event of firstByChat.values())if(event.state==='pending')deadlines.push(event.next_at);
    for(const a of (await this.store.list<Attachment>({prefix:'chat-attachment:'})).values())if(a.expires_at)deadlines.push(a.expires_at);
    for(const l of (await this.store.list<Link>({prefix:'chat-link:'})).values())deadlines.push(l.expires_at);
    for(const c of (await this.store.list<Candidate>({prefix:'chat-candidate:'})).values())deadlines.push(c.expires_at);
    return deadlines.length?Math.min(...deadlines):undefined;
  }
  async alarm():Promise<void>{
    if(this.running)return;this.running=true;
    try{
      for(const sub of (await this.store.list<Subscription>({prefix:'chat-subscription:'})).values())if(sub.expires_at!==null&&sub.expires_at<=Date.now())await this.release(sub.chat,sub.id);
      for(const [k,c] of await this.store.list<Candidate>({prefix:'chat-candidate:'}))if(c.expires_at<=Date.now())await this.store.delete(k);
      for(const [k,l] of await this.store.list<Link>({prefix:'chat-link:'}))if(l.expires_at<=Date.now())await this.store.delete([k,'chat-link-code:'+l.code]);
      for(const [k,t] of await this.store.list<number>({prefix:'chat-link-denied:'}))if(t<=Date.now())await this.store.delete(k);
      for(const [k,a] of await this.store.list<Attachment>({prefix:'chat-attachment:'}))if(a.expires_at&&a.expires_at<=Date.now()){
        const chat=k.split(':')[1];if(this.env.blobs)await this.env.blobs.remove(chat,a.id);
        await this.store.delete([k,...(await this.store.list({prefix:'chat-chunk:'+chat+':'+a.id+':'})).keys()]);
      }
      const firstByChat=new Map<string,Outbox>();
      for(const event of (await this.store.list<Outbox>({prefix:'chat-event:'})).values())if(event.state==='pending'&&!firstByChat.has(event.chat))firstByChat.set(event.chat,event);
      const due=[...firstByChat.values()].filter(e=>e.state==='pending'&&e.next_at<=Date.now());
      await Promise.all(due.slice(0,8).map(e=>this.deliver(e)));
    }finally{this.running=false;const next=await this.nextAlarm();if(next!==undefined)await this.env.schedule(next);}
  }
}
