/** Durable summary requests. No model execution or user-input ledger side effects. */
import type {KeyStore} from '../runtime';
import {hash,type Data} from '../types';
import {IDLE_MS,TOKEN_LIMIT,indexContext,pad,captureSourceFingerprints,readSourceFingerprint,eraseSourceFingerprints,type ContextIndex} from './working_context';
import {completeTranscriptMessage,type ContextMessage} from './context';
import {messagePrefix} from './working_context';
import {readChatSummary,writeChatSummary,type SummaryWriter} from './summary';
export interface MaintenanceStatus {id:string;anchor_sequence:number;created_at:string;updated_at:string;state:'waiting'|'running'|'completed'|'failed';text:string;outcome?:'deferred'|'maintained'|'unchanged'}
export interface Maintenance {version:1;generation:number;last_activity:number;checked_through:number;next_at:number|null;state:'idle'|'waiting'|'running'|'failed';reason:'capacity'|'idle';snapshot:number;summary_revision:number;lease_until:number;writer?:string;attempts:number;notified:boolean;status_id?:string;index?:ContextIndex;source_hashes?:Record<string,string>;source_layout?:'chunks-v1';claimed_total?:number;delivery_token?:string;delivery_lease?:number}
export const maintenanceKey=(chat:string)=>'chat-maintenance:'+chat;
export const subscriptionKey=(chat:string)=>'chat-maintenance-subscription:'+chat;
export const statusPrefix=(chat:string)=>'chat-maintenance-status:'+chat+':';
const sourcePrefix=(chat:string)=>'chat-maintenance-source:'+chat+':';
export const publicMaintenance=(s:Maintenance)=>{const {source_hashes,source_layout,writer,...visible}=s;return visible;};
async function releaseSources(tx:KeyStore,chat:string,s:Maintenance){await eraseSourceFingerprints(tx,sourcePrefix(chat));delete s.source_hashes;delete s.source_layout;}
const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code});};
export async function maintenanceStatuses(tx:KeyStore,chat:string){return [...(await tx.list<MaintenanceStatus>({prefix:statusPrefix(chat),reverse:true,limit:100})).values()].reverse().map(item=>item.state==='completed'&&item.text==='收到新消息，空闲检查已顺延。'?{...item,outcome:'deferred' as const}:item);}
export async function persist(tx:KeyStore,chat:string,s:Maintenance){await tx.put(maintenanceKey(chat),s);if(s.next_at!==null)await tx.requestAlarm?.(s.next_at);}
export async function updateStatus(tx:KeyStore,chat:string,s:Maintenance,state:MaintenanceStatus['state'],text:string,outcome?:MaintenanceStatus['outcome']){
 if(!s.status_id)s.status_id='cm'+s.generation;
 const k=statusPrefix(chat)+pad(s.generation),old=await tx.get<MaintenanceStatus>(k),stamp=new Date().toISOString();
 await tx.put(k,{id:s.status_id,anchor_sequence:old?.anchor_sequence??s.snapshot,created_at:old?.created_at??stamp,updated_at:stamp,state,text,...(outcome?{outcome}:{})});
}
export async function observeContext(tx:KeyStore,chat:string,sequence:number,activity=false):Promise<Maintenance>{
 let s=await tx.get<Maintenance>(maintenanceKey(chat));const now=Date.now();
 if(!s)s={version:1,generation:0,last_activity:now,checked_through:0,next_at:null,state:'idle',reason:'idle',snapshot:0,summary_revision:0,lease_until:0,attempts:0,notified:false};
 if(activity){
  s.last_activity=now;
  // A newer real activity may recover a failed generation; reads and alarms
  // must not turn a failure into an automatic retry loop.
  if(s.state==='failed'&&sequence>s.snapshot){s.state='idle';s.writer=undefined;s.lease_until=0;s.notified=false;}
 }
 s.index=await indexContext(tx,chat,sequence);
 const capacity=s.index.total_tokens>TOKEN_LIMIT;
 if(s.state==='running'&&s.lease_until<=now){s.state='failed';s.next_at=null;await releaseSources(tx,chat,s);await updateStatus(tx,chat,s,'failed','维护未完成：执行租约已过期，原文已保留。');}
 if(s.state==='idle'&&(capacity||sequence>s.checked_through&&now>=s.last_activity+IDLE_MS)){
  s.generation++;s.reason=capacity?'capacity':'idle';s.state='waiting';s.snapshot=sequence;s.summary_revision=s.index.summary_revision;s.attempts=0;s.notified=false;s.status_id=undefined;s.next_at=now;
  await updateStatus(tx,chat,s,'waiting',capacity?'已触发自动维护，等待维护上下文。':'空闲检查已到期，等待检查上下文。');
 }else if(s.state==='waiting'&&capacity&&s.reason!=='capacity'){s.reason='capacity';await updateStatus(tx,chat,s,'waiting','已触发自动维护，等待维护上下文。');}
 // An idle wake is invalidated by newer conversation activity, unless capacity requires work.
 if(activity&&s.state==='waiting'&&s.reason==='idle'){await updateStatus(tx,chat,s,'completed','收到新消息，空闲检查已顺延。','deferred');s.state='idle';s.notified=false;s.next_at=s.last_activity+IDLE_MS;}
 if(s.state==='idle')s.next_at=sequence>s.checked_through?s.last_activity+IDLE_MS:null;
 await persist(tx,chat,s);return s;
}
export async function maintain(tx:KeyStore,chat:string,sequence:number,args:Data,writer:SummaryWriter&{id:string}):Promise<Data>{
 let s=await observeContext(tx,chat,sequence);
 if(args.operation==='read')return {maintenance:publicMaintenance(s)};
 if(typeof args.request_key!=='string'||!args.request_key)fail('invalid_maintenance_request','Stable request_key required');
 const receipt='chat-maintenance-receipt:'+chat+':'+await hash(args.request_key),fingerprint=await hash(JSON.stringify({...args,connection:undefined}));
 const previous=await tx.get<{fingerprint:string;result:Data}>(receipt);
 if(previous){if(previous.fingerprint!==fingerprint)fail('request_key_conflict','Request key was used for different content');return previous.result;}
 if(args.generation!==s.generation)fail('maintenance_generation_conflict','Read the current request');
 if(args.operation==='claim'){
  if(s.state==='running'&&s.lease_until>Date.now())fail('maintenance_already_claimed','Another writer owns this lease');
  if(!['waiting','running','failed'].includes(s.state))fail('maintenance_not_pending','No pending maintenance');
  s.delivery_token=undefined;s.delivery_lease=0;s.state='running';s.writer=writer.id;s.lease_until=Date.now()+30*60_000;s.next_at=s.lease_until;
  // Claim binds an up-to-date immutable processing range; later messages remain raw.
  s.snapshot=sequence;s.summary_revision=s.index!.summary_revision;s.claimed_total=s.index!.total_tokens;
  const summary=await readChatSummary(tx,chat,sequence);
  const historical=args.source_message_ids??[];
  if(!Array.isArray(historical)||historical.length>100||historical.some(id=>typeof id!=='string'||!/^m[1-9]\d*$/.test(id)))fail('invalid_maintenance_sources','Claim source_message_ids must contain at most 100 saved message IDs');
  for(const id of historical){const seq=Number(id.slice(1));if(!Number.isSafeInteger(seq)||seq>sequence||!await tx.get(messagePrefix(chat)+pad(seq)))fail('invalid_maintenance_sources','Claim cites a missing or future message');}
  await eraseSourceFingerprints(tx,sourcePrefix(chat));
  await captureSourceFingerprints(tx,chat,(summary?.covered_through??0)+1,sequence,sourcePrefix(chat),[...new Set([...(summary?.source_message_ids??[]),...historical])]);
  s.source_layout='chunks-v1';delete s.source_hashes;
  await updateStatus(tx,chat,s,'running','正在维护上下文');
 }else{
  if(s.state!=='running'||s.writer!==writer.id||s.lease_until<=Date.now())fail('maintenance_lease_invalid','Claim a current maintenance request first');
  if(args.operation==='defer'){
   s.delivery_token=undefined;s.delivery_lease=0;s.state='waiting';s.next_at=Date.now()+Math.min(3600_000,Math.max(60_000,args.delay_ms??300_000));s.notified=false;s.attempts=0;
   await releaseSources(tx,chat,s);
   if(s.status_id)await updateStatus(tx,chat,s,'waiting','上下文维护已暂缓，原文已保留。');
  }else if(args.operation==='unchanged'){
   if(s.reason==='capacity'&&s.index!.total_tokens>TOKEN_LIMIT)fail('context_still_over_limit','Capacity request cannot be resolved without reducing the total');
   await updateStatus(tx,chat,s,'completed','上下文检查完成，无需修改摘要。','unchanged');
   s.checked_through=Math.max(s.checked_through,s.snapshot);s.state='idle';s.next_at=sequence>s.checked_through?s.last_activity+IDLE_MS:null;
   await releaseSources(tx,chat,s);
  }else if(args.operation==='complete'){
   if(args.covered_through>s.snapshot||args.evidence_through>s.snapshot)fail('invalid_summary_coverage','Submission exceeds claimed snapshot');
   if(args.expected_revision!==s.summary_revision)fail('summary_revision_conflict','Use the claimed summary revision');
   for(const id of args.source_message_ids??[]){
    const seq=Number(id.slice(1)),fingerprint=s.source_layout==='chunks-v1'?await readSourceFingerprint(tx,sourcePrefix(chat),seq):s.source_hashes?.[String(seq)];
    if(!fingerprint)fail('summary_source_not_claimed','Cite retained messages, prior summary sources, or historical source_message_ids explicitly supplied with the claim');
    const m=await tx.get<ContextMessage>(messagePrefix(chat)+pad(seq));
    if(!m||fingerprint!==await hash(JSON.stringify(completeTranscriptMessage(m))))fail('summary_source_changed','Source changed since claim');
   }
   const saved=await writeChatSummary(tx,chat,{text:args.text,covered_through:args.covered_through,source_message_ids:args.source_message_ids,expected_revision:args.expected_revision,maintenance:true,evidence_through:args.evidence_through??s.snapshot,request_key:'maintenance:'+args.request_key},writer);
   const atSnapshot=await indexContext(tx,chat,s.snapshot);
   if(s.reason==='capacity'&&atSnapshot.total_tokens>=(s.claimed_total??Infinity))fail('summary_no_reduction','Capacity summary must reduce its claimed working context');
   s.index=await indexContext(tx,chat,sequence);s.checked_through=Math.max(s.checked_through,s.snapshot);
   if(!s.status_id)await updateStatus(tx,chat,s,'running','正在维护上下文');
   await updateStatus(tx,chat,s,'completed','上下文维护完成','maintained');
   s.state='idle';s.next_at=sequence>s.checked_through?s.last_activity+IDLE_MS:null;s.writer=undefined;
   await releaseSources(tx,chat,s);
   await persist(tx,chat,s);
   // Commit is valid even when new messages arrived; capacity is re-evaluated separately.
   s=await observeContext(tx,chat,sequence);
   const result={saved:true,summary:saved,maintenance:publicMaintenance(s)};await tx.put(receipt,{fingerprint,result});return result;
  }else fail('invalid_maintenance_operation','Unknown maintenance operation');
 }
 await persist(tx,chat,s);const result={maintenance:publicMaintenance(s)};await tx.put(receipt,{fingerprint,result});return result;
}
