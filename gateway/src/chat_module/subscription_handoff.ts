/** Transactional endpoint handoff. This module never creates host tasks or sends webhooks. */
import type {KeyStore} from '../runtime';
import {hash,opaque,type Data} from '../types';

export type HandoffEvent='chat.message'|'chat.summary_due';
export const HANDOFF_EVENTS:HandoffEvent[]=['chat.message','chat.summary_due'];
export interface HandoffWriter {id:string;account:string;epoch:number;caller:string}
export interface HandoffEndpoint {
 id:string;writer_id:string;event_name:HandoffEvent;url:string;secret:string;
 expires_at:number|null;verified_at:number;handoff_id?:string;[key:string]:unknown;
}
export interface HandoffRouting {revision:number;endpoints:Partial<Record<HandoffEvent,HandoffEndpoint>>}
export interface HandoffScope {
 chatId:string;writer:HandoffWriter;
 /** Recheck chat ACL and return the actual current writer inside this same transaction. */
 authorize(tx:KeyStore):Promise<HandoffWriter|undefined>;
}
export interface HandoffPort {
 readRouting(tx:KeyStore,chat:string):Promise<HandoffRouting>;
 /** Update routing and pending notification targets atomically; never delete transcript/processing state. */
 writeRouting(tx:KeyStore,chat:string,next:HandoffRouting,previous:HandoffRouting):Promise<void>;
}
type Phase='prepared'|'active'|'rolled_back'|'aborted'|'expired'|'finalized';
interface HandoffRecord {
 id:string;chat:string;writer:HandoffWriter;revision:number;phase:Phase;created_at:number;expires_at:number;
 base?:HandoffRouting;rollback?:HandoffRouting;candidates:Partial<Record<HandoffEvent,HandoffEndpoint>>;
 candidate_ids:Partial<Record<HandoffEvent,string>>;unavailable_ids:string[];host_task_id?:string;active_routing_revision?:number;
}
export interface HandoffCommand {operation:'prepare'|'read'|'activate'|'rollback'|'abort'|'finalize';handoff_id?:string;expected_revision?:number;host_task_id?:string;request_key?:string}
export interface RouteDelivery {id:string;chat:string;event_name:HandoffEvent;endpoint_id:string;routing_revision:number;source_id:string;started_at:number;attempt:number}
interface StoredDelivery extends RouteDelivery {state:'in_flight'|'uncertain';ever_uncertain:boolean}
const statePrefix=(chat:string)=>'chat-handoff-state:'+chat+':';
const stateKey=(chat:string,id:string)=>statePrefix(chat)+id;
const currentKey=(chat:string)=>'chat-handoff-current:'+chat;
const requestPrefix=(chat:string)=>'chat-handoff-request:'+chat+':';
const deliveryPrefix=(chat:string)=>'chat-handoff-delivery:'+chat+':';
const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code});};
const sameWriter=(a:HandoffWriter|undefined,b:HandoffWriter)=>!!a&&a.id===b.id&&a.account===b.account&&a.epoch===b.epoch&&a.caller===b.caller;
async function authorize(tx:KeyStore,scope:HandoffScope){if(!sameWriter(await scope.authorize(tx),scope.writer))fail('handoff_writer_changed','The current writer changed');}
function validId(id:unknown):id is string{return typeof id==='string'&&/^ho_[a-f0-9]+$/.test(id);}
export const candidateEndpointId=(handoff:string,event:HandoffEvent)=>handoff+(event==='chat.message'?'-message':'-summary');
const usable=(e:HandoffEndpoint|undefined,now=Date.now())=>!!e&&(e.expires_at===null||e.expires_at>now);
function identities(route:HandoffRouting){return HANDOFF_EVENTS.map(name=>{
 const e=route.endpoints[name];return e?[name,e.id,e.writer_id,e.url,e.secret,e.expires_at]:[name,null];
});}
const sameRouting=(a:HandoffRouting,b:HandoffRouting)=>a.revision===b.revision&&JSON.stringify(identities(a))===JSON.stringify(identities(b));
function assertRoutingOwner(route:HandoffRouting,writer:HandoffWriter){
 if(!Number.isSafeInteger(route.revision)||route.revision<0)fail('handoff_routing_invalid','Invalid routing revision');
 for(const name of HANDOFF_EVENTS){const e=route.endpoints[name];if(e&&(e.writer_id!==writer.id||e.event_name!==name))fail('handoff_writer_changed','Endpoint belongs to another writer');}
}
async function load(tx:KeyStore,scope:HandoffScope,id?:string):Promise<HandoffRecord>{
 const selected=id??await tx.get<string>(currentKey(scope.chatId));if(!validId(selected))fail('handoff_not_found','No matching handoff');
 const value=await tx.get<HandoffRecord>(stateKey(scope.chatId,selected!));
 if(!value||value.chat!==scope.chatId)fail('handoff_not_found','No matching handoff');
 if(!sameWriter(value!.writer,scope.writer))fail('handoff_writer_changed','Handoff belongs to another writer');
 return value!;
}
function publicRecord(r:HandoffRecord){
 return {handoff_id:r.id,revision:r.revision,phase:r.phase,created_at:r.created_at,expires_at:r.expires_at,
  expired:r.phase==='prepared'&&r.expires_at<=Date.now(),required_events:[...HANDOFF_EVENTS],
  staged_events:HANDOFF_EVENTS.filter(e=>!!r.candidates[e]),candidate_endpoint_ids:{...r.candidate_ids},
  ready:r.phase==='prepared'&&r.expires_at>Date.now()&&HANDOFF_EVENTS.every(e=>usable(r.candidates[e])),
  rollback_available:r.phase==='active'&&!!r.rollback&&Object.values(r.rollback.endpoints).every(e=>usable(e)&&!r.unavailable_ids.includes(e!.id)),
  ...(r.host_task_id?{host_task_id:r.host_task_id}:{}),...(r.active_routing_revision!==undefined?{routing_revision:r.active_routing_revision}:{})};
}
async function result(tx:KeyStore,r:HandoffRecord){const deliveries=await listRouteDeliveries(tx,r.chat);return {handoff:publicRecord(r),in_flight_deliveries:deliveries.length,uncertain_deliveries:deliveries.filter(d=>d.state==='uncertain').length};}
async function save(tx:KeyStore,r:HandoffRecord){await tx.put(stateKey(r.chat,r.id),r);}
function compact(r:HandoffRecord){delete r.base;delete r.rollback;r.candidates={};}
async function noInFlight(tx:KeyStore,chat:string){if((await tx.list({prefix:deliveryPrefix(chat),limit:1})).size)fail('handoff_delivery_in_flight','A callback is still in flight; keep the current route and retry after its receipt settles');}
function expected(r:HandoffRecord,n:unknown){if(!Number.isSafeInteger(n)||n!==r.revision)fail('handoff_revision_conflict','Read the current handoff revision');}

