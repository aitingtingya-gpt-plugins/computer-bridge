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
  changed?(chatId:string):Promise<void>;
  background?(work:Promise<unknown>):void;
}
interface Conversation {id:string;owner:string;device:string;device_id:string;title:string;created_at:string;updated_at:string;sequence:number;attachments:number;active?:string;revision?:number}
interface Message {id:string;sequence:number;role:'user'|'assistant';source:'web'|'tui'|'model';text:string;attachments:AttachmentView[];created_at:string;delivery:'pending'|'delivered'|'replied'|'failed'|'none';reply_to?:string}
interface AttachmentView {id:string;name:string;size:number;mime_type:string;sha256?:string}
interface Attachment extends AttachmentView {offset:number;chunks:number;state:'uploading'|'ready';expires_at?:number;expected_sha256?:string}
interface Candidate {chat:string;account:string;epoch:number;caller:string;expires_at:number}
interface Subscription {id:string;chat:string;account:string;epoch:number;caller:string;connection_hash:string;url:string;secret:string;previous_secret?:string;rotation_until?:number;expires_at:number|null;cursor:number;verified_at:number}
interface Outbox {chat:string;sequence:number;subscription:string;attempts:number;next_at:number;state:'pending'|'delivered'|'failed';error?:string}
interface Link {id:string;code:string;device:string;token_hash:string;expires_at:number;approved_by?:string;epoch?:number;credential?:string}
interface Credential {account:string;epoch:number;device:string}
interface Timing {saved_at:string;first_attempt_at?:string;host_accepted_at?:string;reply_saved_at?:string;attempts:number}
interface Head {chat:string;sequence:number;at:number}
interface Expiry {kind:string;id:string;at:number}
const padded=(n:number)=>String(n).padStart(16,'0');
const changeKey=(chat:string,revision:number)=>'chat-change:'+chat+':'+padded(revision);
const pendingKey=(chat:string,sequence:number)=>'chat-pending:'+chat+':'+padded(sequence);
const unackKey=(chat:string,subscription:string,sequence:number)=>'chat-unack:'+chat+':'+subscription+':'+padded(sequence);
const dueKey=(head:Head)=>'chat-due:'+padded(head.at)+':'+head.chat;
const timingKey=(chat:string,sequence:number)=>'chat-timing:'+chat+':'+padded(sequence);
const expiryKey=(expiry:Expiry)=>'chat-expiry:'+padded(expiry.at)+':'+expiry.kind+':'+expiry.id;
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
  name:'chat.message',description:'A person sent a message or attachment to a Computer Bridge conversation. Available for Work and dots. After connecting, read chat.history once for context. For a complete event with sufficient context, answer directly with chat.reply; read history or attachments only when needed. Other computer tools remain available. Model replies do not create this event.',delivery:['webhook'],
  inputSchema:{type:'object',properties:{chat_id:{type:'string',description:'Stable short conversation ID, e.g. t1.'},connection:{type:'string',description:'Connection credential returned by chat.resume.'}},required:['chat_id','connection'],additionalProperties:false},
  payloadSchema:{type:'object',properties:{chat_id:{type:'string'},device_id:{type:'string'},message_id:{type:'string'},text:{type:'string'},text_truncated:{type:'boolean'},attachments:{type:'array',items:{type:'object'}},url:{type:'string'}},required:['chat_id','device_id','message_id','text','text_truncated','attachments','url'],additionalProperties:false}
};

export class ChatService {
  private initialized?:Promise<void>;
  private pumping?:Promise<void>;
  private wake?:()=>void;
  private wakeVersion=0;
  constructor(private store:Store,private accounts:Accounts,private env:ChatEnvironment){}