/** Call inside the service transaction, after validating the original connection credential. */
export async function subscriptionHandoff(tx:KeyStore,scope:HandoffScope,port:HandoffPort,args:HandoffCommand):Promise<Data>{
 await authorize(tx,scope);
 if(args.operation==='read')return result(tx,await load(tx,scope,args.handoff_id));
 if(typeof args.request_key!=='string'||!args.request_key||args.request_key.length>256)fail('invalid_handoff_request','A stable request_key of at most 256 characters is required');
 const receipt=requestPrefix(scope.chatId)+await hash(args.request_key!),fingerprint=await hash(JSON.stringify([scope.writer,args.operation,args.handoff_id??null,args.expected_revision??null,args.host_task_id??null]));
 const prior=await tx.get<{fingerprint:string;result:Data}>(receipt);
 if(prior){if(prior.fingerprint!==fingerprint)fail('request_key_conflict','Request key was used for another handoff operation');return {...prior.result,replayed:true};}
 let r:HandoffRecord;
 if(args.operation==='prepare'){
  const oldId=await tx.get<string>(currentKey(scope.chatId)),old=oldId?await tx.get<HandoffRecord>(stateKey(scope.chatId,oldId)):undefined;
  if(old&&!sameWriter(old.writer,scope.writer)){old.phase='aborted';old.revision++;compact(old);await save(tx,old);}
  else if(old?.phase==='prepared'&&old.expires_at<=Date.now()){old.phase='expired';old.revision++;compact(old);await save(tx,old);}
  else if(old&&['prepared','active'].includes(old.phase))fail('handoff_already_pending','Finish or abort the current handoff first');
  const base=await port.readRouting(tx,scope.chatId);assertRoutingOwner(base,scope.writer);
  if(!usable(base.endpoints['chat.message']))fail('handoff_message_subscription_required','An active message subscription is required');
  r={id:'ho_'+opaque(),chat:scope.chatId,writer:{...scope.writer},revision:1,phase:'prepared',created_at:Date.now(),expires_at:Date.now()+30*60_000,base:structuredClone(base),candidates:{},candidate_ids:{},unavailable_ids:[]};
  await tx.put(currentKey(scope.chatId),r.id);
 }else{
  r=await load(tx,scope,args.handoff_id);expected(r,args.expected_revision);
  if(args.operation==='activate'){
   if(r.phase!=='prepared')fail('handoff_not_prepared','Only a prepared handoff can activate');
   if(r.expires_at<=Date.now())fail('handoff_expired','The candidate expired; the original route is unchanged');
   if(!HANDOFF_EVENTS.every(e=>usable(r.candidates[e])))fail('handoff_not_ready','Both callbacks must be verified and staged');
   if(typeof args.host_task_id!=='string'||!args.host_task_id.trim()||args.host_task_id.length>256)fail('handoff_host_task_required','Provide the confirmed new host task ID; callback verification alone is insufficient');
   const live=await port.readRouting(tx,scope.chatId);assertRoutingOwner(live,scope.writer);
   if(!r.base||!sameRouting(live,r.base))fail('handoff_routing_changed','The original routing changed; do not overwrite it');
   await noInFlight(tx,scope.chatId);
   const next:HandoffRouting={revision:live.revision+1,endpoints:structuredClone(r.candidates)};
   await port.writeRouting(tx,scope.chatId,next,live);
   r.rollback=structuredClone(live);r.phase='active';r.host_task_id=args.host_task_id;r.active_routing_revision=next.revision;
  }else if(args.operation==='rollback'){
   if(r.phase!=='active'||!r.rollback)fail('handoff_rollback_unavailable','No active rollback target');
   if(!Object.values(r.rollback!.endpoints).every(e=>usable(e)&&!r.unavailable_ids.includes(e!.id)))fail('handoff_rollback_unavailable','An original endpoint expired or was unsubscribed');
   const live=await port.readRouting(tx,scope.chatId);assertRoutingOwner(live,scope.writer);
   if(live.revision!==r.active_routing_revision||HANDOFF_EVENTS.some(e=>live.endpoints[e]&&live.endpoints[e]!.id!==r.candidate_ids[e]))fail('handoff_routing_changed','The active routing changed');
   await noInFlight(tx,scope.chatId);
   const next={revision:live.revision+1,endpoints:structuredClone(r.rollback!.endpoints)};
   await port.writeRouting(tx,scope.chatId,next,live);r.phase='rolled_back';r.active_routing_revision=next.revision;compact(r);
  }else if(args.operation==='abort'){
   if(r.phase!=='prepared')fail('handoff_not_prepared','Use rollback for an active handoff');
   r.phase='aborted';compact(r);
  }else if(args.operation==='finalize'){
   if(r.phase!=='active')fail('handoff_not_active','Only an active handoff can be finalized');
   const live=await port.readRouting(tx,scope.chatId);
   if(live.revision!==r.active_routing_revision||!HANDOFF_EVENTS.every(e=>usable(live.endpoints[e])&&live.endpoints[e]!.id===r.candidate_ids[e]))fail('handoff_routing_changed','Both new endpoints must still be active');
   r.phase='finalized';compact(r);
  }else fail('invalid_handoff_operation','Unknown handoff operation');
  r.revision++;
 }
 await save(tx,r);const response={...await result(tx,r),replayed:false};await tx.put(receipt,{fingerprint,result:response});return response;
}