  private async changed(chat:string):Promise<void>{await this.env.changed?.(chat);}
  private async recordChange(tx:KeyStore,chat:Conversation,sequences:number[]=[]):Promise<void>{
    chat.revision=(chat.revision??0)+1;
    await tx.put({[key(chat.id)]:chat,[changeKey(chat.id,chat.revision)]:{sequences}});
  }
  private async expiry(tx:KeyStore,kind:string,id:string,at?:number|null):Promise<void>{
    const ref='chat-expiry-ref:'+kind+':'+id,old=await tx.get<Expiry>(ref);
    if(old)await tx.delete(expiryKey(old));
    if(at!==undefined&&at!==null){const value={kind,id,at};await tx.put({[ref]:value,[expiryKey(value)]:value});}
    else await tx.delete(ref);
  }
  private async refreshHead(tx:KeyStore,chat:string):Promise<void>{
    const ref='chat-head:'+chat,previous=await tx.get<Head>(ref);
    if(previous)await tx.delete(dueKey(previous));
    const first=[...(await tx.list<number>({prefix:'chat-pending:'+chat+':',limit:1})).values()][0];
    if(first===undefined){await tx.delete(ref);return;}
    const event=(await tx.get<Outbox>(outboxKey(chat,first)))!;
    const head={chat,sequence:first,at:event.next_at};await tx.put({[ref]:head,[dueKey(head)]:head});
  }
  private async saveEvent(tx:KeyStore,event:Outbox):Promise<void>{
    const old=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));
    if(old&&old.subscription!==event.subscription)await tx.delete(unackKey(event.chat,old.subscription,event.sequence));
    await tx.put(outboxKey(event.chat,event.sequence),event);
    if(event.state==='pending')await tx.put(pendingKey(event.chat,event.sequence),event.sequence);
    else await tx.delete(pendingKey(event.chat,event.sequence));
    if(event.state==='delivered')await tx.delete(unackKey(event.chat,event.subscription,event.sequence));
    else await tx.put(unackKey(event.chat,event.subscription,event.sequence),event.sequence);
    await this.refreshHead(tx,event.chat);
  }
  private async dropEvent(tx:KeyStore,event:Outbox):Promise<void>{
    const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));
    if(!current||current.subscription!==event.subscription)return;
    await tx.delete([outboxKey(event.chat,event.sequence),pendingKey(event.chat,event.sequence),unackKey(event.chat,event.subscription,event.sequence)]);
    await this.refreshHead(tx,event.chat);
  }
  private initialize():Promise<void>{
    return this.initialized??=this.store.transaction(async tx=>{
      if(await tx.get('chat:index-v2'))return;
      for(const event of (await tx.list<Outbox>({prefix:'chat-event:'})).values())await this.saveEvent(tx,event);
      for(const sub of (await tx.list<Subscription>({prefix:'chat-subscription:'})).values())await this.expiry(tx,'subscription',sub.id,sub.expires_at);
      for(const [k,a] of await tx.list<Attachment>({prefix:'chat-attachment:'}))if(a.expires_at)await this.expiry(tx,'upload',k.slice('chat-attachment:'.length),a.expires_at);
      for(const [k,c] of await tx.list<Candidate>({prefix:'chat-candidate:'}))await this.expiry(tx,'candidate',k.slice('chat-candidate:'.length),c.expires_at);
      for(const l of (await tx.list<Link>({prefix:'chat-link:'})).values())await this.expiry(tx,'link',l.id,l.expires_at);
      for(const [k,at] of await tx.list<number>({prefix:'chat-link-denied:'}))await this.expiry(tx,'denied',k.slice('chat-link-denied:'.length),at);
      await tx.put('chat:index-v2',true);
    });
  }
  private async kick():Promise<void>{
    await this.env.schedule(Date.now());
    this.wakeVersion++;this.wake?.();
    const work=this.drain().catch(error=>{console.error('chat_delivery',error instanceof Error?error.name:'Error');});
    if(this.env.background)this.env.background(work);else void work;
  }
  private async sync(chat:Conversation,args:Data,actor:Actor):Promise<Data>{
    const after=integer(args.cursor??0,'cursor'),limit=Math.min(limitOf(args.limit),50);
    const snapshot=await this.store.transaction(async tx=>{
      const current=(await tx.get<Conversation>(key(chat.id)))!;
      if(!current.revision)await this.recordChange(tx,current);
      if(after>current.revision!)throw fail('invalid_chat_cursor','同步游标超过当前对话版本');
      let cursor=current.revision!,more=false,messages:Message[];
      if(!after)messages=[...(await tx.list<Message>({prefix:'chat-message:'+chat.id+':',reverse:true,limit})).values()].reverse();
      else{
        const rows=await tx.list<{sequences:number[]}>({prefix:'chat-change:'+chat.id+':',startAfter:changeKey(chat.id,after),limit:limit+1});
        more=rows.size>limit;const changes=[...rows.entries()].slice(0,limit);
        cursor=changes.length?Number(changes.at(-1)![0].split(':').at(-1)):after;
        const ids=new Set(changes.flatMap(([,change])=>change.sequences));messages=[];
        for(const sequence of [...ids].sort((a,b)=>a-b)){const m=await tx.get<Message>(messageKey(chat.id,sequence));if(m)messages.push(m);}
      }
      return {current,messages,cursor,more};
    });
    const first=snapshot.messages[0]?.sequence??0;
    return {chat:await this.summary(snapshot.current,actor),messages:snapshot.messages,cursor:snapshot.cursor,more:snapshot.more,...(!after?{first_cursor:first,has_older:first>1}:{})};
  }
  private async timing(chat:Conversation,args:Data):Promise<Data>{
    let sequence:number;
    if(args.message_id!==undefined)sequence=cursorOf(args.message_id);
    else{
      let before:number|undefined;
      for(;;){const rows=[...(await this.store.list<Message>({prefix:'chat-message:'+chat.id+':',reverse:true,limit:50,...(before?{endBefore:messageKey(chat.id,before)}:{})})).values()];
        const found=rows.find(m=>m.role==='user');if(found){sequence=found.sequence;break;}if(rows.length<50)return {chat_id:chat.id,timings:[]};before=rows.at(-1)!.sequence;}
    }
    const message=await this.store.get<Message>(messageKey(chat.id,sequence));if(!message)throw fail('message_not_found','消息不存在');
    const t=await this.store.get<Timing>(timingKey(chat.id,sequence))??{saved_at:message.created_at,attempts:0};
    const diff=(a?:string,b?:string)=>a&&b?Date.parse(b)-Date.parse(a):null;
    return {chat_id:chat.id,timings:[{message_id:message.id,...t,first_attempt_at:t.first_attempt_at??null,host_accepted_at:t.host_accepted_at??null,reply_saved_at:t.reply_saved_at??null,
      save_to_first_attempt_ms:diff(t.saved_at,t.first_attempt_at),first_attempt_to_host_accept_ms:diff(t.first_attempt_at,t.host_accepted_at),host_accept_to_reply_ms:diff(t.host_accepted_at,t.reply_saved_at)}]};
  }
  private async chat(id:string,actor:Actor):Promise<Conversation>{
    await this.accounts.require(actor.id,actor.epoch);
    const value=await this.store.get<Conversation>(key(id));
    if(!value||value.owner!==actor.id)throw fail('chat_not_found','对话不存在或不属于当前账号');
    await this.accounts.assertAccess(actor,value.device);
    await this.env.device(value.device,actor);
    if(value.active){
      const sub=await this.store.get<Subscription>(subKey(value.active));
      if(!sub||sub.epoch!==actor.epoch||sub.expires_at!==null&&sub.expires_at<=Date.now()){
        const inspected=await this.store.transaction(async tx=>{
          const current=await tx.get<Conversation>(key(id));
          if(!current||current.owner!==actor.id)throw fail('chat_not_found','对话不存在或不属于当前账号');
          await this.accounts.assertAccessIn(tx,actor,current.device);
          const live=current.active?await tx.get<Subscription>(subKey(current.active)):undefined;
          if(current.active&&(!live||live.epoch!==actor.epoch||live.expires_at!==null&&live.expires_at<=Date.now())){
            await this.releaseIn(tx,current.id,current.active);
            return {current:(await tx.get<Conversation>(key(id)))!,released:true};
          }
          return {current,released:false};
        });
        if(inspected.released)await this.changed(id);return inspected.current;
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
    await this.accounts.require(actor.id,actor.epoch);await this.initialize();
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
    if(action==='sync')return this.sync(chat,args,actor);
    if(action==='timing')return this.timing(chat,args);
    if(action==='rename'){
      const title=textValue(args.title,'title').trim();if(!title)throw fail('invalid_chat_argument','标题不能为空');
      const updated=await this.store.transaction(async tx=>{await this.accounts.assertAccessIn(tx,actor,chat.device);const c=await tx.get<Conversation>(key(chat.id));if(!c)throw fail('chat_deleted','对话已删除');c.title=title;c.updated_at=now();await this.recordChange(tx,c);return c;});
      await this.changed(chat.id);return {chat:await this.summary(updated,actor)};
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
    else {connection=secret();const candidateId=await hash(connection),expires=Date.now()+600_000;await this.store.transaction(async tx=>{await tx.put('chat-candidate:'+candidateId,{chat:chat.id,account:actor.id,epoch:actor.epoch,caller,expires_at:expires} satisfies Candidate);await this.expiry(tx,'candidate',candidateId,expires);});await this.env.schedule(expires);}
    return {chat:await this.summary(chat,actor),connection,subscribed:false,next_step:'Use the host event-monitoring/task capability to subscribe to chat.message with these arguments. events/subscribe is an MCP protocol method, not an ordinary tool. Wait for successful subscription before chat.reply.',event:{name:chatEventDefinition.name,arguments:{chat_id:chat.id,connection}},history:{chat_id:chat.id}};
  }
  private async connection(chat:Conversation,connection:unknown,actor:Actor,caller:string):Promise<Subscription>{
    const sub=chat.active?await this.store.get<Subscription>(subKey(chat.active)):undefined;
    if(!sub)throw fail('chat_not_connected','对话等待宿主订阅：先 chat.resume，再由 Work/Dot 的事件任务订阅返回的 chat.message，订阅成功后才能 chat.reply；事件订阅不是普通工具。');
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
        old.delivery='replied';await tx.put(messageKey(chat.id,seq),old);const timing=await tx.get<Timing>(timingKey(chat.id,seq))??{saved_at:old.created_at,attempts:0};timing.reply_saved_at=m.created_at;await tx.put(timingKey(chat.id,seq),timing);
      }
      await tx.put({[key(chat.id)]:current,[messageKey(chat.id,sequence)]:m,[d.key]:{fingerprint:d.fingerprint,result:{sequence}}});
      await tx.put(timingKey(chat.id,sequence),{saved_at:m.created_at,attempts:0} satisfies Timing);
      await this.recordChange(tx,current,[sequence,...(model&&args.reply_to?[cursorOf(args.reply_to)]:[])]);
      if(!model&&current.active)await this.saveEvent(tx,{chat:chat.id,sequence,subscription:current.active,attempts:0,next_at:Date.now(),state:'pending'});
      return m;
    });
    await this.changed(chat.id);if(!model)await this.kick();
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
      await tx.put({[key(chat.id)]:c,[attachmentKey(chat.id,a.id)]:a,[d.key]:{fingerprint:d.fingerprint,result:{id:a.id}}});await this.expiry(tx,'upload',chat.id+':'+a.id,a.expires_at);return a;
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
      await tx.put({[attachmentKey(chat.id,a.id)]:a,[hashKey]:checksum});await this.expiry(tx,'upload',chat.id+':'+a.id,a.expires_at);return {offset,next_offset:a.offset};
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
    await this.store.transaction(async tx=>{await this.accounts.assertAccessIn(tx,actor,chat.device);const current=await tx.get<Attachment>(attachmentKey(chat.id,a.id));if(!current)throw fail('upload_expired','上传已过期');current.sha256=checksum;current.state='ready';delete current.expires_at;delete current.expected_sha256;await tx.put(attachmentKey(chat.id,a.id),current);await this.expiry(tx,'upload',chat.id+':'+a.id);});
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
      for(const [k,sub] of await tx.list<Subscription>({prefix:'chat-subscription:'}))if(sub.chat===chat.id){subscriptions.add(sub.id);await tx.delete(k);await this.expiry(tx,'subscription',sub.id);}
      for(const [k,id] of await tx.list<string>({prefix:'chat-subscription-index:'}))if(subscriptions.has(id))await tx.delete(k);
      for(const [k,candidate] of await tx.list<Candidate>({prefix:'chat-candidate:'}))if(candidate.chat===chat.id){await tx.delete(k);await this.expiry(tx,'candidate',k.slice('chat-candidate:'.length));}
      for(const a of files)await this.expiry(tx,'upload',chat.id+':'+a.id);
      const head=await tx.get<Head>('chat-head:'+chat.id);if(head)await tx.delete([dueKey(head),'chat-head:'+chat.id]);
      for(const prefix of ['chat-change:','chat-timing:','chat-pending:','chat-unack:','chat-message:','chat-attachment:','chat-chunk:','chat-event:','chat-request:','chat-import:'])await tx.delete([...(await tx.list({prefix:prefix+chat.id+':'})).keys()]);
      await tx.delete([key(chat.id),'chat-owner:'+chat.owner+':'+chat.id.slice(1).padStart(16,'0')]);
      return files;
    });
    // Deleting metadata first prevents a simultaneous uploader recreating a removed chunk folder.
    if(this.env.blobs)for(const a of attachments)await this.env.blobs.remove(chat.id,a.id);await this.changed(chat.id);
  }
  async startLink(args:Data):Promise<Data>{
    await this.initialize();
    const device=await this.store.get<Data>('device:'+textValue(args.device_id,'device_id'));
    if(!device||device.key_hash!==await hash(textValue(args.device_key,'device_key')))throw fail('device_unauthorized','电脑注册凭据无效');
    const id=secret(),poll=secret(),code=hex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();
    const link:Link={id,code,device:device.id,token_hash:await hash(poll),expires_at:Date.now()+600_000};
    await this.store.transaction(async tx=>{await tx.put({['chat-link:'+id]:link,['chat-link-code:'+code]:id});await this.expiry(tx,'link',id,link.expires_at);});await this.env.schedule(link.expires_at);
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
  async denyLink(code:string,actor:Actor):Promise<Data>{const link=await this.link(code);await this.accounts.assertAccess(actor,link.device);await this.store.transaction(async tx=>{await tx.put('chat-link-denied:'+link.id,link.expires_at);await tx.delete(['chat-link:'+link.id,'chat-link-code:'+link.code]);await this.expiry(tx,'link',link.id);await this.expiry(tx,'denied',link.id,link.expires_at);});return {denied:true};}
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
    await this.accounts.require(actor.id,actor.epoch);await this.initialize();
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
      await this.store.transaction(async tx=>{await tx.delete('chat-candidate:'+connectionHash);await this.expiry(tx,'candidate',connectionHash);});return {};
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
      current.active=id;await tx.put(subKey(id),sub);await this.recordChange(tx,current);
      await this.expiry(tx,'subscription',id,expires_at);await this.expiry(tx,'candidate',connectionHash);
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
          if(!old||old.subscription!==id||old.state==='failed'||message.sequence>cursor&&old.state==='delivered')await this.saveEvent(tx,{chat:chat.id,sequence:message.sequence,subscription:id,attempts:0,next_at:Date.now(),state:'pending'});
        }
      });next=[...rows.values()].at(-1)!.sequence;if(rows.size<100)break;
    }
    await this.changed(chat.id);await this.kick();return {id,refreshBefore:expires_at===null?null:new Date(expires_at).toISOString(),cursor:saved.cursor?'m'+saved.cursor:null,truncated:false};
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
  private async releaseIn(tx:KeyStore,chat:string,id:string):Promise<void>{
    const current=await tx.get<Conversation>(key(chat));if(current?.active===id){delete current.active;await this.recordChange(tx,current);}
    await tx.delete(subKey(id));await this.expiry(tx,'subscription',id);
    for(const seq of (await tx.list<number>({prefix:'chat-pending:'+chat+':'})).values()){
      const event=await tx.get<Outbox>(outboxKey(chat,seq));if(event?.subscription===id)await this.dropEvent(tx,event);
    }
  }
  private async release(chat:string,id:string,expiresAt?:number):Promise<void>{
    const released=await this.store.transaction(async tx=>{
      if(expiresAt!==undefined){const sub=await tx.get<Subscription>(subKey(id));if(!sub||sub.expires_at!==expiresAt||expiresAt>Date.now())return false;}
      await this.releaseIn(tx,chat,id);return true;
    });if(released)await this.changed(chat);
  }
  async revoke(account:string,device?:string):Promise<void>{
    await this.initialize();
    for(const sub of (await this.store.list<Subscription>({prefix:'chat-subscription:'})).values()){
      const chat=await this.store.get<Conversation>(key(sub.chat));if(sub.account===account&&(!device||chat?.device===device))await this.release(sub.chat,sub.id);
    }
  }
  private async safeCursor(tx:KeyStore,chat:string,subscription:string,sequence:number):Promise<number>{
    const first=[...(await tx.list<number>({prefix:'chat-unack:'+chat+':'+subscription+':',endBefore:unackKey(chat,subscription,sequence),limit:1})).values()][0];
    return first===undefined?sequence:first-1;
  }
  private async deliver(event:Outbox):Promise<void>{
    const sub=await this.store.get<Subscription>(subKey(event.subscription));
    if(!sub){await this.store.transaction(tx=>this.dropEvent(tx,event));return;}
    let chat:Conversation;
    try{const actor=await this.accounts.require(sub.account,sub.epoch);chat=await this.chat(sub.chat,actor);if(chat.active!==sub.id){await this.store.transaction(tx=>this.dropEvent(tx,event));return;}}
    catch{await this.release(sub.chat,sub.id);return;}
    const message=await this.store.get<Message>(messageKey(event.chat,event.sequence));
    if(!message){await this.store.transaction(tx=>this.dropEvent(tx,event));return;}
    const claimed=await this.store.transaction(async tx=>{
      const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));if(!current||current.subscription!==sub.id||current.state!=='pending'||current.next_at>Date.now())return false;
      current.next_at=Date.now()+20_000;await this.saveEvent(tx,current);
      const t=await tx.get<Timing>(timingKey(event.chat,event.sequence))??{saved_at:message.created_at,attempts:0};t.first_attempt_at??=now();t.attempts++;
      await tx.put(timingKey(event.chat,event.sequence),t);return true;
    });
    if(!claimed)return;
    const safeCursor=await this.safeCursor(this.store,chat.id,sub.id,message.sequence);
    const envelope={eventId:chat.id+'-'+message.id,name:chatEventDefinition.name,timestamp:message.created_at,data:{chat_id:chat.id,device_id:chat.device_id,message_id:message.id,text:message.text.slice(0,16384),text_truncated:message.text.length>16384,attachments:message.attachments,url:this.env.publicUrl+'/chat?id='+chat.id},cursor:safeCursor?'m'+safeCursor:null};
    let status=0,error:string|undefined;
    try{const response=await this.signed(sub,envelope);status=response.status;await response.body?.cancel();}catch(e){error=(e as Data).code==='invalid_callback'?'callback_address':'network';}
    await this.store.transaction(async tx=>{
      const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));const live=await tx.get<Subscription>(subKey(sub.id));const c=await tx.get<Conversation>(key(event.chat));
      if(!current||current.subscription!==sub.id||!live||c?.active!==sub.id)return;
      current.attempts++;
      const m=await tx.get<Message>(messageKey(event.chat,event.sequence));
      if(status>=200&&status<300){
        current.state='delivered';live.cursor=await this.safeCursor(tx,event.chat,sub.id,event.sequence);
        if(m&&m.delivery!=='replied'){m.delivery='delivered';await tx.put(messageKey(event.chat,event.sequence),m);}
        const t=await tx.get<Timing>(timingKey(event.chat,event.sequence));if(t){t.host_accepted_at??=now();await tx.put(timingKey(event.chat,event.sequence),t);}await tx.put(subKey(sub.id),live);
      }else if(status===410||status===413||status>=400&&status<500&&status!==408&&status!==429||current.attempts>=8){
        current.state='failed';current.error=status?'http_'+status:error;if(m&&m.delivery!=='replied'){m.delivery='failed';await tx.put(messageKey(event.chat,event.sequence),m);}
      }else{current.next_at=Date.now()+Math.min(300_000,1000*2**(current.attempts-1));current.error=status?'http_'+status:error;}
      await this.saveEvent(tx,current);await this.recordChange(tx,c,[event.sequence]);
    });
    await this.changed(chat.id);if(status===410)await this.release(chat.id,sub.id);
  }
  private drain():Promise<void>{
    if(this.pumping)return this.pumping;
    this.pumping=this.pump().finally(()=>{this.pumping=undefined;this.wake=undefined;});return this.pumping;
  }
  private async pump():Promise<void>{
    await this.initialize();
    const active=new Map<string,Promise<void>>();
    try{
      for(;;){
        // Only one head per chat is indexed. A completed callback frees its slot immediately.
        const generation=this.wakeVersion;
        const due=await this.store.list<Head>({prefix:'chat-due:',endBefore:'chat-due:'+padded(Date.now()+1),limit:8});
        for(const head of due.values()){
          if(active.size>=8)break;if(active.has(head.chat))continue;
          const event=await this.store.get<Outbox>(outboxKey(head.chat,head.sequence));if(!event)continue;
          const work=this.deliver(event).finally(()=>{active.delete(head.chat);});active.set(head.chat,work);
        }
        if(generation!==this.wakeVersion&&active.size<8)continue;
        if(!active.size)break;
        let signal!:()=>void;const notification=new Promise<void>(resolve=>{signal=resolve;});this.wake=signal;
        await Promise.race([...active.values(),notification]);if(this.wake===signal)this.wake=undefined;
      }
    }finally{
      await Promise.allSettled(active.values());const next=await this.nextAlarm();if(next!==undefined)await this.env.schedule(next);
    }
  }
  async nextAlarm():Promise<number|undefined>{
    await this.initialize();
    const head=[...(await this.store.list<Head>({prefix:'chat-due:',limit:1})).values()][0];
    const expiry=[...(await this.store.list<Expiry>({prefix:'chat-expiry:',limit:1})).values()][0];
    const times=[head?.at,expiry?.at].filter((v):v is number=>v!==undefined);return times.length?Math.min(...times):undefined;
  }
  private async cleanup():Promise<void>{
    const expired=await this.store.list<Expiry>({prefix:'chat-expiry:',endBefore:'chat-expiry:'+padded(Date.now()+1),limit:100});
    for(const e of expired.values()){
      if(e.kind==='subscription'){
        const sub=await this.store.get<Subscription>(subKey(e.id));if(sub)await this.release(sub.chat,sub.id,e.at);
      }
      const removed=await this.store.transaction(async tx=>{
        const ref=await tx.get<Expiry>('chat-expiry-ref:'+e.kind+':'+e.id);
        if(ref?.at!==e.at){await tx.delete(expiryKey(e));return;}
        let blob:{chat:string;attachment:string}|undefined;
        if(e.kind==='upload'){
          const a=await tx.get<Attachment>('chat-attachment:'+e.id);
          if(a?.expires_at&&a.expires_at<=Date.now()){
            const chat=e.id.split(':')[0];blob={chat,attachment:a.id};
            await tx.delete(['chat-attachment:'+e.id,...(await tx.list({prefix:'chat-chunk:'+chat+':'+a.id+':'})).keys()]);
          }
        }else if(e.kind==='candidate')await tx.delete('chat-candidate:'+e.id);
        else if(e.kind==='denied')await tx.delete('chat-link-denied:'+e.id);
        else if(e.kind==='link'){const l=await tx.get<Link>('chat-link:'+e.id);if(l)await tx.delete(['chat-link:'+l.id,'chat-link-code:'+l.code]);}
        await this.expiry(tx,e.kind,e.id);return blob;
      });
      if(removed&&this.env.blobs)await this.env.blobs.remove(removed.chat,removed.attachment);
    }
  }
  async alarm():Promise<void>{
    await this.initialize();
    // Start ready delivery before cleanup; attachment reclamation is not on the delivery path.
    await Promise.all([this.drain(),this.cleanup()]);const next=await this.nextAlarm();if(next!==undefined)await this.env.schedule(next);
  }
}