/** The service must call its real callback verifier first. No user-provided verified flag is accepted by a public tool. */
export async function stageHandoffEndpoint(tx:KeyStore,scope:HandoffScope,port:HandoffPort,handoffId:string,endpoint:HandoffEndpoint):Promise<Data>{
 await authorize(tx,scope);const r=await load(tx,scope,handoffId);
 if(!['prepared','active','finalized'].includes(r.phase))fail('handoff_not_prepared','Candidate registration is closed');
 if(r.phase==='prepared'&&r.expires_at<=Date.now())fail('handoff_expired','Candidate expired');
 const event=endpoint.event_name;
 if(!HANDOFF_EVENTS.includes(event)||endpoint.id!==candidateEndpointId(r.id,event)||endpoint.writer_id!==scope.writer.id||endpoint.handoff_id!==r.id)fail('handoff_endpoint_invalid','Candidate endpoint identity is invalid');
 const url=new URL(endpoint.url);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||!endpoint.secret||!Number.isFinite(endpoint.verified_at)||endpoint.verified_at<=0||endpoint.expires_at!==null&&!Number.isFinite(endpoint.expires_at)||!usable(endpoint))fail('handoff_endpoint_invalid','Candidate must have a verified HTTPS callback');
 const live=await port.readRouting(tx,scope.chatId);assertRoutingOwner(live,scope.writer);
 if(r.phase==='prepared'&&(!r.base||!sameRouting(live,r.base)))fail('handoff_routing_changed','Original routing changed');
 const previous=r.phase==='prepared'?r.candidates[event]:live.endpoints[event];
 if(r.phase!=='prepared'&&(!previous||previous.id!==r.candidate_ids[event]||previous.id!==endpoint.id))fail('handoff_routing_changed','Only the exact current candidate can be refreshed');
 if(previous){
  if(previous.id!==endpoint.id||previous.url!==endpoint.url)fail('handoff_endpoint_conflict','A different endpoint is already staged for this event');
  if(previous.secret===endpoint.secret&&previous.expires_at===endpoint.expires_at)return {...await result(tx,r),staged:true,replayed:true};
  // Refresh only delivery credentials/TTL. In particular, never reset the live cursor,
  // connection credential, owner, or endpoint identity from a new subscribe request.
  const refreshed:HandoffEndpoint={...previous,secret:endpoint.secret,expires_at:endpoint.expires_at,verified_at:endpoint.verified_at};
  if(previous.secret!==endpoint.secret){refreshed.previous_secret=previous.secret;refreshed.rotation_until=Date.now()+60_000;}
  if(r.phase==='prepared')r.candidates[event]=refreshed;
  else{
   const next={revision:live.revision+1,endpoints:{...live.endpoints,[event]:refreshed}};
   await port.writeRouting(tx,scope.chatId,next,live);r.active_routing_revision=next.revision;
   if(r.phase==='active')r.candidates[event]=structuredClone(refreshed);
  }
 }else{
  r.candidates[event]=structuredClone(endpoint);r.candidate_ids[event]=endpoint.id;
 }
 r.revision++;await save(tx,r);
 return {...await result(tx,r),staged:true,replayed:false};
}

/** Endpoint ID must first be resolved from the authenticated unsubscribe's event and callback identity. */
export async function unsubscribeHandoffEndpoint(tx:KeyStore,scope:HandoffScope,port:HandoffPort,event:HandoffEvent,endpointId:string):Promise<Data>{
 await authorize(tx,scope);const live=await port.readRouting(tx,scope.chatId);assertRoutingOwner(live,scope.writer);
 const currentId=await tx.get<string>(currentKey(scope.chatId)),r=currentId?await tx.get<HandoffRecord>(stateKey(scope.chatId,currentId)):undefined;
 const own=r&&sameWriter(r.writer,scope.writer)?r:undefined;let removed=false;
 if(live.endpoints[event]?.id===endpointId){
  const endpoints={...live.endpoints};delete endpoints[event];const next={revision:live.revision+1,endpoints};await port.writeRouting(tx,scope.chatId,next,live);removed=true;
  if(own&&['active','finalized'].includes(own.phase)&&own.candidate_ids[event]===endpointId)own.active_routing_revision=next.revision;
 }
 if(own){
  const older=own.rollback?.endpoints[event]??own.base?.endpoints[event];
  if(older?.id===endpointId&&!own.unavailable_ids.includes(endpointId)){own.unavailable_ids.push(endpointId);removed=true;}
  if(own.phase==='prepared'&&own.candidates[event]?.id===endpointId){delete own.candidates[event];removed=true;}
  if(removed){own.revision++;await save(tx,own);}
 }
 return {removed,writer_retained:true};
}

/** Durable callback reservation. Acquire just before dispatch; activation is blocked until receipt settlement. */
export async function beginRouteDelivery(tx:KeyStore,port:HandoffPort,chat:string,event:HandoffEvent,endpointId:string,sourceId:string):Promise<RouteDelivery>{
 const live=await port.readRouting(tx,chat);if(!usable(live.endpoints[event])||live.endpoints[event]!.id!==endpointId)fail('delivery_target_changed','Routing target changed before dispatch');
 const id='hd_'+await hash(JSON.stringify([event,endpointId,sourceId])),k=deliveryPrefix(chat)+id,previous=await tx.get<StoredDelivery>(k);
 const ticket:RouteDelivery={id,chat,event_name:event,endpoint_id:endpointId,routing_revision:previous?.routing_revision??live.revision,source_id:sourceId,started_at:Date.now(),attempt:(previous?.attempt??0)+1};
 // Retrying while an older attempt is still in flight cannot prove that older
 // attempt failed. A later rejection must not erase its unresolved reservation.
 await tx.put(k,{...ticket,state:'in_flight',ever_uncertain:!!previous&&(previous.ever_uncertain||previous.state==='in_flight')} satisfies StoredDelivery);return ticket;
}
/** Commit the real acknowledgement and remove its reservation in the same transaction. Never call this to invent delivery. */
export async function finishRouteDelivery(tx:KeyStore,ticket:RouteDelivery,commitReceipt:()=>Promise<void>,outcome:'accepted'|'not_accepted'|'uncertain'='uncertain'):Promise<boolean>{
 const k=deliveryPrefix(ticket.chat)+ticket.id,current=await tx.get<StoredDelivery>(k);if(!current)return false;
 if(current.chat!==ticket.chat||current.event_name!==ticket.event_name||current.endpoint_id!==ticket.endpoint_id||current.source_id!==ticket.source_id||current.routing_revision!==ticket.routing_revision||ticket.attempt>current.attempt)fail('delivery_ticket_invalid','Delivery ticket does not match');
 // A late failure must not overwrite a newer retry. A real late success still acknowledges this same stable event.
 if(ticket.attempt<current.attempt&&outcome!=='accepted')return false;
 await commitReceipt();
 if(outcome==='accepted'||outcome==='not_accepted'&&!current.ever_uncertain)await tx.delete(k);
 else await tx.put(k,{...current,state:'uncertain',ever_uncertain:true} satisfies StoredDelivery);
 return true;
}
/** A crashed callback is not silently treated as acknowledged merely because time passed. */
export async function listRouteDeliveries(tx:KeyStore,chat:string):Promise<StoredDelivery[]>{return [...(await tx.list<StoredDelivery>({prefix:deliveryPrefix(chat),limit:100})).values()];}
export async function eraseSubscriptionHandoffs(tx:KeyStore,chat:string):Promise<void>{
 for(const prefix of [statePrefix(chat),requestPrefix(chat),deliveryPrefix(chat)])for(;;){const rows=await tx.list({prefix,limit:100});if(!rows.size)break;await tx.delete([...rows.keys()]);}
 await tx.delete(currentKey(chat));
}
