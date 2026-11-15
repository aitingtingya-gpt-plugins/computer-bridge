/** Persistent, device-owned communication. Computer execution keeps its existing transport. */
import {subscriptionHandoff,stageHandoffEndpoint,unsubscribeHandoffEndpoint,candidateEndpointId,beginRouteDelivery,finishRouteDelivery,eraseSubscriptionHandoffs,type HandoffPort,type HandoffScope,type HandoffRouting,type HandoffEndpoint,type RouteDelivery} from './subscription_handoff';
import {sha256} from '@noble/hashes/sha2.js';
import {Webhook} from 'standardwebhooks';
import {byteRange,uploadMetadata,unsignedHeader,TUS_VERSION,MAX_ATTACHMENT_SIZE,MAX_PATCH_SIZE,cancelBody} from '../attachment_http';
import type {Accounts, Actor} from '../accounts';
import type {ApprovalOrigin} from '../approvals';
import {readWorkingContext,indexContext,IDLE_MS,eraseWorkingSnapshot,eraseSourceFingerprints} from './working_context';
import {maintenanceKey,subscriptionKey,maintenanceStatuses,observeContext,maintain,publicMaintenance,persist,updateStatus,type Maintenance} from './summary_maintenance';
import {callbackDiagnosticsKey,callbackFailure,readCallbackDiagnostics,recordCallbackDiagnostic,type CallbackCategory} from './callback_diagnostics';
import {channelDeleteInstructions,channelEventDefinition} from './channel_contract';
import {admitRound,changeGoal,collaborationWakeKey,collaborationWakePrefix,goalKey,goalView,goalWakeId,interactionFail,newGoal,parseGoalCommand,PLAN_GUIDANCE,planWakeId,projectPlanMode,queueCollaborationWake,renderGoalRoundPrompt,reviewKey,type AutoToolGrant,type CollaborationWake,type GoalRecord,type GoalRound,type InteractionMode,type PlanReview} from './interaction/state';
import {channelCommandKey,channelDiagnosticsKey,channelOutboxKey,classifyChannelError,eraseChannelDiagnosticsForChat,isChannelRetryable,readChannelDiagnostics,recordChannelDiagnostic,sanitizeChannelCommand,type ChannelAction,type ChannelCommandSummary,type ChannelDiagnostic} from './channel_diagnostics';
import {maintenanceDiagnosticsKey,readMaintenanceDiagnostics,recordMaintenanceDiagnostic,type MaintenanceDiagnosticPhase} from './maintenance_diagnostics';
import {buildContext,chatMode,sourceIdentity,fitContextToEnvelope,CHAT_EVENT_BYTES,jsonBytes,type ChatMode,type ChatContext} from './context';
import {superAgentMessage,superAgentTask,superAgentErase,superAgentDrainOutbox,superAgentTick,HOST_ACTIONS,MUTATING_ACTIONS,normalizeRepository,type RepositoryBinding,type TaskRequest} from './super_agent';
import {authenticateDeviceIdentity,authorizeIdentity,modelActor,normalizeIdentity,principalScope,validateIdentity,type ChatIdentity,type ChatPrincipal} from '../chat_identity';
import type {KeyStore, Store} from '../runtime';
import {hash, type Data} from '../types';
import {readRepository,type RepositoryReadRequest} from './repositories';
import {processingMeta,processingRecord,queueInput,listPending,reportProcessing,noteSavedReply,eraseProcessing} from './reliability';
import {readChatSummary,writeChatSummary,eraseChatSummary} from './summary';
import {recordTrace,listTrace,readTrace,readTraceEntry,eraseTrace} from './trace';
import {storeTextAttachment} from './text_attachment';
import {prepareSummaryProduction,completeSummaryProduction,cancelSummaryProduction,eraseSummaryProduction} from './summary_producer';
import {toolSpecs} from '../contracts';
import {observeToolCall,observeToolResult,unavailableToolTicket,type ChatToolBinding,type ObservedToolTicket,type ObservedToolReceipt} from './tool_observation';
import type {TraceScope} from './trace';

export interface ChatDevice {id:string;raw:string;name:string;system:unknown}
export interface ChatBlobs {
  write(chat:string,attachment:string,index:number,bytes:Uint8Array):Promise<void>;
  read(chat:string,attachment:string,index:number):Promise<Uint8Array>;
  remove(chat:string,attachment:string):Promise<void>;
}
export interface ChatEnvironment {
  publicUrl:string;
  device(id:string,actor:ChatPrincipal):Promise<ChatDevice>;
  webhookFetch(url:string,init:RequestInit):Promise<Response>;
  schedule(time:number):Promise<void>;
  equal(a:Uint8Array,b:Uint8Array):boolean;
  blobs?:ChatBlobs;
  changed?(chatId:string):Promise<void>;
  claimAvailability?(tx:KeyStore,device:string,chatId:string,actor:ChatIdentity):Promise<{
    claimable_approval_count:number;next_claimable_approval_expires_at:number|null;
  }>;
  background?(work:Promise<unknown>):void;
  /** Optional trusted transport. Authentication must be scoped to this caller and repository, never globally shared. */
  repositoryFetch?(scope:{chatId:string;deviceId:string;principal:ChatPrincipal;repository:RepositoryBinding},url:string,init:RequestInit):Promise<Response>;
}
interface Conversation {mode?:ChatMode;repository?:RepositoryBinding;id:string;owner?:string;device:string;device_id:string;title:string;created_at:string;updated_at:string;sequence:number;attachments:number;active?:string;writer?:string;revision?:number;reconnect_until?:number;interaction_mode?:InteractionMode;interaction_revision?:number;plan_review_id?:string}
interface Message {id:string;sequence:number;role:'user'|'assistant';source:'web'|'tui'|'model'|'module';source_identity?:ReturnType<typeof sourceIdentity>;command_processed?:string;planning_request?:true;text:string;attachments:AttachmentView[];created_at:string;delivery?:'pending'|'delivered'|'replied'|'failed'|'none';saved_at?:string;reply_to?:string;replies?:string[];replied_at?:string;resolves_message_ids?:string[];kind?:'approval';approval?:Data;approval_id?:string;approval_origin?:ApprovalOrigin}
interface AttachmentView {id:string;name:string;size:number;mime_type:string;sha256?:string}
interface Attachment extends AttachmentView {offset:number;chunks:number;state:'uploading'|'ready';expires_at?:number;expected_sha256?:string;protocol?:'tus';upload_metadata?:string}
interface Candidate {chat:string;account:string;epoch:number;caller:string;expires_at:number}
interface Writer {id:string;chat:string;account:string;epoch:number;caller:string;connection_hash:string;event_connection:string;callback_url?:string}
interface Subscription {unified_context?:boolean;id:string;chat:string;account:string;epoch:number;caller:string;connection_hash:string;event_connection?:string;url:string;secret:string;previous_secret?:string;rotation_until?:number;expires_at:number|null;cursor:number;verified_at:number;writer_id?:string;event_name?:'chat.message'|'chat.summary_due';handoff_id?:string}
interface ChannelSubscription {id:string;account:string;epoch:number;caller:string;url:string;secret:string;previous_secret?:string;rotation_until?:number;expires_at:number|null;verified_at:number;created_at:string;updated_at:string}
interface ChannelOutbox {chat:string;subscription:string;action:ChannelAction;source:'web'|'tui';account:string;epoch:number;sequence:number;attempts:number;next_at:number;created_at:string;updated_at:string;last_error?:ChannelDiagnostic;device?:string;payload?:Data}
interface ChannelDiagnosticScope {account:string;action?:ChannelAction;chat_id?:string;subscription_id?:string;attempt?:number}
const CHANNEL_RETRY_DELAYS=[5_000,15_000,30_000,60_000];
const MESSAGE_403_RETRY_DELAYS=[5_000,15_000,30_000,60_000];
interface Outbox {chat:string;sequence:number;subscription:string;attempts:number;next_at:number;state:'pending'|'delivered'|'failed'|'paused'|'blocked'|'resolved';error?:string;received_at?:string;transient_403_attempts?:number}
interface Link {scope?:'account'|'device';id:string;code:string;device:string;token_hash:string;expires_at:number;approved_by?:string;epoch?:number;credential?:string}
interface Credential {account:string;epoch:number;device:string;scope?:'account'|'device'}
interface Timing {saved_at:string;first_attempt_at?:string;host_accepted_at?:string;reply_saved_at?:string;attempts:number}
interface Head {chat:string;sequence:number;at:number}
interface Expiry {kind:string;id:string;at:number}
interface ChatChange {sequences:number[];review_ids?:string[]}
interface PendingApproval {id:string;sequence:number;expires_at:number}
const PLAN_REVIEWS_PER_PAGE=8;
const padded=(n:number)=>String(n).padStart(16,'0');
const changeKey=(chat:string,revision:number)=>'chat-change:'+chat+':'+padded(revision);
const reviewTimelinePrefix=(chat:string)=>'chat-plan-position:'+chat+':';
const reviewTimelineAnchor=(chat:string,sequence:number)=>reviewTimelinePrefix(chat)+padded(sequence)+':';
const reviewTimelineKey=(chat:string,sequence:number,revision:number)=>reviewTimelineAnchor(chat,sequence)+padded(revision);
const pendingApprovalPrefix=(chat:string)=>'chat-approval-pending:'+chat+':';
const pendingKey=(chat:string,sequence:number)=>'chat-pending:'+chat+':'+padded(sequence);
const unackKey=(chat:string,subscription:string,sequence:number)=>'chat-unack:'+chat+':'+subscription+':'+padded(sequence);
const dueKey=(head:Head)=>'chat-due:'+padded(head.at)+':'+head.chat;
const timingKey=(chat:string,sequence:number)=>'chat-timing:'+chat+':'+padded(sequence);
const expiryKey=(expiry:Expiry)=>'chat-expiry:'+padded(expiry.at)+':'+expiry.kind+':'+expiry.id;
const CHUNK=262144;
const now=()=>new Date().toISOString();
const key=(id:string)=>'chat:'+id;
const indexKey=(id:string)=>'chat-index:'+padded(Number(id.slice(1)));
const deviceIndexKey=(device:string,id:string)=>'chat-device:'+device+':'+padded(Number(id.slice(1)));
const messageKey=(id:string,seq:number)=>'chat-message:'+id+':'+String(seq).padStart(16,'0');
const attachmentKey=(id:string,a:string)=>'chat-attachment:'+id+':'+a;
const chunkKey=(id:string,a:string,index:number)=>'chat-chunk:'+id+':'+a+':'+String(index).padStart(10,'0');
const outboxKey=(chat:string,seq:number)=>'chat-event:'+chat+':'+String(seq).padStart(16,'0');
const subKey=(id:string)=>'chat-subscription:'+id;
const channelSubKey=(id:string)=>'chat-channel-sub:'+id;
const channelDueKey=(at:number,chat:string,subscription:string)=>'chat-channel-due:'+padded(at)+':'+chat+':'+subscription;
const writerKey=(chat:string)=>'chat-writer:'+chat;
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const secret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const from64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const to64=(bytes:Uint8Array)=>{let s='';for(let offset=0;offset<bytes.length;offset+=8192)s+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(s);};
const integer=(value:unknown,label:string,min=0)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw fail('invalid_chat_argument',label+' 必须为整数');return value;};
const limitOf=(value:unknown)=>Math.min(integer(value===undefined?50:value,'limit',1),100);
const textValue=(value:unknown,label:string)=>{if(typeof value!=='string')throw fail('invalid_chat_argument',label+' 必须为文本');return value;};
const parseWebhookUrl=(value:unknown)=>{const url=textValue(value,'delivery.url'),parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw fail('invalid_callback','回调必须是无凭据的 HTTPS 地址');return url;};
const parseSigningKey=(value:unknown)=>{const signingKey=textValue(value,'delivery.secret');let decoded:Uint8Array;try{if(!signingKey.startsWith('whsec_'))throw Error();decoded=from64(signingKey.slice(6));}catch{throw fail('invalid_event_secret','签名密钥格式不正确');}if(decoded.length<24||decoded.length>64)throw fail('invalid_event_secret','签名密钥必须为 24 至 64 字节');return signingKey;};
const cursorOf=(value:unknown)=>value===null||value===undefined?0:typeof value==='string'&&/^m\d+$/.test(value)?Number(value.slice(1)):integer(value,'cursor');
const viewAttachment=(a:Attachment):AttachmentView=>({id:a.id,name:a.name,size:a.size,mime_type:a.mime_type,...(a.sha256?{sha256:a.sha256}:{})});
const modeRepository=(mode:ChatMode,repository?:RepositoryBinding)=>mode==='super_agent'?{repository:repository??null}:{};
const unboundRepository=(value:unknown)=>value===undefined||value===null||value==='none'||(typeof value==='object'&&!Array.isArray(value)&&(value as Data).provider==='none');

export const summaryDueEventDefinition={name:'chat.summary_due',description:'A configured chat needs context maintenance. Not a user message. Read chat.maintenance, claim its generation, read chat.working_context, then submit complete, unchanged or defer. History is context only; never resolve user inputs merely for maintenance.',delivery:['webhook'],inputSchema:{type:'object',properties:{chat_id:{type:'string'},connection:{type:'string'},handoff_id:{type:'string',description:'Optional prepared subscription handoff. Candidate delivery stays inactive until explicit activation.'}},required:['chat_id','connection'],additionalProperties:false},payloadSchema:{type:'object',properties:{chat_id:{type:'string'},connection:{type:'string'},generation:{type:'integer'},reason:{type:'string'},snapshot_through:{type:'integer'},summary_revision:{type:'integer'},url:{type:'string'}},required:['chat_id','connection','generation','reason','snapshot_through','summary_revision','url'],additionalProperties:false}};

export {channelEventDefinition} from './channel_contract';

export const chatEventDefinition={
  name:'chat.message',description:'One conversation event subscription for user messages, goal rounds, plan decisions and context maintenance. data.kind=context_maintenance is a system wake, NOT a user message: read/claim chat.maintenance, read chat.working_context, then complete/unchanged/defer; never reply or resolve user input merely for maintenance. Otherwise a person sent a message or attachment to a Computer Bridge conversation. User message events use payload_version=2 with canonical body and attachments in data.context.current_message. Available for Work and dots. Use data.connection from this signed event directly with chat.reply; do not call chat.resume without it. Each event contains anchored multi-message context and a server-selected mode. Chat is conversational and never dispatches tasks; Super Agent uses chat.task with upstream roles and explicit model-reported execution stages. data.kind=super_agent is a task-framework wake: read chat.task list; it is not a new human request. Prior messages are context only. Read history or attachments when context is missing or truncated. Other computer tools remain available. Model replies do not create this event. goal_round and plan_review are system wakes: claim with chat.goal or chat.plan before acting. The interaction_mode and interaction_revision describe the current collaboration mode.',delivery:['webhook'],
  inputSchema:{type:'object',properties:{chat_id:{type:'string',description:'Stable short conversation ID, e.g. t1.'},connection:{type:'string',description:'Original chat.resume credential, or data.connection from this subscription for renewal/unsubscribe.'},handoff_id:{type:'string',description:'Optional prepared subscription handoff. Candidate delivery stays inactive until explicit activation.'}},required:['chat_id','connection'],additionalProperties:false},
  payloadSchema:{type:'object',properties:{kind:{enum:['user_message','context_maintenance','super_agent','goal_round','plan_review']},interaction_mode:{enum:['normal','plan','auto']},interaction_revision:{type:'integer'},planning_request:{type:'boolean'},round_id:{type:'string'},goal_id:{type:'string'},goal_revision:{type:'integer'},round:{type:'integer'},review_id:{type:'string'},generation:{type:'integer'},reason:{type:'string'},snapshot_through:{type:'integer'},summary_revision:{type:'integer'},payload_version:{type:'integer'},chat_id:{type:'string'},mode:{enum:['chat','super_agent']},repository:{type:['object','null']},source_identity:{type:'object'},context:{type:['object','null']},command_processed:{type:['string','null']},approval_id:{type:['string','null']},processing:{type:'string'},connection:{type:'string',description:'Private reply/renewal credential for this active model subscription. Pass to chat.reply; never include in visible text or shared history.'},device_id:{type:'string'},message_id:{type:'string'},text:{type:'string'},text_truncated:{type:'boolean'},attachments_truncated:{type:'boolean'},attachments:{type:'array',items:{type:'object'}},url:{type:'string'}},required:['chat_id','connection','device_id','url'],anyOf:[{required:['kind','generation'],properties:{kind:{const:'super_agent'}}},{required:['message_id']},{required:['kind','round_id','goal_id','goal_revision','round'],properties:{kind:{const:'goal_round'}}},{required:['kind','review_id'],properties:{kind:{const:'plan_review'}}},{required:['kind','generation','reason','snapshot_through','summary_revision'],properties:{kind:{const:'context_maintenance'}}}],additionalProperties:false}
};

export class ChatService {
  private initialized?:Promise<void>;
  private uploadRequests=new Set<string>();
  private pumping?:Promise<void>;
  private superAgentPumping?:Promise<void>;
  private collaborationPumping?:Promise<void>;
  private wake?:()=>void;
  private wakeVersion=0;
  constructor(private store:Store,private accounts:Accounts,private env:ChatEnvironment){}

  private access(actor:ChatPrincipal,device:string,tx?:KeyStore):Promise<void>{return authorizeIdentity(this.accounts,this.store,actor,device,tx);}
  authenticateDevice(device:string,credential:string):Promise<ChatIdentity>{return authenticateDeviceIdentity(this.store,device,credential);}
  async authorize(actor:ChatPrincipal,chatId:string):Promise<{id:string;device:string;device_id:string}>{
    await this.initialize();const chat=await this.chat(chatId,actor);return {id:chat.id,device:chat.device,device_id:chat.device_id};
  }

  /** Validate a new command's fixed destination before it reaches a computer. */
  async approvalTarget(tx:KeyStore,actor:Actor,chatId:unknown,device:string):Promise<void>{
    if(typeof chatId!=='string'||!/^t[1-9][0-9]*$/.test(chatId))throw fail('approval_chat_required','聊天审批需要 approval_chat_id；请从 chat.list 选择这台电脑的对话');
    await this.accounts.assertAccessIn(tx,actor,device);
    const chat=await tx.get<Conversation>(key(chatId));
    if(!chat)throw fail('chat_not_found','目标对话不存在');
    if(chat.device!==device)throw fail('device_forbidden','审批目标对话与命令不属于同一台电脑');
  }

  /** Same transaction as the approval record; immutable command details are captured once. */
  async approvalCard(tx:KeyStore,record:Data,details?:Data):Promise<number|undefined>{
    if(!record.chat_id)return;
    const chat=await tx.get<Conversation>(key(record.chat_id));
    if(!chat||chat.device!==record.device)return;
    const ref='chat-approval:'+chat.id+':'+record.id;
    const sequence=await tx.get<number>(ref);
    const previous=sequence?await tx.get<Message>(messageKey(chat.id,sequence)):undefined;
    let message:Message;
    const state={state:record.state,...(record.decision?{decision:record.decision}:{}),delivery_pending:!!record.delivery_pending};
    if(previous){
      if(previous.approval?.state===state.state&&previous.approval?.decision===record.decision&&previous.approval?.delivery_pending===state.delivery_pending)return previous.sequence;
      message={...previous,approval:{...previous.approval,...state}};
    }else{
      if(!details)return;
      const account=await tx.get<Actor & {enabled:boolean}>('account:'+record.account);
      if(!account?.enabled||account.epoch!==record.account_epoch)return;
      try{await this.accounts.assertAccessIn(tx,account,record.device);}catch(error){
        if(['account_unavailable','device_forbidden','device_missing'].includes((error as Data).code))return;throw error;
      }
      const device=await tx.get<Data>('device:'+record.device);
      const n=++chat.sequence,stamp=now();
      message={id:'m'+n,sequence:n,role:'assistant',source:'model',kind:'approval',
        text:record.tool?'工具审批':'命令审批',attachments:[],created_at:stamp,saved_at:stamp,
        approval:{id:record.id,device_id:chat.device_id,device_name:device?.display_name??device?.name??chat.device_id,
          command:record.tool?.summary??details.command,cwd:record.tool?.cwd??details.cwd,
          justification:record.tool?.justification??details.justification,expires_at:record.expires_at,
          ...(record.tool?{tool:record.tool.method,request_id:record.tool.request_id}:{}),
          ...(record.projection.module_confirmation?{module_confirmation:record.projection.module_confirmation.message}:{}),
          ...(record.projection.permission_confirmation?{permission_confirmation:true}:{}),...state}};
      await tx.put(ref,n);
    }
    await this.indexPendingApproval(tx,record,message.sequence);
    chat.updated_at=now();
    await tx.put(messageKey(chat.id,message.sequence),message);
    await this.recordChange(tx,chat,[message.sequence]);
    return message.sequence;
  }

  private async indexPendingApproval(tx:KeyStore,record:Data,sequence:number):Promise<void>{
    const ref=pendingApprovalPrefix(record.chat_id)+padded(sequence);
    if(record.state==='pending'&&!record.decision)
      await tx.put(ref,{id:record.id,sequence,expires_at:record.expires_at} satisfies PendingApproval);
    else await tx.delete(ref);
  }

  private async changed(chat:string):Promise<void>{await this.env.changed?.(chat);}
  private async recordChange(tx:KeyStore,chat:Conversation,sequences:number[]=[],reviewId?:string):Promise<void>{
    chat.revision=(chat.revision??0)+1;
    const change:ChatChange={sequences,...(reviewId?{review_ids:[reviewId]}:{})};
    await tx.put({[key(chat.id)]:chat,[changeKey(chat.id,chat.revision)]:change});
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
    if(event.state==='pending'){
      await tx.put(pendingKey(event.chat,event.sequence),event.sequence);
      const deadlines=await tx.get<Record<string,number>>('runtime:deadlines')??{};
      deadlines.chat=Math.min(deadlines.chat??Infinity,event.next_at);
      await tx.put('runtime:deadlines',deadlines);await tx.requestAlarm?.(event.next_at);
    }
    else await tx.delete(pendingKey(event.chat,event.sequence));
    if(event.state==='delivered'||event.state==='resolved'||!event.subscription)await tx.delete(unackKey(event.chat,event.subscription,event.sequence));
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
      if(!await tx.get('chat:index-v2')){
        for(const event of (await tx.list<Outbox>({prefix:'chat-event:'})).values())await this.saveEvent(tx,event);
        for(const sub of (await tx.list<Subscription>({prefix:'chat-subscription:'})).values())await this.expiry(tx,'subscription',sub.id,sub.expires_at);
        for(const sub of (await tx.list<ChannelSubscription>({prefix:'chat-channel-sub:'})).values())await this.expiry(tx,'channel',sub.id,sub.expires_at);
        for(const [k,a] of await tx.list<Attachment>({prefix:'chat-attachment:'}))if(a.expires_at)await this.expiry(tx,'upload',k.slice('chat-attachment:'.length),a.expires_at);
        for(const [k,c] of await tx.list<Candidate>({prefix:'chat-candidate:'}))await this.expiry(tx,'candidate',k.slice('chat-candidate:'.length),c.expires_at);
        for(const l of (await tx.list<Link>({prefix:'chat-link:'})).values())await this.expiry(tx,'link',l.id,l.expires_at);
        for(const [k,at] of await tx.list<number>({prefix:'chat-link-denied:'}))await this.expiry(tx,'denied',k.slice('chat-link-denied:'.length),at);
        await tx.put('chat:index-v2',true);
      }
      if(!await tx.get('chat:index-device-v1')){
        for(const [storedKey,chat] of await tx.list<Conversation>({prefix:'chat:t'})){
          if(!/^chat:t[1-9]\d*$/.test(storedKey))continue;
          await tx.put({[indexKey(chat.id)]:chat.id,[deviceIndexKey(chat.device,chat.id)]:chat.id});
          if(chat.owner){
            // Old retry keys belonged to the original owner. Keep retries working after sharing.
            for(const operation of ['send','upload']){
              const prefix='chat-request:'+chat.id+':'+operation+':';
              for(const [old,value] of await tx.list({prefix})){
                const suffix=old.slice(prefix.length);if(suffix.includes(':'))continue;
                await tx.put(prefix+chat.owner+':'+suffix,value);await tx.delete(old);
              }
            }
            await tx.delete('chat-owner:'+chat.owner+':'+padded(Number(chat.id.slice(1))));
            delete chat.owner;await tx.put(key(chat.id),chat);
          }
        }
        for(const [k,sub] of await tx.list<Subscription>({prefix:'chat-subscription:'})){
          sub.event_connection??=secret();await tx.put(k,sub);
        }
        await tx.put('chat:index-device-v1',true);
      }
      if(!await tx.get('chat:stored-messages-v1')){
        for(const [storedKey,chat] of await tx.list<Conversation>({prefix:'chat:t'})){
          if(!/^chat:t[1-9]\d*$/.test(storedKey))continue;
          const sub=chat.active?await tx.get<Subscription>(subKey(chat.active)):undefined;
          if(sub){chat.writer=sub.id;await tx.put(writerKey(chat.id),{id:sub.id,chat:chat.id,account:sub.account,epoch:sub.epoch,caller:sub.caller,connection_hash:sub.connection_hash,event_connection:sub.event_connection!,callback_url:sub.url} satisfies Writer);}
          const storedMessages=await tx.list<Message>({prefix:'chat-message:'+chat.id+':'});
          const replies=new Map<string,string[]>();
          for(const m of storedMessages.values())if(m.role==='assistant'&&m.reply_to)replies.set(m.reply_to,[...(replies.get(m.reply_to)??[]),m.id]);
          for(const [mk,m] of storedMessages){
            if(replies.has(m.id))m.replies=replies.get(m.id);
            const legacy=m.delivery,t=await tx.get<Timing>(timingKey(chat.id,m.sequence));m.saved_at=m.created_at;
            if(legacy==='replied')m.replied_at=t?.reply_saved_at??m.created_at;
            delete m.delivery;await tx.put(mk,m);
            if(m.role==='user'){
              const old=await tx.get<Outbox>(outboxKey(chat.id,m.sequence));
              const acknowledged=old?.state==='delivered'||legacy==='delivered';
              const fatal=old?.error?.startsWith('http_4')&&!['http_408','http_429'].includes(old.error);
              const ready=!!sub&&(sub.expires_at===null||sub.expires_at>Date.now());
              await this.saveEvent(tx,{chat:chat.id,sequence:m.sequence,subscription:sub?.id??old?.subscription??'',attempts:old?.attempts??0,
                next_at:Math.max(Date.now(),old?.next_at??0),state:acknowledged?'delivered':legacy==='replied'?'resolved':fatal?'blocked':ready?'pending':'paused',
                ...(t?.host_accepted_at?{received_at:t.host_accepted_at}:{}),...(old?.error?{error:old.error}:{})});
            }
          }
          await this.recordChange(tx,chat,[...(await tx.list<Message>({prefix:'chat-message:'+chat.id+':'})).values()].map(m=>m.sequence));
        }
        await tx.put('chat:stored-messages-v1',true);
      }
    });
  }
  private background(work:()=>Promise<unknown>):void {
    const pending=Promise.resolve().then(work).catch(error=>console.error('chat_notification',error instanceof Error?error.name:'Error'));
    if(this.env.background)this.env.background(pending);else void pending;
  }
  private signal(chat:string):void {
    this.background(()=>this.changed(chat));this.background(()=>this.kick());this.background(()=>this.drainCollaboration());
  }
  async start():Promise<void>{await this.initialize();await Promise.all([this.kick(),this.drainCollaboration()]);}
  private async kick():Promise<void>{
    this.wakeVersion++;this.wake?.();
    // Durable queue writes arm the wake transactionally. Immediate delivery is an independent optimization.
    await this.drain();
  }
  private projectMessage(m:Message,event?:Outbox):Data {
    const state=!event?'none':event.state==='delivered'?'received':event.state==='resolved'?'none':event.state==='blocked'?'blocked':event.state==='paused'?'waiting':event.state==='failed'?'failed':event.error==='http_403'&&event.transient_403_attempts?'retrying':event.error?'unreachable':'pending';
    const {delivery:_,approval_origin:__,...body}=m;
    return {...body,saved:true,saved_at:m.saved_at??m.created_at,
      notification:{state,...(event?.received_at?{received_at:event.received_at}:{}),...(event?.error&&state!=='none'&&state!=='received'?{reason:event.error}:{}),...(event?.state==='pending'?{next_attempt_at:new Date(event.next_at).toISOString()}:{} )},
      reply:{state:m.replied_at?'replied':'none',message_ids:m.replies??[],...(m.replied_at?{at:m.replied_at}:{})},
      delivery:m.replied_at?'replied':m.role==='assistant'?'none':state==='received'?'delivered':'pending'};
  }
  private async viewMessage(tx:KeyStore,chat:string,m:Message):Promise<Data>{
    return {...this.projectMessage(m,m.role==='user'?await tx.get<Outbox>(outboxKey(chat,m.sequence)):undefined),
      ...(m.role==='user'&&!m.approval_id?{processing:await processingRecord(tx,chat,m)}:{})};
  }
  private async planReviewPage(tx:KeyStore,chat:string,first:number,last:number,after?:{anchor:number;revision:number}):Promise<Data>{
    const prefix=reviewTimelinePrefix(chat);
    const rows=[...(await tx.list<string>({prefix,limit:PLAN_REVIEWS_PER_PAGE+1,
      startAfter:after?reviewTimelineKey(chat,after.anchor,after.revision):reviewTimelineAnchor(chat,first),
      endBefore:reviewTimelineAnchor(chat,last)+'\uffff'})).entries()];
    const entries=rows.slice(0,PLAN_REVIEWS_PER_PAGE);
    const plan_reviews=(await Promise.all(entries.map(async ([,id])=>this.publicReview(await tx.get<PlanReview>(reviewKey(chat,id)),true)))).filter(Boolean);
    const lastKey=entries.at(-1)?.[0];
    if(rows.length<=PLAN_REVIEWS_PER_PAGE||!lastKey)return {plan_reviews};
    const position=lastKey.slice(prefix.length).split(':').map(Number);
    return {plan_reviews,review_next_cursor:[first,last,...position].join(':')};
  }

  private async pendingApprovalPositions(tx:KeyStore,chat:string):Promise<Pick<PendingApproval,'id'|'sequence'>[]>{
    // Existing chat cards predate this index. Seed them once without reading ordinary messages.
    const migrated='chat-approval-pending-index:'+chat;
    if(!await tx.get(migrated)){
      const prefix='chat-approval:'+chat+':';
      for(const [ref,sequence] of await tx.list<number>({prefix})){
        const record=await tx.get<Data>('command-approval:'+ref.slice(prefix.length));
        if(record?.chat_id===chat)await this.indexPendingApproval(tx,record,sequence);
      }
      await tx.put(migrated,true);
    }
    const now=Date.now();
    return [...(await tx.list<PendingApproval>({prefix:pendingApprovalPrefix(chat)})).values()]
      .filter(item=>item.expires_at>now).map(({id,sequence})=>({id,sequence}));
  }

  private async sync(chat:Conversation,args:Data,actor:ChatPrincipal):Promise<Data>{
    const after=integer(args.cursor??0,'cursor'),limit=Math.min(limitOf(args.limit),50);
    const snapshot=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));
      if(!current)throw fail('chat_deleted','对话已删除');
      if(!current.revision)await this.recordChange(tx,current);
      if(after>current.revision!)throw fail('invalid_chat_cursor','同步游标超过当前对话版本');
      let cursor=current.revision!,more=false,messages:Message[],reviews:Data;
      if(!after){
        messages=[...(await tx.list<Message>({prefix:'chat-message:'+chat.id+':',reverse:true,limit})).values()].reverse();
        const first=messages[0]?.sequence??0;
        reviews=await this.planReviewPage(tx,chat.id,first>1?first:0,current.sequence);
      }
      else{
        const rows=await tx.list<ChatChange>({prefix:'chat-change:'+chat.id+':',startAfter:changeKey(chat.id,after),limit:limit+1});
        const ids=new Set<number>(),reviewIds=new Set<string>();
        cursor=after;
        let count=0;
        for(const [k,change] of rows){
          const newReviews=(change.review_ids??[]).filter(id=>!reviewIds.has(id));
          if(count===limit||reviewIds.size+newReviews.length>PLAN_REVIEWS_PER_PAGE){more=true;break;}
          for(const id of newReviews)reviewIds.add(id);
          for(const sequence of change.sequences)ids.add(sequence);
          cursor=Number(k.split(':').at(-1));
          count++;
        }
        messages=[];
        for(const sequence of [...ids].sort((a,b)=>a-b)){const m=await tx.get<Message>(messageKey(chat.id,sequence));if(m)messages.push(m);}
        reviews={plan_reviews:(await Promise.all([...reviewIds].map(async id=>
          this.publicReview(await tx.get<PlanReview>(reviewKey(chat.id,id)),true)))).filter(Boolean)};
      }
      return {current,messages,cursor,more,reviews,pending_approvals:await this.pendingApprovalPositions(tx,chat.id),
        availability:await this.env.claimAvailability?.(tx,chat.device,chat.id,normalizeIdentity(actor))};
    });
    const first=snapshot.messages[0]?.sequence??0;
    const channel=sanitizeChannelCommand(await this.store.get<Data>(channelCommandKey(chat.id)));
    return {chat:await this.summary(snapshot.current,actor,undefined,true),...(channel?{channel}:{}),maintenance_statuses:await maintenanceStatuses(this.store,chat.id),
      messages:await Promise.all(snapshot.messages.map(m=>this.viewMessage(this.store,chat.id,m))),...snapshot.reviews,pending_approvals:snapshot.pending_approvals,...snapshot.availability,
      cursor:snapshot.cursor,more:snapshot.more,...(!after?{first_cursor:first,has_older:first>1}:{})};
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
  private async validSubscription(tx:KeyStore,sub:Subscription|undefined,device:string):Promise<boolean>{
    if(!sub||sub.expires_at!==null&&sub.expires_at<=Date.now())return false;
    const account=await tx.get<Actor>('account:'+sub.account);if(!account||account.epoch!==sub.epoch)return false;
    try{await this.accounts.assertAccessIn(tx,account,device);return true;}
    catch(error){if(['account_unavailable','device_forbidden','device_missing'].includes((error as Data).code))return false;throw error;}
  }
  private deviceView(id:string,actor:ChatPrincipal,views?:Map<string,Promise<ChatDevice>>):Promise<ChatDevice>{
    if(!views)return this.env.device(id,actor);
    let value=views.get(id);if(!value){value=this.env.device(id,actor);views.set(id,value);}return value;
  }
  private async chat(id:string,actor:ChatPrincipal,views?:Map<string,Promise<ChatDevice>>):Promise<Conversation>{
    await validateIdentity(this.accounts,this.store,actor);
    const value=await this.store.get<Conversation>(key(id));
    if(!value)throw fail('chat_not_found','对话不存在');
    await this.access(actor,value.device);
    await this.deviceView(value.device,actor,views);
    if(value.writer){
      const writer=await this.store.get<Writer>(writerKey(id));
      const owner=writer?await this.store.get<Actor>('account:'+writer.account):undefined;
      let valid=!!writer&&!!owner&&writer.epoch===owner.epoch;
      if(valid)try{await this.accounts.assertAccessIn(this.store,owner!,value.device);}catch(error){
        if(!['account_unavailable','device_forbidden','device_missing'].includes((error as Data).code))throw error;valid=false;
      }
      if(!valid){await this.release(id,value.writer);return (await this.store.get<Conversation>(key(id)))!;}
    }
    if(value.active){
      const sub=await this.store.get<Subscription>(subKey(value.active));
      if(!await this.validSubscription(this.store,sub,value.device)){
        const inspected=await this.store.transaction(async tx=>{
          const current=await tx.get<Conversation>(key(id));
          if(!current)throw fail('chat_not_found','对话不存在');
          await this.access(actor,current.device,tx);
          const live=current.active?await tx.get<Subscription>(subKey(current.active)):undefined;
          if(current.active&&!await this.validSubscription(tx,live,current.device)){
            await this.releaseIn(tx,current.id,current.active,false);
            return {current:(await tx.get<Conversation>(key(id)))!,released:true};
          }
          return {current,released:false};
        });
        if(inspected.released)await this.changed(id);return inspected.current;
      }
    }
    return value;
  }
  private async summary(chat:Conversation,actor:ChatPrincipal,views?:Map<string,Promise<ChatDevice>>,timeline=false):Promise<Data>{
    const device=await this.deviceView(chat.device,actor,views),mode=chatMode(chat.mode);
    const last=chat.sequence?await this.store.get<Message>(messageKey(chat.id,chat.sequence)):undefined;
    const lastView=last?await this.viewMessage(this.store,chat.id,last):undefined;
    return {id:chat.id,title:chat.title,mode,...modeRepository(mode,chat.repository),device_id:device.id,device_name:device.name,system:device.system,
      ...(mode==='chat'?{interaction_mode:chat.interaction_mode??'normal',interaction_revision:chat.interaction_revision??0,
        ...(!views?{goal:goalView(await this.store.get<GoalRecord>(goalKey(chat.id))),
          plan_review:chat.plan_review_id?this.publicReview(await this.store.get<PlanReview>(reviewKey(chat.id,chat.plan_review_id)),timeline):null}:{})}:{}),
      created_at:chat.created_at,updated_at:chat.updated_at,message_count:chat.sequence,state:chat.writer?'connected':'waiting',subscribed:!!chat.active,notification:lastView?.notification??{state:'none'},delivery_state:last?(last.role==='assistant'?'replied':lastView?.delivery):'none'};
  }
  private async next(tx:KeyStore,prefix:string):Promise<number>{const n=(await tx.get<number>('sequence:'+prefix)||0)+1;await tx.put('sequence:'+prefix,n);return n;}
  private async dedupe(tx:KeyStore,scope:string,requestKey:unknown,parameters:unknown):Promise<{key:string;fingerprint:string;result?:Data}>{
    if(typeof requestKey!=='string'||!requestKey)throw fail('request_key_required','请提供 request_key');
    const k='chat-request:'+scope+':'+await hash(requestKey),fingerprint=await hash(JSON.stringify(parameters));
    const previous=await tx.get<{fingerprint:string;result:Data}>(k);
    if(previous&&previous.fingerprint!==fingerprint)throw fail('request_key_conflict','同一 request_key 的参数不一致');
    return {key:k,fingerprint,result:previous?.result};
  }
  /** Stable reply identity survives a legitimate writer change; current authorization is checked by the caller. */
  private async replyDedupe(tx:KeyStore,chat:string,requestKey:unknown,text:string,ids:string[],replyTo:unknown,resolves:string[]|undefined,revision:unknown){
    if(typeof requestKey!=='string'||!requestKey)throw fail('request_key_required','请提供 request_key');
    const k='chat-request:'+chat+':reply:'+await hash(requestKey),fingerprint=await hash(JSON.stringify([text,ids,replyTo??null,resolves??[],resolves?revision:null]));
    const previous=await tx.get<{version?:number;fingerprint:string;result:Data}>(k);
    if(previous){
      if(previous.version===2){if(previous.fingerprint!==fingerprint)throw fail('request_key_conflict','同一 request_key 的参数不一致');}
      else{
        const saved=await tx.get<Message>(messageKey(chat,previous.result.sequence));
        if(!saved)throw fail('reply_receipt_inconsistent','回复回执存在，但原始消息缺失；不能直接重发');
        if(saved.text!==text||JSON.stringify(saved.attachments.map(a=>a.id))!==JSON.stringify(ids)||(saved.reply_to??null)!==(replyTo??null)||resolves?.length)throw fail('request_key_conflict','同一 request_key 的参数不一致');
      }
    }
    return {key:k,fingerprint,result:previous?.result};
  }
  async action(action:string,args:Data,actor:ChatPrincipal,caller=''):Promise<Data>{
    await validateIdentity(this.accounts,this.store,actor);await this.initialize();
    if(action==='channel'){
      const identity=normalizeIdentity(actor);
      const targetChat=args.chat_id!==undefined?await this.chat(textValue(args.chat_id,'chat_id'),actor):undefined;
      if(caller){
        const account=modelActor(actor);
        const active=await this.activeChannelSubs(targetChat?.device,account.id,account.epoch);
        const recent_diagnostics=await readChannelDiagnostics(this.store,account.id,targetChat?.id);
        const outboxRows=[...(await this.store.list<ChannelOutbox>({prefix:targetChat?'chat-channel-outbox:'+targetChat.id+':':'chat-channel-outbox:'})).values()]
          .filter(job=>job.account===account.id)
          .map(job=>({chat_id:job.chat,subscription_id:job.subscription,action:job.action,attempts:job.attempts,next_at:new Date(job.next_at).toISOString(),...(job.last_error?{last_error:job.last_error}:{})}));
        const command=targetChat?sanitizeChannelCommand(await this.store.get<Data>(channelCommandKey(targetChat.id))):undefined;
        return {subscribed:active.length>0,channel_count:active.length,caller_subscribed:active.some(sub=>sub.caller===caller),
          subscriptions:active.map(sub=>({id:sub.id,verified_at:sub.verified_at,expires_at:sub.expires_at,caller_match:sub.caller===caller})),
          recent_diagnostics,pending_deliveries:outboxRows,...(command?{command}:{}),
          event:{name:channelEventDefinition.name,arguments:{}},
          next_step:(active.length?'Plugin-level notification channel (chat.channel) is active. Reuse this subscription.':'No active plugin-level notification channel found. Subscribe now using the host MCP events/subscribe capability with name="chat.channel" and arguments={} so /new, /connect, /disconnect, and /delete wake Dot automatically.')+' '+channelDeleteInstructions};
      }
      const deviceScope=targetChat?.device??(identity.kind==='device'?identity.device:undefined);
      const active=await this.activeChannelSubs(deviceScope,identity.kind==='account'?identity.actor.id:undefined,identity.kind==='account'?identity.actor.epoch:undefined);
      let recent_diagnostics:ChannelDiagnostic[];
      if(identity.kind==='account')recent_diagnostics=await readChannelDiagnostics(this.store,identity.actor.id,targetChat?.id);
      else{
        const combined:ChannelDiagnostic[]=[...await readChannelDiagnostics(this.store,principalScope(actor),targetChat?.id)];
        const accounts=new Set(active.map(sub=>sub.account));
        for(const [k] of await this.store.list<ChannelDiagnostic[]>({prefix:'chat-channel-diagnostics:'})){
          const acct=k.slice('chat-channel-diagnostics:'.length);
          if(acct.startsWith('device:'))continue;
          if(accounts.has(acct)){combined.push(...await readChannelDiagnostics(this.store,acct,targetChat?.id));continue;}
          const owner=await this.store.get<Actor & {enabled?:boolean}>('account:'+acct);
          if(!owner?.enabled)continue;
          try{await this.accounts.assertAccessIn(this.store,owner,deviceScope!);combined.push(...await readChannelDiagnostics(this.store,acct,targetChat?.id));}catch{}
        }
        recent_diagnostics=combined.sort((a,b)=>a.at.localeCompare(b.at)).slice(-12);
      }
      const command=targetChat?sanitizeChannelCommand(await this.store.get<Data>(channelCommandKey(targetChat.id))):undefined;
      return {subscribed:active.length>0,channel_count:active.length,
        subscriptions:active.map(sub=>({id:sub.id,verified_at:sub.verified_at,expires_at:sub.expires_at})),
        recent_diagnostics,...(command?{command}:{})};
    }
    if(action==='list'){
      const views=new Map<string,Promise<ChatDevice>>();
      const identity=normalizeIdentity(actor);
      const requested=args.device_id?await this.env.device(args.device_id,actor):identity.kind==='device'?await this.env.device(identity.device,actor):null;
      if(requested)views.set(requested.raw,Promise.resolve(requested));
      if(requested)await this.access(actor,requested.raw);
      const after=integer(args.after??0,'after'),limit=limitOf(args.limit);
      const prefix=requested?'chat-device:'+requested.raw+':':'chat-index:';
      const chats:Data[]=[];let last=after,more=false;
      for(;;){
        const rows=await this.store.list<string>({prefix,startAfter:prefix+padded(last),limit:100});
        for(const id of rows.values()){
          let current:Data|undefined;
          try{const c=await this.chat(id,actor,views);current=await this.summary(c,actor,views);}
          catch(e){if(!['chat_not_found','device_forbidden','device_missing'].includes((e as Data).code))throw e;}
          if(current&&chats.length===limit){more=true;break;}
          last=Number(id.slice(1));if(current)chats.push(current);
        }
        if(more||rows.size<100)break;
      }
      return {chats,next_cursor:more?last:null};
    }
    if(action==='create'){
      const device=await this.env.device(args.device_id,actor);await this.access(actor,device.raw);
      const title=args.title===undefined?'新对话':textValue(args.title,'title').trim()||'新对话';
      const mode=chatMode(args.mode);
      if(mode!=='super_agent'&&!unboundRepository(args.repository))throw fail('chat_mode_mismatch','Chat 模式不支持绑定仓库；如需绑定仓库请新建 Super Agent 对话');
      const repository=mode==='super_agent'?normalizeRepository(args.repository):null;
      let reused=false;
      const chat=await this.store.transaction(async tx=>{
        await this.access(actor,device.raw,tx);
        const d=await this.dedupe(tx,principalScope(actor)+':create',args.request_key,mode==='chat'?[device.raw,title]:[device.raw,title,mode,repository]);
        if(d.result){reused=true;const existing=await tx.get<Conversation>(key(d.result.id));if(!existing)throw fail('chat_deleted','原对话已删除');return existing;}
        const n=await this.next(tx,'t'),id='t'+n,stamp=now();
        const c:Conversation={id,mode,...(mode==='super_agent'?{repository}:{}),device:device.raw,device_id:device.id,title,created_at:stamp,updated_at:stamp,sequence:0,attachments:0};
        await tx.put({[key(id)]:c,[indexKey(id)]:id,[deviceIndexKey(device.raw,id)]:id,[d.key]:{fingerprint:d.fingerprint,result:{id}}});return c;
      });
      if(!caller&&args.auto_connect!==false){
        const source=args.source==='tui'?'tui':'web';
        const channel=(!reused||(!chat.active&&!chat.writer))?await this.notifyChannel('connect',chat,actor,source):{state:'notified',active:chat.active?1:0,delivered:chat.active?1:0,failed:0};
        return {chat:await this.summary(chat,actor),channel};
      }
      return {chat:await this.summary(chat,actor)};
    }
    const chat=await this.chat(textValue(args.chat_id,'chat_id'),actor);
    if(action==='get'){
      const context_status=await this.store.transaction(async tx=>{
        await this.access(actor,chat.device,tx);
        const state=await tx.get<Maintenance>(maintenanceKey(chat.id));
        const {subscription}=await this.maintenanceRoute(tx,chat.id);
        const binding=await tx.get<Writer>(writerKey(chat.id)),current=await tx.get<Conversation>(key(chat.id));
        const maintenanceActive=!!subscription&&!!binding&&current?.writer===binding.id
          &&(subscription.writer_id??subscription.id.replace(/-summary$/,''))===binding.id
          &&subscription.account===binding.account&&subscription.epoch===binding.epoch&&subscription.caller===binding.caller
          &&await this.validSubscription(tx,subscription,chat.device);
        return {read_only:true,token_accounting:await tx.get<Data>('chat-context-index:'+chat.id)??null,
          maintenance:state?Object.fromEntries(['generation','last_activity','checked_through','next_at','state','reason','snapshot','summary_revision','lease_until','attempts','notified','status_id'].filter(k=>state[k as keyof Maintenance]!==undefined).map(k=>[k,state[k as keyof Maintenance]])):null,
          maintenance_subscribed:maintenanceActive,maintenance_subscription_expires_at:subscription?.expires_at??null,
          subscription_handoff_version:1,maintenance_subscription_diagnostics:await readMaintenanceDiagnostics(tx,chat.id)};
      });
      return {chat:await this.summary(chat,actor),maintenance_statuses:await maintenanceStatuses(this.store,chat.id),context_status};
    }
    if(action==='working_context'&&chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','Working context is for Chat mode');
    if(action==='working_context')return this.store.transaction(async tx=>{await this.access(actor,chat.device,tx);return readWorkingContext(tx,chat.id,chat.sequence,args);});
    if(action==='subscription_handoff')return this.handoffAction(chat,args,actor,caller);
    if(action==='maintenance')return this.maintenanceAction(chat,args,actor,caller);
    if(action==='history')return this.history(chat,args,actor,!caller);
    if(action==='context')return {context:await this.context(chat,args)};
    if(action==='pending')return this.pending(chat,args,actor);
    if(action==='receipt')return this.receipt(chat,args,actor);
    if(action==='processing')return this.processing(chat,args,actor,caller);
    if(action==='summary'||action==='trace')return this.contextRecord(action,chat,args,actor,caller);
    if(action==='repository'){
      if(chatMode(chat.mode)!=='super_agent')throw fail('chat_mode_mismatch','Chat 模式不支持绑定或读取仓库；请新建 Super Agent 对话');
      await this.access(actor,chat.device);
      const scope={chatId:chat.id,deviceId:chat.device,principal:actor,repository:chat.repository??null};
      const result=await readRepository(scope.repository,args as RepositoryReadRequest,this.env.repositoryFetch?{fetch:(url,init)=>this.env.repositoryFetch!(scope,url,init)}:{});
      // A slow platform response must not reveal content after this chat grant was revoked.
      await this.chat(chat.id,actor);return result;
    }
    if(action==='task')return this.task(chat,args,actor,caller);
    if(['interaction','goal','plan'].includes(action))return this.collaborationAction(action,chat,args,actor,caller);
    if(action==='sync')return this.sync(chat,args,actor);
    if(action==='timing')return this.timing(chat,args);
    if(action==='rename'){
      const title=textValue(args.title,'title').trim();if(!title)throw fail('invalid_chat_argument','标题不能为空');
      const updated=await this.store.transaction(async tx=>{await this.access(actor,chat.device,tx);const c=await tx.get<Conversation>(key(chat.id));if(!c)throw fail('chat_deleted','对话已删除');c.title=title;c.updated_at=now();await this.recordChange(tx,c);return c;});
      await this.changed(chat.id);return {chat:await this.summary(updated,actor)};
    }
    if(action==='delete'){
      const source=args.source==='tui'?'tui':'web';
      const erased=await this.erase(chat,actor);
      if(!caller&&erased){
        const channel=await this.notifyChannel('delete',chat,actor,source);
        return {deleted:true,channel};
      }
      return {deleted:true};
    }
    if(action==='resume')return this.resume(chat,args,actor,caller);
    if(action==='disconnect'){
      const writer=await this.connection(chat,args.connection,actor,caller);await this.release(chat.id,writer.id);return {disconnected:true,chat_id:chat.id};
    }
    if(action==='send'||action==='reply')return this.send(chat,args,actor,caller,action==='reply');
    if(action==='upload-start')return this.startUpload(chat,args,actor);
    if(action==='upload-chunk')return this.writeUpload(chat,args,actor);
    if(action==='upload-complete')return this.completeUpload(chat,args,actor);
    if(action==='attachment')return {attachment:viewAttachment(await this.attachment(chat.id,args.attachment_id,true))};
    if(action==='read-attachment')return this.readAttachment(chat,args);
    throw fail('unknown_chat_action','未知聊天操作');
  }
  private handoffScope(chat:Conversation,writer:Writer,actor:ChatPrincipal):HandoffScope{
    return {chatId:chat.id,writer,authorize:async tx=>{await this.access(actor,chat.device,tx);const c=await tx.get<Conversation>(key(chat.id)),w=await tx.get<Writer>(writerKey(chat.id));return c?.writer===w?.id?w:undefined;}};
  }
  private handoffPort():HandoffPort{return {
    readRouting:async(tx,id)=>{
      const c=await tx.get<Conversation>(key(id)),w=await tx.get<Writer>(writerKey(id));
      const normal=c?.active?await tx.get<Subscription>(subKey(c.active)):undefined,summary=await tx.get<Subscription>(subscriptionKey(id));
      const normalize=(sub:Subscription,event_name:'chat.message'|'chat.summary_due')=>({...sub,writer_id:sub.writer_id??w?.id??'',event_name}) as HandoffEndpoint;
      return {revision:await tx.get<number>('chat-routing-revision:'+id)??0,endpoints:{...(normal?{'chat.message':normalize(normal,'chat.message')}:{}),...(summary?{'chat.summary_due':normalize(summary,'chat.summary_due')}:{})}};
    },
    writeRouting:async(tx,id,next,previous)=>{
      const c=await tx.get<Conversation>(key(id)),w=await tx.get<Writer>(writerKey(id));if(!c||!w)throw fail('chat_not_connected','Writer ended');
      const normal=next.endpoints['chat.message'] as unknown as Subscription|undefined,summary=next.endpoints['chat.summary_due'] as unknown as Subscription|undefined;
      // Retain old endpoint identities for exact unsubscribe and rollback, never old credentials in output.
      for(const endpoint of Object.values(previous.endpoints))if(endpoint)await tx.put(subKey(endpoint.id),endpoint);
      for(const endpoint of Object.values(next.endpoints))if(endpoint){await tx.put(subKey(endpoint.id),endpoint);await this.expiry(tx,'subscription',endpoint.id,endpoint.expires_at);}
      if(normal){c.active=normal.id;w.callback_url=normal.url;delete c.reconnect_until;}else delete c.active;
      if(summary)await tx.put(subscriptionKey(id),summary);else await tx.delete(subscriptionKey(id));
      await tx.put(writerKey(id),w);await tx.put('chat-routing-revision:'+id,next.revision);
      if(normal?.id!==previous.endpoints['chat.message']?.id)for(const e of (await tx.list<Outbox>({prefix:'chat-event:'+id+':'})).values()){
        if(['delivered','resolved','failed'].includes(e.state))continue;
        if(normal){e.subscription=normal.id;if(e.state==='paused'){e.state='pending';e.next_at=Date.now();}}else e.state='paused';
        await this.saveEvent(tx,e);
      }
      const m=await tx.get<Maintenance>(maintenanceKey(id));
      if(summary&&summary.id!==previous.endpoints['chat.summary_due']?.id&&m?.state==='waiting'&&!m.notified){m.next_at=Date.now();await persist(tx,id,m);}
      if(normal&&chatMode(c.mode)==='chat'){await this.rearmCollaborationWake(tx,c);await this.scheduleGoal(tx,c);}
      await this.recordChange(tx,c);await tx.requestAlarm?.(Date.now());
    }
  };}
  private async handoffAction(chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    const writer=await this.connection(chat,args.connection,actor,caller);
    const result=await this.store.transaction(async tx=>{
      const result=await subscriptionHandoff(tx,this.handoffScope(chat,writer,actor),this.handoffPort(),args as any);
      if(['abort','finalize','rollback'].includes(args.operation)){
        const routes=await this.handoffPort().readRouting(tx,chat.id),active=new Set(Object.values(routes.endpoints).map(e=>e?.id));
        for(const endpoint of (await tx.list<Subscription>({prefix:'chat-subscription:'})).values())if(endpoint.chat===chat.id&&endpoint.writer_id===writer.id&&!active.has(endpoint.id)){
          await tx.delete(subKey(endpoint.id));await this.expiry(tx,'subscription',endpoint.id);
        }
      }
      return result;
    });
    if(args.operation!=='read')this.signal(chat.id);return result;
  }
  private async stagedEvent(method:'subscribe'|'unsubscribe',args:Data,actor:Actor,caller:string):Promise<Data>{
    const input=args.arguments,chat=await this.chat(textValue(input.chat_id,'chat_id'),actor),writer=await this.connection(chat,input.connection,actor,caller);
    const event=args.name as 'chat.message'|'chat.summary_due',id=candidateEndpointId(textValue(input.handoff_id,'handoff_id'),event),url=textValue(args.delivery?.url,'url'),u=new URL(url);
    if(args.delivery?.mode!=='webhook'||u.protocol!=='https:'||u.username||u.password||u.hash)throw fail('invalid_callback','Verified HTTPS webhook required');
    const scope=this.handoffScope(chat,writer,actor),port=this.handoffPort();
    if(method==='unsubscribe'){
      await this.store.transaction(async tx=>{const old=await tx.get<Subscription>(subKey(id));if(!old||old.url!==url||old.writer_id!==writer.id)return;
        await unsubscribeHandoffEndpoint(tx,scope,port,event,id);await tx.delete(subKey(id));await this.expiry(tx,'subscription',id);});this.signal(chat.id);return {};
    }
    const signingKey=textValue(args.delivery.secret,'secret');let bytes:Uint8Array;
    try{if(!signingKey.startsWith('whsec_'))throw Error();bytes=from64(signingKey.slice(6));}catch{throw fail('invalid_event_secret','Invalid signing key');}
    if(bytes.length<24||bytes.length>64)throw fail('invalid_event_secret','Invalid signing key');
    const expires_at=args.ttlMs===null?null:Date.now()+integer(args.ttlMs??86400_000,'ttlMs',1);
    await this.verify(url,signingKey,id,chat.id);
    await this.store.transaction(async tx=>{
      const endpoint={id,writer_id:writer.id,event_name:event,handoff_id:input.handoff_id,chat:chat.id,account:actor.id,epoch:actor.epoch,caller,connection_hash:writer.connection_hash,event_connection:writer.event_connection,url,secret:signingKey,expires_at,cursor:0,verified_at:Date.now()};
      await stageHandoffEndpoint(tx,scope,port,input.handoff_id,endpoint);const live=(await port.readRouting(tx,chat.id)).endpoints[event];await tx.put(subKey(id),live?.id===id?live:endpoint);
    });return {id,refreshBefore:expires_at===null?null:new Date(expires_at).toISOString(),cursor:null,truncated:false};
  }
  private async maintenanceRoute(tx:KeyStore,id:string):Promise<{subscription?:Subscription;key:string;event:'chat.message'|'chat.summary_due'}>{
    const legacy=await tx.get<Subscription>(subscriptionKey(id));
    if(legacy)return {subscription:legacy,key:subscriptionKey(id),event:'chat.summary_due'};
    const chat=await tx.get<Conversation>(key(id)),k=chat?.active?subKey(chat.active):'';
    const normal=k?await tx.get<Subscription>(k):undefined;
    return {subscription:normal?.unified_context?normal:undefined,key:k,event:'chat.message'};
  }
  private async maintenanceAction(chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','Context maintenance is for Chat mode');
    const writer=args.operation==='read'?undefined:await this.connection(chat,args.connection,actor,caller);
    const result=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);const current=await tx.get<Conversation>(key(chat.id));
      if(!current)throw fail('chat_deleted','Chat deleted');
      if(writer&&current.writer!==writer.id)throw fail('chat_not_connected','Writer changed');
      if(args.operation==='read')return {maintenance:publicMaintenance(await observeContext(tx,chat.id,current.sequence))};
      if(args.operation==='enable_events'){
        textValue(args.request_key,'request_key');
        const sub=current.active?await tx.get<Subscription>(subKey(current.active)):undefined;
        if(!sub||(sub.writer_id??sub.id)!==writer!.id||sub.account!==writer!.account||sub.epoch!==writer!.epoch||sub.caller!==writer!.caller||!await this.validSubscription(tx,sub,chat.device))throw fail('chat_subscription_required','A valid existing message subscription is required');
        if(await tx.get(subscriptionKey(chat.id)))throw fail('legacy_maintenance_subscription_present','Remove the separate maintenance subscription before enabling the single event');
        const already_enabled=sub.unified_context===true;
        if(!already_enabled){sub.unified_context=true;await tx.put(subKey(sub.id),sub);}
        const state=await tx.get<Maintenance>(maintenanceKey(chat.id));
        if(state?.state==='waiting'&&!state.notified&&state.next_at===null){state.next_at=Date.now();await persist(tx,chat.id,state);}
        if(!already_enabled)await this.recordChange(tx,current);
        return {enabled:true,already_enabled,event:'chat.message',maintenance:state?publicMaintenance(state):null};
      }
      const result=await maintain(tx,chat.id,current.sequence,args,{id:writer!.id,account:writer!.account,epoch:writer!.epoch,caller:writer!.caller});
      await this.recordChange(tx,current);return result;
    });this.signal(chat.id);return result;
  }
  private async maintenanceEvents(method:'subscribe'|'unsubscribe',args:Data,actor:Actor,caller:string):Promise<Data>{
    const input=args.arguments??{},chat=await this.chat(textValue(input.chat_id,'chat_id'),actor);
    // Audit only a chat the caller can access. Diagnostic failure never masks the protocol result.
    const note=async(phase:MaintenanceDiagnosticPhase,error?:unknown)=>{
      try{await this.store.transaction(async tx=>{await this.access(actor,chat.device,tx);if(await tx.get(key(chat.id)))await recordMaintenanceDiagnostic(tx,chat.id,method,phase,error);});}catch{}
    };
    await note('entered');
    try{
      if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','Maintenance is for Chat mode');
      const writer=await this.connection(chat,input.connection,actor,caller),k=subscriptionKey(chat.id);
      if(method==='unsubscribe'){
        if(args.delivery?.mode!=='webhook')throw fail('invalid_event','Webhook required');
        const callback=textValue(args.delivery.url,'url');
        await this.store.transaction(async tx=>{
          await this.access(actor,chat.device,tx);const current=await tx.get<Conversation>(key(chat.id));if(current?.writer!==writer.id)throw fail('chat_not_connected','Writer changed');
          const existing=await tx.get<Subscription>(k);
          // A delayed cleanup from an older host task must never remove a replacement endpoint.
          if(!existing){await recordMaintenanceDiagnostic(tx,chat.id,method,'unsubscribed').catch(()=>{});return;}
          if(existing.url!==callback||existing.account!==actor.id||existing.epoch!==actor.epoch||existing.caller!==caller)return;
          await tx.delete(k);await recordMaintenanceDiagnostic(tx,chat.id,method,'unsubscribed').catch(()=>{});
        });return {};
      }
      if(args.delivery?.mode!=='webhook')throw fail('invalid_event','Webhook required');
      const url=textValue(args.delivery.url,'url'),u=new URL(url);
      if(u.protocol!=='https:'||u.username||u.password||u.hash)throw fail('invalid_callback','Invalid callback');
      const secretKey=textValue(args.delivery.secret,'secret');
      if(!secretKey.startsWith('whsec_')||from64(secretKey.slice(6)).length<24||from64(secretKey.slice(6)).length>64)throw fail('invalid_event_secret','Invalid signing key');
      const existing=await this.store.get<Subscription>(k);
      if(existing&&existing.url!==url)throw fail('chat_in_use','Maintenance subscription already bound');
      const id=writer.id+'-summary',expires_at=args.ttlMs===null?null:Date.now()+integer(args.ttlMs??86400_000,'ttlMs',1);
      await this.verify(url,secretKey,id,chat.id);await note('verification_passed');
      await this.store.transaction(async tx=>{
        await this.access(actor,chat.device,tx);const current=await tx.get<Conversation>(key(chat.id));if(current?.writer!==writer.id)throw fail('chat_not_connected','Writer changed');
        // Verification awaits network I/O; recheck callback ownership under the
        // same transaction that commits it, so concurrent registrants cannot overwrite.
        const liveSub=await tx.get<Subscription>(k);
        if(liveSub&&liveSub.url!==url)throw fail('chat_in_use','Maintenance subscription already bound');
        await tx.put(k,{id,writer_id:writer.id,event_name:'chat.summary_due',chat:chat.id,account:actor.id,epoch:actor.epoch,caller,connection_hash:writer.connection_hash,event_connection:writer.event_connection,url,secret:secretKey,expires_at,cursor:0,verified_at:Date.now()});
        const m=await tx.get<Maintenance>(maintenanceKey(chat.id));if(m?.state==='waiting'&&(!liveSub||liveSub.expires_at!==null&&liveSub.expires_at<=Date.now())){m.next_at=Date.now();m.notified=false;await persist(tx,chat.id,m);}
        await recordMaintenanceDiagnostic(tx,chat.id,method,'stored').catch(()=>{});
      });await this.env.schedule(Date.now());return {id,refreshBefore:expires_at===null?null:new Date(expires_at).toISOString(),cursor:null,truncated:false};
    }catch(error){await note('failed',error);throw error;}
  }
  private async maintenanceAlarm():Promise<void>{
    for(const [k,old] of await this.store.list<Maintenance>({prefix:'chat-maintenance:'})){
      if(old.next_at===null||old.next_at>Date.now())continue;
      const id=k.slice('chat-maintenance:'.length),chat=await this.store.get<Conversation>(key(id));if(!chat)continue;
      let state=await this.store.transaction(async tx=>{const live=await tx.get<Conversation>(key(id));if(!live)return null;const s=await observeContext(tx,id,live.sequence);await this.recordChange(tx,live);return s;});
      if(!state)continue;
      this.background(()=>this.changed(id));
      if(state.state!=='waiting'||state.notified)continue;
      const route=await this.maintenanceRoute(this.store,id),sub=route.subscription;
      if(!sub||sub.expires_at!==null&&sub.expires_at<=Date.now()){
        await this.store.transaction(async tx=>{const current=await tx.get<Maintenance>(maintenanceKey(id));if(current?.generation===state!.generation&&current.state==='waiting'&&!current.notified){current.next_at=null;await updateStatus(tx,id,current,'waiting','等待上下文检查：摘要事件尚未接入或连接已失效。');await persist(tx,id,current);const live=await tx.get<Conversation>(key(id));if(live)await this.recordChange(tx,live);}});this.background(()=>this.changed(id));continue;
      }
      try{const actor=await this.accounts.require(sub.account,sub.epoch);await this.chat(id,actor);
        const writer=await this.store.get<Writer>(writerKey(id));if(!writer||(sub.writer_id??sub.id.replace(/-summary$/,''))!==writer.id){await this.store.transaction(async tx=>{const current=await tx.get<Maintenance>(maintenanceKey(id));if(current?.generation===state!.generation&&current.state==='waiting'&&!current.notified){current.next_at=null;await updateStatus(tx,id,current,'waiting','等待上下文检查：摘要事件尚未接入或连接已失效。');await persist(tx,id,current);const live=await tx.get<Conversation>(key(id));if(live)await this.recordChange(tx,live);}});this.background(()=>this.changed(id));continue;}
      }catch{await this.store.transaction(async tx=>{const current=await tx.get<Maintenance>(maintenanceKey(id));if(current?.generation===state!.generation&&current.state==='waiting'&&!current.notified){current.next_at=null;await updateStatus(tx,id,current,'waiting','等待上下文检查：摘要事件尚未接入或连接已失效。');await persist(tx,id,current);const live=await tx.get<Conversation>(key(id));if(live)await this.recordChange(tx,live);}});this.background(()=>this.changed(id));continue;}
      const deliveryToken=secret();
      const acquired=await this.store.transaction(async tx=>{const current=await tx.get<Maintenance>(maintenanceKey(id)),liveSub=(await this.maintenanceRoute(tx,id)).subscription;
        if(!current||current.generation!==state!.generation||current.state!=='waiting'||current.notified||(current.delivery_lease??0)>Date.now()||liveSub?.id!==sub.id||liveSub.url!==sub.url)return false;
        current.delivery_token=deliveryToken;current.delivery_lease=Date.now()+30_000;current.next_at=current.delivery_lease;await persist(tx,id,current);return beginRouteDelivery(tx,this.handoffPort(),id,route.event,sub.id,id+'-summary-'+state!.generation);});
      if(!acquired)continue;
      const event={eventId:id+'-summary-'+state!.generation,name:route.event,timestamp:new Date().toISOString(),data:{...(route.event==='chat.message'?{kind:'context_maintenance',device_id:chat.device_id,mode:'chat',payload_version:3}:{}),chat_id:id,connection:sub.event_connection,generation:state.generation,reason:state.reason,snapshot_through:state.snapshot,summary_revision:state.summary_revision,url:this.env.publicUrl+'/chat?id='+id},cursor:null};
      let status=0;try{const response=await this.signed(sub,event);status=response.status;await response.body?.cancel();}catch{}
      await this.store.transaction(async tx=>finishRouteDelivery(tx,acquired,async()=>{
        const current=await tx.get<Maintenance>(maintenanceKey(id)),liveSub=(await this.maintenanceRoute(tx,id)).subscription;if(!current||current.generation!==state!.generation||current.state!=='waiting'||current.delivery_token!==deliveryToken||liveSub?.id!==sub.id||liveSub.url!==sub.url)return;
        current.delivery_token=undefined;current.delivery_lease=0;current.attempts++;
        if(status>=200&&status<300){current.notified=true;current.next_at=null;await updateStatus(tx,id,current,'waiting','上下文检查通知已被接收，等待宿主执行。');}
        else if(status===410||status===413||status>=400&&status<500&&![408,429].includes(status)||current.attempts>=5){current.next_at=null;current.state='failed';if(current.status_id)await updateStatus(tx,id,current,'failed','整理通知未获确认，已暂停自动重试；原文已保留。');}
        else current.next_at=Date.now()+Math.min(300_000,30_000*2**(current.attempts-1));
        await persist(tx,id,current);const live=await tx.get<Conversation>(key(id));if(live)await this.recordChange(tx,live);
      },status>=200&&status<300?'accepted':status>=400&&status<500&&status!==408?'not_accepted':'uncertain'));this.background(()=>this.changed(id));
    }
  }
  private async pending(chat:Conversation,args:Data,actor:ChatPrincipal):Promise<Data>{
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      if(args.message_id!==undefined){
        const message=await tx.get<Message>(messageKey(chat.id,cursorOf(args.message_id)));
        if(!message||message.role!=='user'||message.approval_id)throw fail('message_not_found','用户输入不存在');
        return {chat_id:chat.id,...await processingMeta(tx,chat.id,current.sequence),latest_sequence:current.sequence,
          items:[await processingRecord(tx,chat.id,message)],next_cursor:null};
      }
      return {chat_id:chat.id,...await listPending(tx,chat.id,current.sequence,integer(args.after??0,'after'),limitOf(args.limit))};
    });
  }
  private async receipt(chat:Conversation,args:Data,actor:ChatPrincipal):Promise<Data>{
    const requestKey=textValue(args.request_key,'request_key');if(!requestKey)throw fail('request_key_required','请提供 request_key');
    const request='chat-request:'+chat.id+':reply:'+await hash(requestKey);
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const saved=await tx.get<{result:{sequence:number}}>(request);
      if(!saved)return {chat_id:chat.id,found:false,saved:false,state:'not_found',external_effects:'unknown'};
      const message=await tx.get<Message>(messageKey(chat.id,saved.result.sequence));
      if(!message)throw fail('reply_receipt_inconsistent','回复回执存在，但原始消息缺失；不能直接重发');
      return {chat_id:chat.id,found:true,saved:true,message:await this.viewMessage(tx,chat.id,message),delivery_confirmed:false};
    });
  }
  private async inputMessages(tx:KeyStore,chat:string,value:unknown):Promise<Message[]>{
    if(!Array.isArray(value)||value.length<1||value.length>100||value.some(id=>typeof id!=='string'||!/^m[1-9]\d*$/.test(id))||new Set(value).size!==value.length)throw fail('invalid_chat_argument','message_ids 必须包含 1 到 100 条不同用户消息');
    const messages:Message[]=[];
    for(const id of value){const message=await tx.get<Message>(messageKey(chat,cursorOf(id)));if(!message||message.role!=='user'||message.approval_id)throw fail('invalid_processing_message','处理回执只能引用本对话的用户输入');messages.push(message);}
    return messages;
  }
  private async processing(chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','普通 Chat 的处理回执不能改变 Super Agent 任务状态');
    const writer=await this.connection(chat,args.connection,actor,caller);
    const result=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id)),binding=await tx.get<Writer>(writerKey(chat.id));
      if(!current||current.writer!==writer.id||binding?.id!==writer.id)throw fail('chat_not_connected','原模型连接已结束');
      const d=await this.dedupe(tx,chat.id+':processing',args.request_key,[args.message_ids,args.state,args.reason??null,args.expected_revision]);
      if(d.result)return d.result;
      const messages=await this.inputMessages(tx,chat.id,args.message_ids);
      const recorded={chat_id:chat.id,saved:true,...await reportProcessing(tx,chat.id,current.sequence,messages,args as any,
        {account:writer.account,epoch:writer.epoch,caller:writer.caller})};
      if(args.state==='resolved')for(const message of messages)await this.resolveNotification(tx,chat.id,message.sequence);
      if(args.state==='resolved')await this.scheduleGoal(tx,current);
      await tx.put(d.key,{fingerprint:d.fingerprint,result:recorded});await this.recordChange(tx,current,messages.map(m=>m.sequence));
      return recorded;
    });this.signal(chat.id);return result;
  }
  private async contextRecord(kind:'summary'|'trace',chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','普通 Chat 上下文记录不能改变 Super Agent');
    const write=kind==='summary'?args.operation==='write':args.operation==='record';
    if(!write){
      return this.store.transaction(async tx=>{
        await this.access(actor,chat.device,tx);
        if(kind==='summary'&&args.operation==='read'){
          const summary=await readChatSummary(tx,chat.id,args.through);
          return {summary,availability:summary?'available':'not_generated',producer:summary?.generation?.kind??(summary?'host_reported':null)};
        }
        if(kind==='trace'&&args.operation==='list')return listTrace(tx,chat.id,args);
        if(kind==='trace'&&args.operation==='read')return readTrace(tx,chat.id,args as any);
        throw fail('invalid_chat_argument','未知上下文记录操作');
      });
    }
    const writer=await this.connection(chat,args.connection,actor,caller);
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id)),binding=await tx.get<Writer>(writerKey(chat.id));
      if(!current||current.writer!==writer.id||binding?.id!==writer.id)throw fail('chat_not_connected','原模型连接已结束');
      const identity={account:writer.account,epoch:writer.epoch,caller:writer.caller};
      if(kind==='summary')return {saved:true,summary:await writeChatSummary(tx,chat.id,args as any,identity,id=>readTraceEntry(tx,chat.id,id))};
      return recordTrace(tx,{chatId:chat.id,latestSequence:current.sequence,writer:{id:writer.id,...identity}},args,
        id=>tx.get<Message>(messageKey(chat.id,cursorOf(id))));
    });
  }
  /** Internal MCP-host producer entry, never a public chat action or an alternate executor. */
  async summaryProduction(action:'prepare'|'complete'|'cancel',args:Data,actor:Actor,caller:string):Promise<Data>{
    await this.initialize();const chat=await this.chat(textValue(args.chat_id,'chat_id'),actor);
    if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','自动聊天摘要不改变 Super Agent');
    const writer=await this.connection(chat,args.connection,actor,caller);
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id)),binding=await tx.get<Writer>(writerKey(chat.id));
      if(!current||current.writer!==writer.id||binding?.id!==writer.id)throw fail('chat_not_connected','原模型连接已结束');
      const scope={chatId:chat.id,latestSequence:current.sequence,writer:{id:writer.id,account:writer.account,epoch:writer.epoch,caller:writer.caller}};
      if(action==='prepare')return prepareSummaryProduction(tx,scope,args as any);
      if(action==='complete')return completeSummaryProduction(tx,scope,args as any);
      if(action==='cancel')return cancelSummaryProduction(tx,scope,args as any);
      throw fail('invalid_summary_production','未知摘要生产步骤');
    });
  }
  private publicReview(row?:PlanReview,timeline=false):Data|null{
    if(!row)return null;
    const {writer:_,continued_by:__,anchor_sequence,created_revision,updated_revision,...visible}=row;
    return timeline&&anchor_sequence!==undefined?{...visible,anchor_sequence,created_revision,updated_revision}:visible;
  }

  private async discardGoalRound(tx:KeyStore,chat:string,goal:GoalRecord):Promise<void>{
    if(goal.round)await tx.delete(collaborationWakeKey(chat,goalWakeId(goal.round)));
    delete goal.round;
  }

  private async parkGoal(tx:KeyStore,chat:string):Promise<void>{
    const goal=await tx.get<GoalRecord>(goalKey(chat));
    if(!goal)return;
    goal.armed=false;delete goal.writer;
    await this.discardGoalRound(tx,chat,goal);
    await tx.put(goalKey(chat),goal);
  }

  private async rearmCollaborationWake(tx:KeyStore,chat:Conversation):Promise<void>{
    if(!chat.plan_review_id)return;
    const key=collaborationWakeKey(chat.id,'plan:'+chat.plan_review_id),wake=await tx.get<CollaborationWake>(key);
    if(wake?.next_at===null){wake.next_at=Date.now();await tx.put(key,wake);await tx.requestAlarm?.(wake.next_at);}
  }

  private async cancelPendingReview(tx:KeyStore,chat:Conversation):Promise<string|undefined>{
    if(!chat.plan_review_id)return;
    const id=reviewKey(chat.id,chat.plan_review_id),review=await tx.get<PlanReview>(id);
    if(review?.state!=='pending')return;
    review.state='cancelled';
    if(review.created_revision!==undefined)review.updated_revision=(chat.revision??0)+1;
    await tx.put(id,review);
    return review.created_revision!==undefined?review.id:undefined;
  }

  private async pauseQueuedGoal(tx:KeyStore,chat:string):Promise<void>{
    const goal=await tx.get<GoalRecord>(goalKey(chat));
    if(goal?.round?.state!=='queued')return;
    await this.discardGoalRound(tx,chat,goal);await tx.put(goalKey(chat),goal);
  }

  private async scheduleGoal(tx:KeyStore,chat:Conversation):Promise<boolean>{
    if(!chat.active||!chat.writer||chat.interaction_mode==='plan')return false;
    if(chat.plan_review_id){
      const review=await tx.get<PlanReview>(reviewKey(chat.id,chat.plan_review_id));
      if(review?.state==='approved'&&review.writer===chat.writer&&!review.finished&&
        (chat.interaction_revision??0)===review.mode_revision+1)return false;
    }
    const goal=await tx.get<GoalRecord>(goalKey(chat.id)),current=goal?.fold.goal;
    if(!goal?.armed||goal.round||current?.phase!=='active')return false;
    if(goal.writer&&goal.writer!==chat.writer){
      goal.armed=false;await tx.put(goalKey(chat.id),goal);return true;
    }
    const sub=await tx.get<Subscription>(subKey(chat.active));
    if(!await this.validSubscription(tx,sub,chat.device)||(sub!.writer_id??sub!.id)!==chat.writer)return false;
    if((await tx.list({prefix:'chat-processing-open:'+chat.id+':',limit:1})).size)return false;
    if(current.maxGoalRounds<=goal.fold.roundsStarted){
      changeGoal(goal,'block',{reason:{code:'round-limit',message:'已达到目标的 '+current.maxGoalRounds+' 轮上限'}});
    }else{
      goal.writer=chat.writer;
      goal.round={id:crypto.randomUUID(),goal_id:current.id,revision:current.revision,number:goal.fold.roundsStarted+1,state:'queued'};
      await queueCollaborationWake(tx,chat.id,goalWakeId(goal.round),'goal_round',goal.round.id);
    }
    await tx.put(goalKey(chat.id),goal);return true;
  }

  private async checkGoal(id:string):Promise<void>{
    if(!await this.store.get(goalKey(id)))return;
    await this.store.transaction(async tx=>{
      const current=await tx.get<Conversation>(key(id));
      if(current&&await this.scheduleGoal(tx,current))await this.recordChange(tx,current);
    });
  }

  private async setInteraction(tx:KeyStore,chat:Conversation,mode:InteractionMode):Promise<string|undefined>{
    const previous=chat.interaction_mode??'normal';
    if(previous===mode)return;
    const plan=projectPlanMode(previous,mode);
    chat.interaction_mode=plan?'plan':mode;
    chat.interaction_revision=(chat.interaction_revision??0)+1;
    if(plan)await this.pauseQueuedGoal(tx,chat.id);
    else if(previous==='plan')return this.cancelPendingReview(tx,chat);
  }

  private async collaborationAction(action:string,chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    if(chatMode(chat.mode)!=='chat')throw interactionFail('chat_mode_mismatch','此操作仅用于普通 Chat 会话');
    const operation=args.operation??'read';
    const allowed=action==='goal'?(caller?['read','claim','settle']:['read','command'])
      :action==='plan'?(caller?['read','submit','continue','finish']:['read','decide']):caller?['read']:['read','set'];
    if(!allowed.includes(operation))throw interactionFail('invalid_chat_argument','此身份不能执行该会话操作');
    const writer=caller&&operation!=='read'?await this.connection(chat,args.connection,actor,caller):undefined;
    const {current,value,changed}=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));
      if(!current)throw fail('chat_deleted','对话已删除');
      if(writer&&current.writer!==writer.id)throw fail('chat_not_connected','原模型连接已结束');
      if(operation==='read'){
        const ref=args.review_id??current.plan_review_id;
        const review=action==='plan'&&ref?this.publicReview(await tx.get<PlanReview>(reviewKey(chat.id,textValue(ref,'review_id')))):null;
        return {current,changed:false,value:{...(action==='plan'?{review}:{}),...(action==='goal'?{goal:goalView(await tx.get<GoalRecord>(goalKey(chat.id)))}:{})}};
      }
      const {connection:_,request_key:__,...input}=args;
      const request=await this.dedupe(tx,chat.id+':'+action+':'+principalScope(actor),args.request_key,[input,writer?.id??null]);
      if(request.result)return {current,changed:false,value:operation==='claim'||operation==='continue'?{claimed:false,duplicate:true}:request.result};
      const value:Data={};
      let changedReviewId:string|undefined;
      if(action==='interaction'){
        if(integer(args.expected_revision,'expected_revision')!==(current.interaction_revision??0))
          throw interactionFail('stale_interaction_mode','会话模式已变更，请同步后再切换');
        if(!['normal','plan','auto'].includes(args.mode))throw interactionFail('invalid_chat_argument','无效会话模式');
        changedReviewId=await this.setInteraction(tx,current,args.mode);
        const prompt=args.text===undefined?'':textValue(args.text,'text').trim();
        if(prompt){
          if(args.mode!=='plan'||new TextEncoder().encode(prompt).length>65536)throw interactionFail('invalid_chat_argument','规划请求最多 64 KiB');
          const sequence=++current.sequence,stamp=now();
          const message:Message={id:'m'+sequence,sequence,role:'user',source:args.source==='tui'?'tui':'web',source_identity:sourceIdentity(actor),planning_request:true,text:prompt,attachments:[],created_at:stamp,saved_at:stamp};
          current.updated_at=stamp;await tx.put({[messageKey(chat.id,sequence)]:message,[timingKey(chat.id,sequence)]:{saved_at:stamp,attempts:0}});
          await queueInput(tx,chat.id,message);await this.queueMessage(tx,current,message);
          await observeContext(tx,chat.id,sequence,true);
          await this.recordChange(tx,current,[sequence]);value.message_id=message.id;
        }
      }else if(action==='goal'){
        const goal=await tx.get<GoalRecord>(goalKey(chat.id))??newGoal();
        const g=goal.fold.goal;
        if(operation==='command'){
          const command=parseGoalCommand(textValue(args.input??'','input'));
          if(command.kind==='show')return {current,changed:false,value:{goal:goalView(goal)}};
          if(command.kind==='invalid-edit')throw interactionFail('invalid_chat_argument','/goal edit 需要新的目标');
          if('objective' in command&&(!command.objective||new TextEncoder().encode(command.objective).length>16384))
            throw interactionFail('invalid_chat_argument','目标需要 1 到 16384 字节');
          const kind=command.kind==='edit'&&g?.phase==='complete'?'create':command.kind;
          if(kind!=='clear'||g){
            const needsIdle=kind==='edit'&&goal.round?.state==='claimed';
            if(needsIdle)throw interactionFail('goal_round_active','先暂停目标，再编辑目标');
            changeGoal(goal,kind,'objective' in command?{objective:command.objective}:{});
            await this.discardGoalRound(tx,chat.id,goal);
            if(kind==='create'||kind==='resume')goal.writer=current.writer;
          }
        }else{
          const round=goal.round;
          if(!round||round.id!==args.round_id||!g||g.id!==args.goal_id||g.revision!==args.expected_revision||goal.writer!==writer!.id)
            throw interactionFail('stale_goal_round','目标轮次已更换或取消');
          if(operation==='claim'){
            if(round.state!=='queued')return {current,changed:false,value:{claimed:false,duplicate:true}};
            if(!goal.armed||current.interaction_mode==='plan'||(await tx.list({prefix:'chat-processing-open:'+chat.id+':',limit:1})).size)
              throw interactionFail('goal_round_deferred','先处理真人消息或完成规划');
            admitRound(goal,round);round.state='claimed';round.writer=writer!.id;value.claimed=true;
            value.prompt=renderGoalRoundPrompt({...g,roundsStarted:goal.fold.roundsStarted,activation:'armed',createdAt:goal.fold.createdAt!,updatedAt:goal.fold.updatedAt!},round.number)[0].text;
            value.context_source={round_id:round.id,source_message_ids:[]};
          }else{
            if(round.state!=='claimed'||round.writer!==writer!.id)throw interactionFail('stale_goal_round','轮次尚未由当前宿主认领');
            if(!['continue','complete','blocked'].includes(args.outcome))throw interactionFail('invalid_chat_argument','无效目标结算结果');
            if(args.outcome==='complete')changeGoal(goal,'complete');
            else if(args.outcome==='blocked'){
              const blocker=textValue(args.reason,'reason').trim();
              if(!blocker||blocker.length>1000)throw interactionFail('invalid_chat_argument','请记录明确的阻塞原因（最多 1000 字）');
              goal.blockerCount=goal.blocker===blocker?(goal.blockerCount??0)+1:1;goal.blocker=blocker;
              if(goal.blockerCount>=3)changeGoal(goal,'block',{reason:{code:'repeated-blocker',message:blocker}});
            }else{delete goal.blocker;delete goal.blockerCount;}
          }
          await tx.delete(collaborationWakeKey(chat.id,goalWakeId(round)));
          if(operation==='settle')delete goal.round;
        }
        await tx.put(goalKey(chat.id),goal);
      }else if(operation==='submit'){
        if(current.interaction_mode!=='plan'||integer(args.expected_revision,'expected_revision')!==(current.interaction_revision??0))
          throw interactionFail('stale_interaction_mode','仅可在当前计划模式版本提交方案');
        const markdown=textValue(args.markdown,'markdown').trim();
        if(!/^#\s+\S/.test(markdown)||new TextEncoder().encode(markdown).length>65536)
          throw interactionFail('invalid_chat_argument','方案必须以一级标题开头且不超过 64 KiB');
        const previous=current.plan_review_id?await tx.get<PlanReview>(reviewKey(chat.id,current.plan_review_id)):undefined;
        if(previous?.state==='pending')throw interactionFail('plan_review_pending','已有方案在等待审阅');
        const sources=args.source_message_ids===undefined?[]:await this.inputMessages(tx,chat.id,args.source_message_ids);
        const revision=(current.revision??0)+1;
        const review:PlanReview={id:crypto.randomUUID(),markdown,mode_revision:current.interaction_revision!,writer:writer!.id,state:'pending',source_message_ids:sources.map(m=>m.id),
          anchor_sequence:current.sequence,created_revision:revision,updated_revision:revision};
        await tx.put(reviewKey(chat.id,review.id),review);
        await tx.put(reviewTimelineKey(chat.id,current.sequence,revision),review.id);
        current.plan_review_id=changedReviewId=review.id;
        value.review=this.publicReview(review);
      }else{
        const id=textValue(args.review_id,'review_id'),key=reviewKey(chat.id,id),review=await tx.get<PlanReview>(key);
        if(!review||id!==current.plan_review_id)throw interactionFail('stale_plan_review','方案已更换');
        if(operation==='continue'||operation==='finish'){
          if(operation==='continue'&&(!review.decision||review.continued_by))return {current,changed:false,value:{claimed:false,duplicate:true}};
          if(review.writer!==writer!.id)throw interactionFail('stale_plan_review','方案属于原模型连接');
          if((review.decision==='reject'?'plan':review.decision)!==(current.interaction_mode??'normal')||
            (current.interaction_revision??0)!==review.mode_revision+(review.decision==='reject'?0:1))
            throw interactionFail('stale_interaction_mode','审阅决定后的会话模式已更换');
          if(operation==='continue'){
            review.continued_by=writer!.id;value.claimed=true;
            value.context_source={review_id:review.id,source_message_ids:review.source_message_ids??[]};
            await tx.delete(collaborationWakeKey(chat.id,planWakeId(review)));
          }else{
            if(review.state!=='approved'||review.continued_by!==writer!.id)
              throw interactionFail('stale_plan_review','当前模型尚未认领已批准方案');
            review.finished=true;
          }
        }else{
          if(review.state!=='pending'||review.writer!==current.writer||current.interaction_mode!=='plan'||review.mode_revision!==current.interaction_revision)
            throw interactionFail('stale_plan_review','此方案已结算或已退出计划');
          if(!['reject','normal','auto'].includes(args.decision))throw interactionFail('invalid_chat_argument','无效审阅决定');
          review.decision=args.decision;review.state=args.decision==='reject'?'rejected':'approved';
          if(args.decision==='reject'){
            review.reason=textValue(args.reason??'','reason').trim();
            if(review.reason.length>4000)throw interactionFail('invalid_chat_argument','拒绝理由最多 4000 字');
          }
          await tx.put(key,review);
          if(args.decision!=='reject')await this.setInteraction(tx,current,args.decision);
          await queueCollaborationWake(tx,chat.id,planWakeId(review),'plan_review',review.id);
        }
        if(review.created_revision!==undefined&&operation!=='continue'){
          review.updated_revision=(current.revision??0)+1;changedReviewId=review.id;
        }
        await tx.put(key,review);value.review=this.publicReview(review);
      }
      await this.scheduleGoal(tx,current);
      if(action==='goal')value.goal=goalView(await tx.get<GoalRecord>(goalKey(chat.id)));
      await this.recordChange(tx,current,[],changedReviewId);
      await tx.put(request.key,{fingerprint:request.fingerprint,result:operation==='claim'||operation==='continue'?{claimed:true}:value});
      return {current,value,changed:true};
    });
    if(changed)this.signal(chat.id);
    return {...value,chat:await this.summary(current,actor)};
  }

  /** Validate the explicit Chat binding before capture or automatic tool admission. */
  async beginToolObservation(binding:ChatToolBinding,tool:string,input:Data,actor:Actor,caller:string):Promise<ObservedToolTicket>{
    await this.initialize();
    if(!binding||typeof binding!=='object'||!toolSpecs.some(([name])=>name===tool)||
      binding.capture!==undefined&&!['metadata','content'].includes(binding.capture))throw fail('invalid_chat_context','无效工具上下文绑定');
    const ids=binding.source_message_ids;
    if(!Array.isArray(ids)||(!binding.round_id&&!binding.review_id&&ids.length<1)||ids.length>100||ids.some(id=>typeof id!=='string'||!/^m[1-9]\d*$/.test(id))||new Set(ids).size!==ids.length)
      throw fail('invalid_chat_context','工具上下文需要 1 到 100 条本对话的真实来源消息');
    const chat=await this.chat(textValue(binding.chat_id,'chat_id'),actor);
    if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','普通 Chat 工具上下文不能读取或改变 Super Agent 私有任务');
    const writer=await this.connection(chat,binding.connection,actor,caller);
    let validated:TraceScope|undefined;
    try{return await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id)),active=await tx.get<Writer>(writerKey(chat.id));
      if(!current||current.writer!==writer.id||active?.id!==writer.id)throw fail('chat_not_connected','原模型连接已结束');
      await this.assertCollaborationSource(tx,current,writer.id,binding.round_id,binding.review_id);
      for(const id of ids){const message=await tx.get<Message>(messageKey(chat.id,cursorOf(id)));
        if(!message||message.id!==id||message.sequence>current.sequence)throw fail('invalid_trace_source','工具上下文来源必须存在于本对话');}
      validated={chatId:chat.id,latestSequence:current.sequence,writer:{id:writer.id,account:writer.account,epoch:writer.epoch,caller:writer.caller}};
      if(!ids.length)return unavailableToolTicket(validated,binding,tool);
      return observeToolCall(tx,validated,binding,tool,input,id=>tx.get<Message>(messageKey(chat.id,cursorOf(id))));
    });}catch(error){
      // Failed storage rolls back the whole observation. Never disguise an ACL,
      // writer, source, or input validation failure as optional logging failure.
      if(!validated||/^(?:invalid_|chat_|account_|device_|context_)/.test(String((error as Data)?.code??'')))throw error;
      return unavailableToolTicket(validated,binding,tool);
    }
  }

  private async assertCollaborationSource(tx:KeyStore,chat:Conversation,writer:string,roundId?:string,reviewId?:string):Promise<void>{
    if(roundId){
      const round=(await tx.get<GoalRecord>(goalKey(chat.id)))?.round;
      if(round?.id!==roundId||round.state!=='claimed'||round.writer!==writer)
        throw fail('invalid_chat_context','目标轮次未由当前模型认领');
    }
    if(reviewId){
      const review=await tx.get<PlanReview>(reviewKey(chat.id,reviewId));
      if(review?.continued_by!==writer||review.finished||chat.plan_review_id!==review.id||
        (chat.interaction_revision??0)!==review.mode_revision+(review.decision==='reject'?0:1))
        throw fail('invalid_chat_context','方案决定不属于当前模型和模式');
    }
  }

  async assertToolDispatch(ticket:ObservedToolTicket,device:string,grant?:AutoToolGrant):Promise<void>{
    await this.store.transaction(async tx=>{
      if(grant)await this.assertAutoToolGrant(grant,device,tx);
      const chat=await tx.get<Conversation>(key(ticket.chatId));
      if(!chat||chat.writer!==ticket.writerId)throw fail('chat_not_connected','原模型连接已结束');
      await this.assertCollaborationSource(tx,chat,ticket.writerId,ticket.roundId,ticket.reviewId);
    });
  }

  async autoToolGrant(ticket:ObservedToolTicket|undefined,actor:Actor,device:string):Promise<AutoToolGrant|undefined>{
    if(!ticket)return undefined;
    const current=await this.store.get<Conversation>(key(ticket.chatId));
    if(current?.device!==device||current.interaction_mode!=='auto')return undefined;
    const grant={chatId:current.id,writerId:ticket.writerId,revision:current.interaction_revision!,account:actor.id,epoch:actor.epoch,caller:ticket.caller};
    await this.assertAutoToolGrant(grant,device);
    return grant;
  }

  async assertAutoToolGrant(grant:AutoToolGrant,device:string,tx:KeyStore=this.store):Promise<void>{
    if(tx===this.store)return this.store.transaction(inner=>this.assertAutoToolGrant(grant,device,inner));
    const [chat,writer]=await Promise.all([tx.get<Conversation>(key(grant.chatId)),tx.get<Writer>(writerKey(grant.chatId))]);
    if(!chat||chat.device!==device||chatMode(chat.mode)!=='chat'||chat.interaction_mode!=='auto'||chat.interaction_revision!==grant.revision||
      chat.writer!==grant.writerId||writer?.id!==grant.writerId||writer.account!==grant.account||writer.epoch!==grant.epoch||writer.caller!==grant.caller)
      throw interactionFail('chat_auto_ended','会话已退出自动模式或模型连接已变化');
    await this.accounts.assertAccessIn(tx,{id:grant.account,epoch:grant.epoch,role:'user',username:''},device);
  }
  async finishToolObservation(ticket:ObservedToolTicket,output:Data,actor:Actor,caller:string):Promise<ObservedToolReceipt>{
    await this.initialize();const chat=await this.chat(ticket.chatId,actor),account=modelActor(actor);
    if(chatMode(chat.mode)!=='chat')throw fail('chat_mode_mismatch','普通 Chat 工具上下文不能改变 Super Agent');
    if(ticket.account!==account.id||ticket.epoch!==account.epoch||ticket.caller!==caller)throw fail('chat_not_connected','工具观察不属于当前模型连接');
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id)),writer=await tx.get<Writer>(writerKey(chat.id));
      if(!current||current.writer!==ticket.writerId||writer?.id!==ticket.writerId||writer.account!==account.id||writer.epoch!==account.epoch||writer.caller!==caller)
        throw fail('chat_not_connected','原模型连接已结束');
      return observeToolResult(tx,{chatId:chat.id,latestSequence:current.sequence,writer:{id:writer.id,account:writer.account,epoch:writer.epoch,caller:writer.caller}},
        ticket,output,id=>tx.get<Message>(messageKey(chat.id,cursorOf(id))));
    });
  }
  private async context(chat:Conversation,args:Data,currentIsTrigger=false):Promise<Data|null>{
    if(!chat.sequence)return null;
    const sequence=args.message_id===undefined?chat.sequence:cursorOf(args.message_id);
    const anchor=await this.store.get<Message>(messageKey(chat.id,sequence));
    if(!anchor)throw fail('message_not_found','当前对话不存在该上下文锚点');
    const mode=chatMode(chat.mode),limit=Math.min(args.limit===undefined?9:limitOf(args.limit),9);
    const rows=await this.store.list<Message>({prefix:'chat-message:'+chat.id+':',endBefore:messageKey(chat.id,sequence),reverse:true,limit});
    let result:Data;
    if(mode==='chat'){
      const beforeAt=args.message_id===undefined?undefined:anchor.created_at;
      const summary=await readChatSummary(this.store,chat.id,sequence-1,beforeAt),traces=await listTrace(this.store,chat.id,{throughSequence:sequence,beforeAt});
      result={...buildContext(chat.id,mode,anchor,[...rows.values()],{summary:null,toolHistory:[],maxBytes:199000,
        pendingHint:{...await processingMeta(this.store,chat.id,chat.sequence)},currentIsTrigger}),working_context:{tool:'chat.working_context',chat_id:chat.id,through:sequence,summary_revision:summary?.revision??0,covered_through:summary?.covered_through??0},snapshot_generated_at:now()};
    }else{
      result={...buildContext(chat.id,mode,anchor,[...rows.values()],{maxBytes:199000,currentIsTrigger}),snapshot_generated_at:now()};
    }
    if(jsonBytes(result)>200000&&result.current_message.text){
      result.current_message.text='';result.current_message.text_truncated=true;
      result.current_message.text_ref={tool:'chat.history',chat_id:chat.id,before:sequence+1,after:sequence-1,limit:1};result.truncated=true;
    }
    if(jsonBytes(result)>200000)throw fail('context_metadata_too_large','Use paged history for oversized metadata');
    return result;
  }
  private async task(chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    if(chatMode(chat.mode)!=='super_agent')throw fail('chat_mode_mismatch','Chat 模式不创建或调度任务；请新建 Super Agent 对话');
    const host=HOST_ACTIONS.has(args.action),writer=host?await this.connection(chat,args.connection,actor,caller):undefined;
    const result=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      if(chatMode(current.mode)!=='super_agent')throw fail('chat_mode_mismatch','当前会话不是 Super Agent');
      if(host){
        const binding=await tx.get<Writer>(writerKey(chat.id)),account=modelActor(actor);
        if(!binding||binding.id!==writer!.id||current.writer!==binding.id||binding.account!==account.id||binding.epoch!==account.epoch||binding.caller!==caller||!await this.matchesConnection(binding,args.connection))throw fail('chat_not_connected','原模型连接已结束');
      }
      const scope={chatId:chat.id,deviceId:chat.device,principal:actor,repository:current.repository,
        authorizePrincipal:(_storage:KeyStore,source:ChatPrincipal)=>this.access(source,chat.device,tx)};
      const result=await superAgentTask(tx,scope,args as TaskRequest,writer?.id);
      const receipts=host&&MUTATING_ACTIONS.has(args.action)?await this.drainSuperAgent(tx,current,scope):[];
      if(MUTATING_ACTIONS.has(args.action)&&result.runtime_version===2)await this.trackSuperAgent(tx,current,actor);
      const saved=new Map(receipts.map(receipt=>[receipt.reply_id,receipt]));
      return {...result,execution_target:{chat_id:current.id,device_id:current.device_id},replies:(result.replies??[]).map((reply:Data)=>saved.has(reply.reply_id)?{...reply,...saved.get(reply.reply_id),state:'saved'}:reply),reply_receipts:receipts};
    });
    await this.changed(chat.id);return result;
  }
  private async drainSuperAgent(tx:KeyStore,current:Conversation,scope:Parameters<typeof superAgentDrainOutbox>[1]){
    const chat=current;
    return superAgentDrainOutbox(tx,scope,async message=>{
        const index='chat-module-reply:'+chat.id+':'+message.id,existing=await tx.get<number>(index);
        if(existing)return {messageId:'m'+existing};
        if(message.chatId!==chat.id)throw fail('outbox_destination_mismatch','任务回复不属于当前对话');
        const replySequence=message.replyTo?cursorOf(message.replyTo):undefined;
        const original=replySequence?await tx.get<Message>(messageKey(chat.id,replySequence)):undefined;
        if(message.replyTo&&(!original||original.role!=='user'))throw fail('invalid_reply','任务回复必须指向本对话的用户消息');
        const sequence=++current.sequence,stamp=now(),id='m'+sequence;
        const saved:Message={id,sequence,role:'assistant',source:'module',text:message.text,attachments:[],created_at:stamp,saved_at:stamp,
          ...(message.replyTo?{reply_to:message.replyTo}:{})};
        current.updated_at=stamp;await tx.put({[messageKey(chat.id,sequence)]:saved,[index]:sequence});
        if(original){
          original.replies=[...(original.replies??[]),id];original.replied_at=stamp;await tx.put(messageKey(chat.id,original.sequence),original);
          const timing=await tx.get<Timing>(timingKey(chat.id,original.sequence))??{saved_at:original.created_at,attempts:0};
          timing.reply_saved_at=stamp;await tx.put(timingKey(chat.id,original.sequence),timing);
          const event=await tx.get<Outbox>(outboxKey(chat.id,original.sequence));
          if(event&&event.state!=='delivered'){event.state='resolved';await this.saveEvent(tx,event);}
        }
        await this.recordChange(tx,current,[sequence,...(original?[original.sequence]:[])]);
        return {messageId:id};
          });
  }
  private async trackSuperAgent(tx:KeyStore,chat:Conversation,actor:ChatPrincipal){
    const scope={chatId:chat.id,deviceId:chat.device,principal:actor,repository:chat.repository,
      authorizePrincipal:(_storage:KeyStore,source:ChatPrincipal)=>this.access(source,chat.device,tx)};
    const result=await superAgentTick(tx,scope),ref='chat-super-agent-schedule:'+chat.id;
    const previous=await tx.get<Data>(ref);if(previous)await tx.delete(previous.key);
    if(result.next_due!==undefined){
      const at=Math.max(Date.now()+100,result.next_due),index='chat-super-agent-due:'+padded(at)+':'+chat.id;
      const item={chat:chat.id,principal:normalizeIdentity(actor),at,key:index};await tx.put({[ref]:item,[index]:item});
      await tx.requestAlarm?.(at);
    }else await tx.delete(ref);
    return result;
  }
  private superAgentAlarm():Promise<void>{
    if(this.superAgentPumping)return this.superAgentPumping;
    this.superAgentPumping=this.pumpSuperAgent().finally(()=>{this.superAgentPumping=undefined;});
    return this.superAgentPumping;
  }
  private async pumpSuperAgent(){
    const due=await this.store.list<Data>({prefix:'chat-super-agent-due:',endBefore:'chat-super-agent-due:'+padded(Date.now()+1),limit:32});
    for(const [index,item] of due){
      try{await this.store.transaction(async tx=>{
        const current=await tx.get<Data>('chat-super-agent-schedule:'+item.chat);
        if(current?.key!==index){await tx.delete(index);return;}
        const chat=await tx.get<Conversation>(key(item.chat));
        if(!chat||chatMode(chat.mode)!=='super_agent'){await tx.delete([index,'chat-super-agent-schedule:'+item.chat]);return;}
        const scope={chatId:chat.id,deviceId:chat.device,principal:item.principal,repository:chat.repository,
          authorizePrincipal:(_s:KeyStore,p:ChatPrincipal)=>this.access(p,chat.device,tx)};
        const result=await superAgentTick(tx,scope);
        await this.drainSuperAgent(tx,chat,scope);
        await this.trackSuperAgent(tx,chat,item.principal);
        if(result.changed){const wake={chat:chat.id,generation:result.generation,next_at:Date.now(),attempts:0};await tx.put('chat-super-agent-wake:'+chat.id,wake);}
      });}catch(error){
        if(['account_unavailable','device_forbidden','device_missing','device_unauthorized','source_authorization_unavailable'].includes((error as Data).code))await this.store.delete([index,'chat-super-agent-schedule:'+item.chat]);
        else throw error;
      }
    }
    const wakes=await this.store.list<Data>({prefix:'chat-super-agent-wake:'});
    await Promise.all([...wakes.entries()].filter(([,w])=>w.next_at<=Date.now()).map(async([id,wake])=>{
      const chat=await this.store.get<Conversation>(key(wake.chat));
      if(!chat){await this.store.delete(id);return;}
      const sub=chat.active?await this.store.get<Subscription>(subKey(chat.active)):undefined;
      if(!sub||!await this.validSubscription(this.store,sub,chat.device)){await this.store.transaction(async tx=>{const current=await tx.get<Data>(id);if(current&&current.generation===wake.generation){delete current.next_at;await tx.put(id,current);}});return;}
      let status=0;
      try{const response=await this.signed(sub,{eventId:`super-agent:${chat.id}:${wake.generation}`,name:'chat.message',cursor:null,timestamp:now(),
        data:{kind:'super_agent',mode:'super_agent',chat_id:chat.id,device_id:chat.device_id,connection:sub.event_connection,generation:wake.generation,
          reason:'task_update',url:this.env.publicUrl+'/chat?id='+encodeURIComponent(chat.id)}});status=response.status;await response.body?.cancel();}catch{}
      await this.store.transaction(async tx=>{
        const current=await tx.get<Data>(id);if(!current||current.generation!==wake.generation)return;
        if(status>=200&&status<300||status>=400&&status<500&&status!==408&&status!==429){await tx.delete(id);return;}
        current.attempts++;current.next_at=Date.now()+([30000,60000,120000][current.attempts-1]??300000);await tx.put(id,current);await tx.requestAlarm?.(current.next_at);
      });
    }));
  }
  private async history(chat:Conversation,args:Data,actor:ChatPrincipal,human:boolean):Promise<Data>{
    if(human&&args.review_after!==undefined){
      const value=textValue(args.review_after,'review_after');
      if(!/^\d{1,16}:\d{1,16}:\d{1,16}:\d{1,16}$/.test(value))throw fail('invalid_chat_cursor','无效方案历史游标');
      const [first,last,anchor,revision]=value.split(':').map(Number);
      if(![first,last,anchor,revision].every(Number.isSafeInteger)||first>anchor||anchor>last||last>chat.sequence)
        throw fail('invalid_chat_cursor','无效方案历史游标');
      return this.store.transaction(async tx=>{
        await this.access(actor,chat.device,tx);
        return this.planReviewPage(tx,chat.id,first,last,{anchor,revision});
      });
    }
    const prefix='chat-message:'+chat.id+':',limit=limitOf(args.limit),forward=args.after!==undefined;
    const after=forward?integer(args.after,'after'):0,before=args.before===undefined?undefined:integer(args.before,'before',1);
    if(forward&&before!==undefined)throw fail('invalid_chat_argument','after 与 before 不能同时使用');
    const {messages,reviews,first,last}=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const rows=await tx.list<Message>({prefix,limit:limit+1,...(forward?{startAfter:messageKey(chat.id,after)}:{reverse:true,...(before?{endBefore:messageKey(chat.id,before)}:{})})});
      const messages=[...rows.values()].slice(0,limit);if(!forward)messages.reverse();
      const first=messages[0]?.sequence??(before??after),last=messages.at(-1)?.sequence??after;
      const lower=messages.length&&first>1?first:0;
      const reviews=!human?{}:messages.length||(!after&&!chat.sequence)
        ?await this.planReviewPage(tx,chat.id,lower,last):{plan_reviews:[]};
      return {messages,reviews,first,last};
    });
    return {chat:await this.summary(chat,actor,undefined,human),maintenance_statuses:await maintenanceStatuses(this.store,chat.id),notification_diagnostics:await readCallbackDiagnostics(this.store,chat.id),messages:await Promise.all(messages.map(m=>this.viewMessage(this.store,chat.id,m))),...reviews,next_cursor:last,first_cursor:first,eof:last>=chat.sequence,has_older:first>1};
  }
  private async resume(chat:Conversation,args:Data,actor:ChatPrincipal,caller:string):Promise<Data>{
    if(!caller)throw fail('model_connection_required','请通过模型 MCP 连接恢复对话');
    const account=modelActor(actor);let connection=args.connection;
    if(chat.writer&&!connection&&!chat.active&&chat.reconnect_until&&chat.reconnect_until>Date.now()){
      await this.store.transaction(async tx=>{
        await this.access(actor,chat.device,tx);
        const current=await tx.get<Conversation>(key(chat.id));
        if(!current||current.active||!current.writer||!current.reconnect_until||current.reconnect_until<=Date.now())return;
        delete current.writer;delete current.reconnect_until;
        await tx.delete(writerKey(chat.id));await this.parkGoal(tx,chat.id);
        await this.recordChange(tx,current,[],await this.cancelPendingReview(tx,current));
      });
      chat=await this.chat(chat.id,actor);
    }
    if(chat.writer)await this.connection(chat,connection,actor,caller);
    else {
      const candidate=connection?await this.store.get<Candidate>('chat-candidate:'+await hash(connection)):undefined;
      if(connection&&(!candidate||candidate.chat!==chat.id||candidate.account!==account.id||candidate.epoch!==account.epoch||candidate.caller!==caller||candidate.expires_at<=Date.now()))throw fail('connection_expired','连接凭据已过期，请重新恢复对话');
      if(!connection){
        connection=secret();const digest=await hash(connection),expires_at=Date.now()+600_000;
        await this.store.transaction(async tx=>{
          await this.access(actor,chat.device,tx);
          await tx.put('chat-candidate:'+digest,{chat:chat.id,account:account.id,epoch:account.epoch,caller,expires_at} satisfies Candidate);
          await this.expiry(tx,'candidate',digest,expires_at);await tx.requestAlarm?.(expires_at);
        });
      }
    }
    const current=await this.chat(chat.id,actor);if(current.writer)await this.connection(current,connection,actor,caller);this.background(()=>this.changed(chat.id));
    return {chat:await this.summary(current,actor),connection,subscribed:!!current.active,context:await this.context(current,{}),
      next_step:(chatMode(current.mode)==='super_agent'?'Super Agent: first call chat.task instructions for the original role and runtime_version; existing legacy tasks retain their original protocol until drained. In version 2, discuss pending requests here before routing if needed. Choose authorized Bridge or host tools within upstream role rules, with no added tool priority or forced delegation. Explicitly report execution stages; this server does not monitor host agents. Do not also handle this as ordinary Chat. ':'Chat: converse naturally using the included multi-message context. Do not create or dispatch Super Agent tasks. ')+'You may save replies now with chat.reply. Subscribe to chat.message through the host event-task capability (MCP events/subscribe) to receive future notifications. Event delivery is independent of saved messages.',
      ...(current.interaction_mode==='plan'?{planning_instructions:PLAN_GUIDANCE}:{}),
      event:{name:chatEventDefinition.name,arguments:{chat_id:chat.id,connection}},history:{chat_id:chat.id}};
  }
  private async connection(chat:Conversation,connection:unknown,actor:ChatPrincipal,caller:string):Promise<Writer>{
    const account=modelActor(actor);
    if(typeof connection!=='string'||!connection)throw fail('chat_in_use','该对话需要原连接凭据；收到事件时请使用 data.connection。');
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      const writer=await tx.get<Writer>(writerKey(chat.id));
      if(writer){
        if(writer.account!==account.id||writer.epoch!==account.epoch||writer.caller!==caller||!await this.matchesConnection(writer,connection))throw fail('chat_in_use','该对话正在被使用；请使用原连接或事件 data.connection 回复，不要接管其他对话。');
        return writer;
      }
      const digest=await hash(connection),candidate=await tx.get<Candidate>('chat-candidate:'+digest);
      if(!candidate||candidate.chat!==chat.id||candidate.account!==account.id||candidate.epoch!==account.epoch||candidate.caller!==caller||candidate.expires_at<=Date.now())throw fail('chat_not_connected','模型连接已结束，请重新调用 chat.resume。');
      // Reserve the single writer when the issued credential is first used. A lost resume
      // response alone must not leave an unreachable owner holding the conversation.
      const binding:Writer={id:'v'+await this.next(tx,'chat-subscription'),chat:chat.id,account:account.id,epoch:account.epoch,caller,connection_hash:digest,event_connection:secret()};
      current.writer=binding.id;await tx.put(writerKey(chat.id),binding);await this.recordChange(tx,current);
      await tx.delete('chat-candidate:'+digest);await this.expiry(tx,'candidate',digest);return binding;
    });
  }
  private async matchesConnection(sub:Pick<Writer,'connection_hash'> & {event_connection?:string},value:unknown):Promise<boolean>{
    if(typeof value!=='string'||!value)return false;
    return sub.connection_hash===await hash(value)||!!sub.event_connection&&this.env.equal(new TextEncoder().encode(sub.event_connection),new TextEncoder().encode(value));
  }
  private async queueMessage(tx:KeyStore,chat:Conversation,message:Message):Promise<void>{
    const sub=chat.active?await tx.get<Subscription>(subKey(chat.active)):undefined;
    const ready=!!sub&&(sub.expires_at===null||sub.expires_at>Date.now());
    await this.saveEvent(tx,{chat:chat.id,sequence:message.sequence,subscription:sub?.id??'',attempts:0,next_at:Date.now(),state:ready?'pending':'paused'});
  }
  private async resolveNotification(tx:KeyStore,chat:string,sequence:number):Promise<void>{
    const event=await tx.get<Outbox>(outboxKey(chat,sequence));
    if(event&&event.state!=='delivered'&&event.state!=='resolved'){event.state='resolved';await this.saveEvent(tx,event);}
  }
  private async savedResponse(tx:KeyStore,chat:Conversation,message:Message,summary:Data):Promise<Data>{
    const visible=await this.viewMessage(tx,chat.id,message);
    const last=message.sequence===chat.sequence?message:(await tx.get<Message>(messageKey(chat.id,chat.sequence)))!;
    const lastView=await this.viewMessage(tx,chat.id,last);
    return {saved:true,message:visible,chat:{...summary,title:chat.title,updated_at:chat.updated_at,message_count:chat.sequence,
      state:chat.writer?'connected':'waiting',subscribed:!!chat.active,notification:lastView.notification,
      delivery_state:last.role==='assistant'?'replied':lastView.delivery}};
  }
  private async textAttachment(chat:Conversation,text:string,requestKey:string,actor:ChatPrincipal):Promise<AttachmentView>{
    const checksum=hex(sha256(new TextEncoder().encode(text)));
    return storeTextAttachment(text,requestKey,{
      start:async input=>{const result=await this.startUpload(chat,input,actor);return {attachment:result.attachment,chunk_size:result.chunk_size};},
      chunk:async input=>{
        const complete=async()=>{const current=await this.attachment(chat.id,input.attachment_id);return current.state==='ready'&&current.sha256===checksum;};
        if(await complete())return;
        try{await this.writeUpload(chat,input,actor);}catch(error){if(!await complete())throw error;}
      },
      complete:async input=>{const result=await this.completeUpload(chat,input,actor);return {attachment:result.attachment};}
    });
  }
  private eventEnvelope(chat:Conversation,message:Message,context:Data|null,connection:string|undefined,cursor:number):Data{
    const mode=chatMode(chat.mode),base={chat_id:chat.id,mode,...modeRepository(mode,chat.repository),
      source_identity:message.source_identity??{kind:'unknown',authenticated:false},context,command_processed:message.command_processed??null,
      approval_id:message.approval_id??null,connection,device_id:chat.device_id,message_id:message.id,url:this.env.publicUrl+'/chat?id='+chat.id,
      payload_version:2};
    const data=mode==='chat'?{...base,
      interaction_mode:chat.interaction_mode??'normal',interaction_revision:chat.interaction_revision??0,
      ...(message.planning_request?{planning_request:true}:{}),
      processing:'The complete current body and attachments are in context.current_message. Continue this conversation naturally; combine pending inputs when appropriate, without a separate acknowledgement or reply to every message. Do not create Super Agent tasks. Before recovery read newer user directions and inspect uncertain effects.'+
        (chat.interaction_mode==='plan'?'\n\n'+PLAN_GUIDANCE:message.planning_request?' This input was explicitly sent for planning. It is not an instruction to implement the work.':'')}
      :{...base,kind:'user_message',
      processing:'The complete current body and attachments are in context.current_message. Read chat.task instructions for this runtime version. Discuss with the user here before routing when needed; preserve original source references. Use the original framework tools and report execution stages explicitly. Choose authorized host or Bridge tools under the upstream role rules; no added tool preference or mandatory delegation. Commands marked command_processed are already applied; inspect tasks without repeating commands. Approval notices are not new tasks.'};
    return {eventId:chat.id+'-'+message.id,name:chatEventDefinition.name,timestamp:message.created_at,data,cursor:cursor?'m'+cursor:null};
  }
  private splitOversizedText(mode:ChatMode,text:string):{keptText:string;uploadText:string}{
    if(mode==='super_agent'){
      const match=/^\s*(\/(?:task-new|new)|\/task\s+\S+)\s+([\s\S]+)$/.exec(text);
      if(match&&match[2].trim())return {keptText:match[1].replace(/\s+/,' '),uploadText:match[2]};
    }
    return {keptText:'',uploadText:text};
  }
  private async prepareHumanSendPayload(chat:Conversation,args:Data,actor:ChatPrincipal,originalText:string,ids:unknown[],attachments:Attachment[],source:'web'|'tui',summary:Data):Promise<{cached?:Data;text:string;attachments:Attachment[]}>{
    const cached=await this.store.transaction(async tx=>{await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      const d=await this.dedupe(tx,chat.id+':send:'+principalScope(actor),args.request_key,[originalText,ids,args.reply_to??null,null]);
      return d.result?this.savedResponse(tx,current,(await tx.get<Message>(messageKey(chat.id,d.result.sequence)))!,summary):null;});
    if(cached)return {cached,text:originalText,attachments};
    const current=(await this.store.get<Conversation>(key(chat.id)))!,sequence=current.sequence+1,mode=chatMode(current.mode);
    const hint=mode==='chat'?await processingMeta(this.store,chat.id,current.sequence):undefined;
    let text=originalText;
    const candidate:Message={id:'m'+sequence,sequence,role:'user',source,source_identity:sourceIdentity(actor),text,
      attachments:attachments.map(viewAttachment),created_at:now(),...(args.reply_to?{reply_to:args.reply_to}:{})};
    const subscription=current.active?await this.store.get<Subscription>(subKey(current.active)):undefined;
    const envelopeConnection=subscription?.event_connection??'x'.repeat(22);
    const fitCandidate=(value:Message,revisionDelta:number)=>fitContextToEnvelope(
      buildContext(chat.id,mode,value,[],{...(hint?{pendingHint:{...hint,revision:hint.revision+revisionDelta,unresolved_count:hint.unresolved_count+revisionDelta}}:{}),currentIsTrigger:true}),
      context=>this.eventEnvelope(current,value,context,envelopeConnection,current.sequence));
    if(fitCandidate(candidate,1).requires_attachment&&text){
      const {keptText,uploadText}=this.splitOversizedText(mode,text);
      const body=await this.textAttachment(chat,uploadText,'send:'+principalScope(actor)+':'+args.request_key,actor);
      attachments=[...attachments,await this.attachment(chat.id,body.id,true)];
      text=keptText;candidate.text=keptText;candidate.attachments=attachments.map(viewAttachment);
    }
    if(fitCandidate(candidate,0).requires_attachment)
      throw fail('event_too_large','消息附件元数据超过事件上限，请减少本次附件数量');
    return {text,attachments};
  }
  private async send(chat:Conversation,args:Data,actor:ChatPrincipal,caller:string,model:boolean):Promise<Data>{
    const writer=model?await this.connection(chat,args.connection,actor,caller):undefined;
    const originalText=args.text===undefined?'':textValue(args.text,'text');let text=originalText;
    if(new TextEncoder().encode(text).length>(!model?2*1024*1024:512*1024))throw fail('message_too_large','消息超过此接口上限，请作为附件发送');
    const ids=args.attachments??[];if(!Array.isArray(ids)||!ids.every(v=>typeof v==='string'))throw fail('invalid_chat_argument','attachments 必须为附件编号列表');
    let attachments=await Promise.all(ids.map(id=>this.attachment(chat.id,id,true)));
    if(!text.trim()&&!attachments.length)throw fail('empty_message','消息不能为空');
    const source=model?'model':args.source==='tui'?'tui':'web',summary=await this.summary(chat,actor);
    if(!model){
      const prepared=await this.prepareHumanSendPayload(chat,args,actor,originalText,ids,attachments,source as 'web'|'tui',summary);
      if(prepared.cached)return prepared.cached;
      text=prepared.text;attachments=prepared.attachments;
    }
    const result=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      if(model&&current.writer!==writer!.id)throw fail('chat_not_connected','原模型连接已结束');
      if(args.resolves_message_ids!==undefined&&(!model||chatMode(current.mode)!=='chat'))throw fail('invalid_chat_argument','只有普通 Chat 模型回复可合并处理输入');
      const d=model?await this.replyDedupe(tx,chat.id,args.request_key,text,ids,args.reply_to,args.resolves_message_ids,args.expected_revision)
        :await this.dedupe(tx,chat.id+':send:'+principalScope(actor),args.request_key,[originalText,ids,args.reply_to??null,null]);
      if(d.result)return this.savedResponse(tx,current,(await tx.get<Message>(messageKey(chat.id,d.result.sequence)))!,summary);
      if(args.reply_to!==undefined){
        if(typeof args.reply_to!=='string'||!/^m[1-9]\d*$/.test(args.reply_to))throw fail('invalid_reply','引用必须是本对话的消息编号');
        const quoted=await tx.get<Message>(messageKey(chat.id,cursorOf(args.reply_to)));
        if(!quoted||quoted.role!==(model?'user':'assistant'))throw fail('invalid_reply',model?'模型引用必须指向本对话用户消息':'用户引用必须指向本对话助手消息');
      }
      const sequence=++current.sequence,id='m'+sequence,stamp=now();
      const m:Message={id,sequence,role:model?'assistant':'user',source,source_identity:sourceIdentity(actor,model),text,attachments:attachments.map(viewAttachment),created_at:stamp,saved_at:stamp,...(args.reply_to?{reply_to:args.reply_to}:{}),...(args.resolves_message_ids?{resolves_message_ids:args.resolves_message_ids}:{})};
      current.updated_at=stamp;
      if(model&&args.reply_to){
        const seq=cursorOf(args.reply_to),old=await tx.get<Message>(messageKey(chat.id,seq));
        if(!old||old.role!=='user')throw fail('invalid_reply','reply_to 必须指向该对话的用户消息');
        old.replies=[...(old.replies??[]),id];old.replied_at=stamp;await tx.put(messageKey(chat.id,seq),old);
        await noteSavedReply(tx,chat.id,seq,id);
        const event=await tx.get<Outbox>(outboxKey(chat.id,seq));if(event&&event.state!=='delivered'){event.state='resolved';await this.saveEvent(tx,event);}
        const timing=await tx.get<Timing>(timingKey(chat.id,seq))??{saved_at:old.created_at,attempts:0};timing.reply_saved_at=stamp;await tx.put(timingKey(chat.id,seq),timing);
      }
      const resolved=args.resolves_message_ids?await this.inputMessages(tx,chat.id,args.resolves_message_ids):[];
      if(resolved.length)await reportProcessing(tx,chat.id,current.sequence,resolved,{state:'resolved',expected_revision:args.expected_revision},
        {account:writer!.account,epoch:writer!.epoch,caller:writer!.caller},id);
      for(const message of resolved){
        await this.resolveNotification(tx,chat.id,message.sequence);
        const timing=await tx.get<Timing>(timingKey(chat.id,message.sequence))??{saved_at:message.created_at,attempts:0};
        timing.reply_saved_at=stamp;await tx.put(timingKey(chat.id,message.sequence),timing);
      }
      if(!model&&chatMode(current.mode)==='chat')await queueInput(tx,chat.id,m);
      await tx.put({[key(chat.id)]:current,[messageKey(chat.id,sequence)]:m,[d.key]:{...(model?{version:2}:{}),fingerprint:d.fingerprint,result:{sequence}},[timingKey(chat.id,sequence)]:{saved_at:stamp,attempts:0}});
      await this.recordChange(tx,current,[sequence,...(model&&args.reply_to?[cursorOf(args.reply_to)]:[]),...resolved.map(m=>m.sequence)]);
      if(!model){
        if(chatMode(current.mode)==='super_agent'){
          const outcome=await superAgentMessage(tx,{chatId:chat.id,deviceId:chat.device,principal:actor,messageId:m.id,text,at:stamp,repository:current.repository,attachments:m.attachments,
            authorizePrincipal:(_storage,source)=>this.access(source,chat.device,tx)});
          if((outcome as Data).runtime_version===2)await this.trackSuperAgent(tx,current,actor);
          if(outcome.command){m.command_processed=outcome.command;await tx.put(messageKey(chat.id,m.sequence),m);}
          if(outcome.reply){
            const sequence=++current.sequence;
            const note:Message={id:'m'+sequence,sequence,role:'assistant',source:'module',text:outcome.reply,attachments:[],created_at:stamp,saved_at:stamp,reply_to:m.id};
            await tx.put(messageKey(chat.id,sequence),note);await this.recordChange(tx,current,[m.sequence,sequence]);
          }
        }
        await this.queueMessage(tx,current,m);
      }
      if(chatMode(current.mode)==='chat'){
        if(!model)await this.pauseQueuedGoal(tx,chat.id);
        if(resolved.length)await this.scheduleGoal(tx,current);
        await observeContext(tx,chat.id,current.sequence,true);
      }
      return this.savedResponse(tx,current,m,summary);
    });
    this.signal(chat.id);return result;
  }
  async approvalNotice(actor:ChatPrincipal,chatId:string,approvalId:string,decision:string,tool?:Data,origin?:ApprovalOrigin):Promise<Data>{
    await this.initialize();const chat=await this.chat(chatId,actor);
    const result=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const noticeKey='chat-approval-notice:'+approvalId,previous=await tx.get<Data>(noticeKey);
      if(previous)return previous;
      const current=await tx.get<Conversation>(key(chat.id));if(!current)throw fail('chat_deleted','对话已删除');
      if(origin){
        const writer=await tx.get<Writer>(writerKey(chat.id));
        if(origin.chatId!==chat.id||current.writer!==origin.writerId||writer?.id!==origin.writerId||
          writer.account!==origin.account||writer.epoch!==origin.epoch||writer.caller!==origin.caller)return {discarded:true};
      }
      const sequence=++current.sequence,stamp=now();
      const message:Message={id:'m'+sequence,sequence,role:'user',source:normalizeIdentity(actor).kind==='device'?'tui':'web',
        text:(tool?'工具审批 '+tool.method+' '+tool.device+' '+tool.request_id:'命令审批 '+approvalId)+'：'+(decision==='allowed-once'?'已同意本次执行。':decision==='cancelled'?'已取消本次执行。':'已拒绝本次执行。'),
        attachments:[],created_at:stamp,saved_at:stamp,source_identity:sourceIdentity(actor),approval_id:approvalId,
        ...(origin?{approval_origin:origin}:{})};
      current.updated_at=stamp;const result={saved:true,chat_id:chat.id,message_id:message.id,decision};
      await tx.put({[messageKey(chat.id,sequence)]:message,[timingKey(chat.id,sequence)]:{saved_at:stamp,attempts:0},[noticeKey]:result});
      await this.recordChange(tx,current,[sequence]);await this.queueMessage(tx,current,message);
      if(chatMode(current.mode)==='chat')await observeContext(tx,chatId,current.sequence,true);
      return result;
    });
    if(result.chat_id)this.signal(result.chat_id);return result;
  }
  private async attachment(chat:string,id:unknown,ready=false):Promise<Attachment>{
    if(typeof id!=='string')throw fail('attachment_not_found','附件不存在');
    const a=await this.store.get<Attachment>(attachmentKey(chat,id));
    if(!a||ready&&a.state!=='ready')throw fail('attachment_not_found','附件不存在或尚未上传完成');return a;
  }
  private async startUpload(chat:Conversation,args:Data,actor:ChatPrincipal):Promise<Data>{
    const name=textValue(args.name,'name').replaceAll('\\','/').split('/').at(-1)!.trim();if(!name)throw fail('invalid_chat_argument','附件名称不能为空');
    const size=integer(args.size,'size'),mime_type=args.mime_type?textValue(args.mime_type,'mime_type'):'application/octet-stream';
    const expected=args.sha256===undefined?undefined:textValue(args.sha256,'sha256').toLowerCase();
    if(expected&&!/^[0-9a-f]{64}$/.test(expected))throw fail('invalid_chat_argument','sha256 格式不正确');
    const attachment=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const fingerprint=[name,size,mime_type,expected??null,...(args.protocol==='tus'?['tus',args.upload_metadata??null]:[])];
      const d=await this.dedupe(tx,chat.id+':upload:'+principalScope(actor),args.request_key,fingerprint);
      if(d.result){const a=await tx.get<Attachment>(attachmentKey(chat.id,d.result.id));if(!a)throw fail('upload_expired','上传已过期');return a;}
      const c=await tx.get<Conversation>(key(chat.id));if(!c)throw fail('chat_deleted','对话已删除');
      if(args.protocol==='tus'&&[...(await tx.list<Attachment>({prefix:'chat-attachment:'+chat.id+':'})).values()].filter(a=>a.state==='uploading'&&a.expires_at!>Date.now()).length>=16)throw fail('upload_limit','Too many active uploads');
      const a:Attachment={...(args.protocol==='tus'?{protocol:'tus' as const,upload_metadata:args.upload_metadata}:{}),id:'a'+(++c.attachments),name,size,mime_type,offset:0,chunks:0,state:'uploading',expires_at:Date.now()+86_400_000,...(expected?{expected_sha256:expected}:{})};
      await tx.put({[key(chat.id)]:c,[attachmentKey(chat.id,a.id)]:a,[d.key]:{fingerprint:d.fingerprint,result:{id:a.id}}});await this.expiry(tx,'upload',chat.id+':'+a.id,a.expires_at);return a;
    });if(attachment.expires_at)await this.env.schedule(attachment.expires_at);
    return {attachment,chunk_size:CHUNK};
  }
  private async writeUpload(chat:Conversation,args:Data,actor:ChatPrincipal):Promise<Data>{
    const offset=integer(args.offset,'offset'),data=textValue(args.data,'data');let bytes:Uint8Array;
    try{bytes=from64(data);}catch{throw fail('invalid_chat_argument','附件分片不是有效 Base64');}
    if(!bytes.length||bytes.length>CHUNK||offset%CHUNK!==0)throw fail('invalid_chat_argument','分片必须按 chunk_size 对齐，且不可为空或超过 chunk_size');
    return this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      if(!await tx.get(key(chat.id)))throw fail('chat_deleted','对话已删除');
      const a=await tx.get<Attachment>(attachmentKey(chat.id,args.attachment_id));
      if(a?.protocol==='tus')throw fail('upload_conflict','Use the tus endpoint for this upload');
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
  private async completeUpload(chat:Conversation,args:Data,actor:ChatPrincipal):Promise<Data>{
    const a=await this.attachment(chat.id,args.attachment_id);if(a.state==='ready')return {attachment:{...viewAttachment(a),state:'ready'}};
    if(a.offset!==a.size)throw fail('upload_incomplete','附件尚未上传完整');
    const digest=sha256.create();let count=0;
    for(let index=0;index<a.chunks;index++){await this.access(actor,chat.device);const bytes=await this.chunk(chat.id,a.id,index);count+=bytes.length;digest.update(bytes);}
    const checksum=hex(digest.digest());if(count!==a.size||a.expected_sha256&&checksum!==a.expected_sha256)throw fail('attachment_checksum','附件大小或 SHA256 校验不一致');
    await this.store.transaction(async tx=>{await this.access(actor,chat.device,tx);const current=await tx.get<Attachment>(attachmentKey(chat.id,a.id));if(!current)throw fail('upload_expired','上传已过期');current.sha256=checksum;current.state='ready';delete current.expires_at;delete current.expected_sha256;await tx.put(attachmentKey(chat.id,a.id),current);await this.expiry(tx,'upload',chat.id+':'+a.id);});
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
  async download(chatId:string,id:string,actor:ChatPrincipal,request?:Request):Promise<Response>{
    const chat=await this.chat(chatId,actor),a=await this.attachment(chat.id,id,true);
    // All completed uploads have a digest. Legacy records without one cannot advertise a strong validator.
    const etag=a.sha256?'"sha256-'+a.sha256+'"':undefined;
    const headers=new Headers({'Content-Type':a.mime_type,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(a.name),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'});
    if(etag)headers.set('ETag',etag);
    const ifRange=request?.headers.get('If-Range');
    const range=(!ifRange||etag&&ifRange===etag)?byteRange(request?.headers.get('Range')??null,a.size):null;
    if(range===false){headers.set('Content-Range','bytes */'+a.size);return new Response(null,{status:416,headers});}
    const start=range?range.start:0,end=range?range.end:a.size-1;let position=start;
    headers.set('Content-Length',String(Math.max(0,end-start+1)));
    if(range)headers.set('Content-Range',`bytes ${start}-${end}/${a.size}`);
    const stream=request?.method==='HEAD'?null:new ReadableStream<Uint8Array>({pull:async controller=>{
      try{
        await this.chat(chat.id,actor);
        if(position>end){controller.close();return;}
        const index=Math.floor(position/CHUNK),chunk=await this.chunk(chat.id,a.id,index);
        const bytes=chunk.subarray(position%CHUNK,Math.min(chunk.length,end-index*CHUNK+1));
        if(!bytes.length)throw fail('attachment_incomplete','Attachment data missing');
        position+=bytes.length;controller.enqueue(bytes);
      }catch(e){controller.error(e);}
    }},{highWaterMark:0});
    return new Response(stream,{status:range?206:200,headers});
  }

  /** tus core + creation only. Each persisted prefix is independently authenticated and resumable. */
  async tus(request:Request,chatId:string,id:string|undefined,actor:ChatPrincipal):Promise<Response>{
    const headers=new Headers({'Tus-Resumable':TUS_VERSION,'Cache-Control':'no-store'});
    const reply=(status:number)=>new Response(null,{status,headers});
    let held:string|undefined;
    try{
      await this.initialize();const chat=await this.chat(chatId,actor);
      if(request.method==='OPTIONS'){
        headers.set('Tus-Version',TUS_VERSION);headers.set('Tus-Extension','creation');
        headers.set('Tus-Max-Size',String(MAX_ATTACHMENT_SIZE));return reply(204);
      }
      if(request.headers.get('Tus-Resumable')!==TUS_VERSION){headers.set('Tus-Version',TUS_VERSION);return reply(412);}
      if(!id&&request.method==='POST'){
        const size=unsignedHeader(request.headers.get('Upload-Length'));
        if(size===undefined||request.headers.has('Upload-Defer-Length')||request.headers.has('Upload-Concat'))return reply(400);
        if(size>MAX_ATTACHMENT_SIZE)return reply(413);
        // Creation-with-upload is not advertised or accepted.
        if(Number(request.headers.get('Content-Length')??0)>0)return reply(400);
        if(request.body){
          const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
          try{
            const empty=async()=>{for(;;){const part=await reader.read();if(part.done)return true;if(part.value.length)return false;}};
            if(!await Promise.race([empty(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(fail('upload_timeout','Upload stalled')),5000);})]))return reply(400);
          }finally{clearTimeout(timer);await cancelBody(reader);}
        }
        let metadata:Record<string,string>;try{metadata=uploadMetadata(request.headers.get('Upload-Metadata'));}catch{return reply(400);}
        const retryKey=request.headers.get('Idempotency-Key');
        if(retryKey!==null&&!/^[A-Za-z0-9_.:-]{1,200}$/.test(retryKey))return reply(400);
        const result=await this.startUpload(chat,{name:metadata.filename||'attachment',mime_type:metadata.filetype||'application/octet-stream',size,request_key:retryKey?'tus:'+retryKey:crypto.randomUUID(),protocol:'tus',upload_metadata:request.headers.get('Upload-Metadata')??undefined},actor);
        if(!size)await this.completeUpload(chat,{attachment_id:result.attachment.id},actor);
        headers.set('Location',new URL('/chat/uploads/'+chatId+'/'+result.attachment.id,this.env.publicUrl).href);
        headers.set('Upload-Offset','0');return reply(201);
      }
      if(!id)return reply(405);
      const a=await this.attachment(chat.id,id);
      if(a.protocol!=='tus')return reply(404);
      if(a.expires_at&&a.expires_at<=Date.now())return reply(410);
      headers.set('Upload-Offset',String(a.offset));headers.set('Upload-Length',String(a.size));
      if(a.upload_metadata!==undefined)headers.set('Upload-Metadata',a.upload_metadata);
      // Recover a completed byte stream whose final digest transaction lost its
      // response or failed. A standard tus client's HEAD must not report success
      // while the finished attachment remains unusable.
      if(request.method==='HEAD'){
        if(a.offset===a.size&&a.state!=='ready')await this.completeUpload(chat,{attachment_id:id},actor);
        return reply(200);
      }
      if(request.method!=='PATCH')return reply(405);
      if(request.headers.get('Content-Type')!=='application/offset+octet-stream')return reply(415);
      if(request.headers.has('Upload-Checksum')||request.headers.has('Upload-Concat')||request.headers.has('Upload-Length'))return reply(400);
      const offset=unsignedHeader(request.headers.get('Upload-Offset'));
      if(offset===undefined)return reply(400);
      if(offset!==a.offset)return reply(409);
      const length=unsignedHeader(request.headers.get('Content-Length'));
      if(length!==undefined&&(length>MAX_PATCH_SIZE||length>a.size-offset))return reply(413);
      if(request.headers.has('Content-Length')&&length===undefined)return reply(400);
      const lock=chat.id+':'+id;
      if(this.uploadRequests.has(lock))return reply(409);
      if(this.uploadRequests.size>=8)return reply(429);
      this.uploadRequests.add(lock);held=lock;
      const reader=request.body?.getReader();let position=offset,total=0;
      const deadline=Date.now()+300_000;
      try{
        if(reader)for(;;){
          let timer:ReturnType<typeof setTimeout>|undefined;
          const part=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(fail('upload_timeout','Upload stalled')),Math.max(1,Math.min(30_000,deadline-Date.now())));})]).finally(()=>clearTimeout(timer));
          if(part.done)break;
          if(total+part.value.length>MAX_PATCH_SIZE||position+part.value.length>a.size)return reply(413);
          total+=part.value.length;
          for(let cursor=0;cursor<part.value.length;){
            const take=Math.min(CHUNK-position%CHUNK,part.value.length-cursor);
            const bytes=part.value.subarray(cursor,cursor+take);
            position=await this.store.transaction(async tx=>{
              await this.access(actor,chat.device,tx);
              if(!await tx.get(key(chat.id)))throw fail('chat_deleted','Chat deleted');
              const current=await tx.get<Attachment>(attachmentKey(chat.id,id));
              if(!current||current.expires_at&&current.expires_at<=Date.now())throw fail('upload_expired','Upload expired');
              if(current.offset!==position||current.state!=='uploading')throw fail('upload_offset','Upload offset changed');
              const index=Math.floor(position/CHUNK),prefix=position%CHUNK;
              const merged=new Uint8Array(prefix+take);
              if(prefix){
                const old=this.env.blobs?await this.env.blobs.read(chat.id,id,index):from64((await tx.get<string>(chunkKey(chat.id,id,index)))!);
                if(old.length<prefix)throw fail('attachment_incomplete','Attachment data missing');
                merged.set(old.subarray(0,prefix));
              }
              merged.set(bytes,prefix);
              // Bytes become durable before committing the visible offset. An uncommitted tail is ignored on retry.
              if(this.env.blobs)await this.env.blobs.write(chat.id,id,index,merged);else await tx.put(chunkKey(chat.id,id,index),to64(merged));
              current.offset+=take;current.chunks=Math.ceil(current.offset/CHUNK);current.expires_at=Date.now()+86_400_000;
              await tx.put(attachmentKey(chat.id,id),current);await this.expiry(tx,'upload',chat.id+':'+id,current.expires_at);
              return current.offset;
            });
            headers.set('Upload-Offset',String(position));cursor+=take;
          }
        }
        if(length!==undefined&&length!==total)return reply(400);
        if(position===a.size)await this.completeUpload(chat,{attachment_id:id},actor);
        return reply(204);
      }finally{await cancelBody(reader);}
    }catch(error){
      const code=(error as Data).code;
      if(code==='upload_offset'||code==='upload_conflict'||code==='request_conflict')return reply(409);
      if(code==='upload_limit')return reply(429);
      if(code==='upload_timeout')return reply(408);
      if(code==='upload_expired')return reply(410);
      if(code==='attachment_not_found'||code==='chat_not_found'||code==='chat_deleted')return reply(404);
      if(code==='invalid_chat_argument')return reply(400);
      // Authentication errors remain under the gateway's normal authentication/error handler.
      throw error;
    }finally{if(held)this.uploadRequests.delete(held);}
  }
  private async erase(chat:Conversation,actor:ChatPrincipal):Promise<boolean>{
    const attachments=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id));if(!current)return null;
      const files=[...(await tx.list<Attachment>({prefix:'chat-attachment:'+chat.id+':'})).values()];
      const subscriptions=new Set<string>();
      for(const [k,sub] of await tx.list<Subscription>({prefix:'chat-subscription:'}))if(sub.chat===chat.id){subscriptions.add(sub.id);await tx.delete(k);await this.expiry(tx,'subscription',sub.id);}
      for(const [k,id] of await tx.list<string>({prefix:'chat-subscription-index:'}))if(subscriptions.has(id))await tx.delete(k);
      for(const [k,candidate] of await tx.list<Candidate>({prefix:'chat-candidate:'}))if(candidate.chat===chat.id){await tx.delete(k);await this.expiry(tx,'candidate',k.slice('chat-candidate:'.length));}
      for(const a of files)await this.expiry(tx,'upload',chat.id+':'+a.id);
      const head=await tx.get<Head>('chat-head:'+chat.id);if(head)await tx.delete([dueKey(head),'chat-head:'+chat.id]);
      for(const prefix of ['chat-change:','chat-timing:','chat-pending:','chat-unack:','chat-message:','chat-attachment:','chat-chunk:','chat-event:','chat-request:','chat-import:','chat-approval:','chat-module-reply:','chat-context-token:','chat-working-snapshot:','chat-maintenance-status:','chat-maintenance-receipt:'])await tx.delete([...(await tx.list({prefix:prefix+chat.id+':'})).keys()]);
      for(const prefix of [reviewTimelinePrefix(chat.id),pendingApprovalPrefix(chat.id)])await tx.delete([...(await tx.list({prefix})).keys()]);
      await tx.delete('chat-approval-pending-index:'+chat.id);
      await eraseSourceFingerprints(tx,'chat-working-source:'+chat.id+':');
      await eraseSourceFingerprints(tx,'chat-maintenance-source:'+chat.id+':');
      await superAgentErase(tx,chat.id);
      const taskSchedule=await tx.get<Data>('chat-super-agent-schedule:'+chat.id);if(taskSchedule)await tx.delete(taskSchedule.key);
      await tx.delete(['chat-super-agent-schedule:'+chat.id,'chat-super-agent-wake:'+chat.id]);
      await eraseProcessing(tx,chat.id);
      await tx.delete([goalKey(chat.id),...(await tx.list({prefix:collaborationWakePrefix+chat.id+':'})).keys(),
        ...(await tx.list({prefix:'chat-plan-review:'+chat.id+':'})).keys()]);
      await eraseChatSummary(tx,chat.id);await eraseTrace(tx,chat.id);
      await eraseSummaryProduction(tx,chat.id);await eraseSubscriptionHandoffs(tx,chat.id);await tx.delete('chat-routing-revision:'+chat.id);
      await this.clearChatChannelOutbox(tx,chat.id);
      const identity=normalizeIdentity(actor);
      if(identity.kind==='account')await eraseChannelDiagnosticsForChat(tx,identity.actor.id,chat.id);
      else await eraseChannelDiagnosticsForChat(tx,principalScope(actor),chat.id);
      await tx.delete([channelCommandKey(chat.id),maintenanceKey(chat.id),subscriptionKey(chat.id),maintenanceDiagnosticsKey(chat.id),callbackDiagnosticsKey(chat.id),'chat-context-index:'+chat.id,key(chat.id),writerKey(chat.id),indexKey(chat.id),deviceIndexKey(chat.device,chat.id)]);
      return files;
    });
    if(attachments===null)return false;
    // Deleting metadata first prevents a simultaneous uploader recreating a removed chunk folder.
    if(this.env.blobs)for(const a of attachments)await this.env.blobs.remove(chat.id,a.id);await this.changed(chat.id);
    return true;
  }
  async startLink(args:Data):Promise<Data>{
    await this.initialize();
    const device=await this.store.get<Data>('device:'+textValue(args.device_id,'device_id'));
    if(!device||device.key_hash!==await hash(textValue(args.device_key,'device_key')))throw fail('device_unauthorized','电脑注册凭据无效');
    const id=secret(),poll=secret(),code=hex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();
    if(args.scope!==undefined&&args.scope!=='account'&&args.scope!=='device')throw fail('invalid_chat_argument','scope 必须为 account 或 device');
    const link:Link={id,code,device:device.id,scope:args.scope??'device',token_hash:await hash(poll),expires_at:Date.now()+600_000};
    await this.store.transaction(async tx=>{await tx.put({['chat-link:'+id]:link,['chat-link-code:'+code]:id});await this.expiry(tx,'link',id,link.expires_at);});await this.env.schedule(link.expires_at);
    return {code,request_id:id,poll_token:poll,verification_url:this.env.publicUrl+'/chat/connect?code='+code,expires_at:link.expires_at};
  }
  private async link(code:string):Promise<Link>{
    const id=await this.store.get<string>('chat-link-code:'+code.toUpperCase()),link=id?await this.store.get<Link>('chat-link:'+id):undefined;
    if(!link||link.expires_at<=Date.now())throw fail('chat_link_expired','终端连接请求已过期');return link;
  }
  private async authorizeLink(link:Link,actor:Actor,tx?:KeyStore):Promise<void>{
    if(link.scope==='account')await validateIdentity(this.accounts,this.store,actor,tx);
    else await this.access(actor,link.device,tx);
  }
  private async linkDevice(link:Link):Promise<ChatDevice>{
    const device=await this.store.get<Data>('device:'+link.device);if(!device)throw fail('device_missing','电脑已注销');
    return this.env.device(link.device,{kind:'device',device:link.device,key_hash:device.key_hash});
  }
  async linkDetails(code:string,actor:Actor):Promise<Data>{
    const link=await this.link(code);await this.authorizeLink(link,actor);const d=await this.linkDevice(link);return {scope:link.scope??'device',device:{id:d.id,name:d.name,system:d.system},expires_at:link.expires_at,approved:!!link.approved_by};
  }
  async approveLink(code:string,actor:Actor):Promise<Data>{
    const link=await this.link(code);await this.authorizeLink(link,actor);const token=secret();
    await this.store.transaction(async tx=>{
      await this.authorizeLink(link,actor,tx);
      const current=await tx.get<Link>('chat-link:'+link.id);if(!current||current.expires_at<=Date.now())throw fail('chat_link_expired','终端连接请求已过期');
      if(current.approved_by){if(current.approved_by!==actor.id)throw fail('chat_link_claimed','终端已由其他账号连接');return;}
      current.approved_by=actor.id;current.epoch=actor.epoch;current.credential=token;
      await tx.put({['chat-link:'+link.id]:current,['chat-credential:'+await hash(token)]:{account:actor.id,epoch:actor.epoch,device:link.device,scope:link.scope??'device'} satisfies Credential});
    });return {approved:true,...await this.linkDetails(code,actor)};
  }
  async denyLink(code:string,actor:Actor):Promise<Data>{const link=await this.link(code);await this.authorizeLink(link,actor);await this.store.transaction(async tx=>{await this.authorizeLink(link,actor,tx);await tx.put('chat-link-denied:'+link.id,link.expires_at);await tx.delete(['chat-link:'+link.id,'chat-link-code:'+link.code]);await this.expiry(tx,'link',link.id);await this.expiry(tx,'denied',link.id,link.expires_at);});return {denied:true};}
  async pollLink(args:Data):Promise<Data>{
    if(await this.store.get('chat-link-denied:'+args.request_id))return {state:'denied'};
    const link=await this.store.get<Link>('chat-link:'+args.request_id);
    if(!link||link.expires_at<=Date.now())return {state:'expired'};
    if(link.token_hash!==await hash(textValue(args.poll_token,'poll_token')))throw fail('chat_link_unauthorized','终端连接凭据无效');
    if(!link.approved_by)return {state:'pending'};
    const actor=await this.accounts.require(link.approved_by,link.epoch);await this.authorizeLink(link,actor);const d=await this.linkDevice(link);
    return {state:'approved',scope:link.scope??'device',credential:link.credential,device:{id:d.id,name:d.name,system:d.system},account:{id:actor.id,username:actor.username}};
  }
  async authenticateCredential(token:string):Promise<{actor:Actor;scope:'account'|'device';device_id?:string;raw_device?:string}>{
    const credential=await this.store.get<Credential>('chat-credential:'+await hash(token));if(!credential)throw fail('chat_credential_invalid','终端登录已失效，请重新连接');
    const actor=await this.accounts.require(credential.account,credential.epoch);
    if(credential.scope==='account')return {actor,scope:'account'};
    await this.access(actor,credential.device);const d=await this.env.device(credential.device,actor);return {actor,scope:'device',device_id:d.id,raw_device:d.raw};
  }
  async events(method:'list'|'subscribe'|'unsubscribe',args:Data,actor:Actor,caller:string):Promise<Data>{
    await this.accounts.require(actor.id,actor.epoch);await this.initialize();
    if(method==='list')return {events:[chatEventDefinition,summaryDueEventDefinition,channelEventDefinition]};
    if(args.name===channelEventDefinition.name)return this.channelEvents(method,args,actor,caller);
    if(method==='unsubscribe'&&['chat.message','chat.summary_due'].includes(args.name)){
      const input=args.arguments,chatId=textValue(input?.chat_id,'chat_id');
      if(!/^t[1-9]\d*$/.test(chatId)||typeof input.connection!=='string'||args.delivery?.mode!=='webhook')throw fail('invalid_event','退订需要 chat_id、connection 和 webhook');
      const url=parseWebhookUrl(args.delivery.url);
      let c:Conversation;
      try{c=await this.chat(chatId,actor);}
      catch(error){if((error as Data).code==='chat_not_found')return {};throw error;}
      if(input.handoff_id)return this.stagedEvent(method,args,actor,caller);
      const w=await this.store.get<Writer>(writerKey(c.id));
      if(w&&w.account===actor.id&&w.epoch===actor.epoch&&w.caller===caller&&await this.matchesConnection(w,args.arguments?.connection)){
        await this.store.transaction(async tx=>{
          if(args.name==='chat.summary_due')await recordMaintenanceDiagnostic(tx,c.id,method,'entered').catch(()=>{});
          const routes=await this.handoffPort().readRouting(tx,c.id),live=routes.endpoints[args.name as 'chat.message'|'chat.summary_due'];
          const all=[...((await tx.list<Subscription>({prefix:'chat-subscription:'})).values()),...(live?[live]:[])];
          const target=all.find(e=>e.chat===c.id&&e.url===url&&(e.writer_id??e.id.replace(/-summary$/,''))===w.id&&e.account===w.account&&e.epoch===w.epoch&&e.caller===w.caller&&(e.event_name??'chat.message')===args.name);
          if(target){await unsubscribeHandoffEndpoint(tx,this.handoffScope(c,w,actor),this.handoffPort(),args.name,target.id);await tx.delete(subKey(target.id));await this.expiry(tx,'subscription',target.id);}
          if(args.name==='chat.summary_due'&&(target||!live))await recordMaintenanceDiagnostic(tx,c.id,method,'unsubscribed').catch(()=>{});
        });this.signal(c.id);return {};
      }
    }
    if(['chat.message','chat.summary_due'].includes(args.name)&&args.arguments?.handoff_id)return this.stagedEvent(method,args,actor,caller);
    if(args.name===summaryDueEventDefinition.name)return this.maintenanceEvents(method,args,actor,caller);
    if(args.name!==chatEventDefinition.name||args.delivery?.mode!=='webhook')throw fail('invalid_event','只支持 chat.message 的 webhook 订阅');
    const input=args.arguments;if(!input||Object.keys(input).some(k=>!['chat_id','connection','handoff_id'].includes(k))||typeof input.connection!=='string')throw fail('invalid_event','订阅需要 chat_id 和 connection');
    let chat=await this.chat(textValue(input.chat_id,'chat_id'),actor);
    const url=parseWebhookUrl(args.delivery.url);
    if(method==='unsubscribe'){
      const writer=await this.store.get<Writer>(writerKey(chat.id));
      if(writer&&writer.account===actor.id&&writer.epoch===actor.epoch&&writer.caller===caller&&writer.callback_url===url&&await this.matchesConnection(writer,input.connection)){
        // Notifications are separate from writing authority. Only explicit disconnect/revocation ends the writer.
        await this.store.transaction(tx=>this.releaseIn(tx,chat.id,chat.active??writer.id,false));
        this.background(()=>this.changed(chat.id));
      }
      return {};
    }
    // Promote an unexpired pre-upgrade resume candidate without changing its credential.
    if(!chat.writer){await this.resume(chat,input,actor,caller);chat=await this.chat(chat.id,actor);}
    const writer=await this.connection(chat,input.connection,actor,caller);
    const signingKey=parseSigningKey(args.delivery.secret);
    const existing=chat.active?await this.store.get<Subscription>(subKey(chat.active)):undefined;
    if(existing&&existing.url!==url)throw fail('chat_in_use','该对话正在被使用');
    const ttl=args.ttlMs===null?null:args.ttlMs===undefined?86_400_000:integer(args.ttlMs,'ttlMs',1);
    const expires_at=ttl===null?null:Date.now()+ttl,cursor=args.cursor===undefined||args.cursor===null?(existing?.cursor??0):cursorOf(args.cursor);
    if(cursor>chat.sequence)throw fail('invalid_event_cursor','事件游标超过现有消息');
    const id=existing?.id??writer.id;
    if(!existing||existing.verified_at<Date.now()-300_000)await this.verify(url,signingKey,id,chat.id);
    const saved=await this.store.transaction(async tx=>{
      await this.access(actor,chat.device,tx);
      const current=await tx.get<Conversation>(key(chat.id)),binding=await tx.get<Writer>(writerKey(chat.id));
      if(!current||current.writer!==writer.id||binding?.id!==writer.id)throw fail('chat_in_use','原模型连接已结束');
      const previous=await tx.get<Subscription>(subKey(id));
      if(previous&&previous.url!==url)throw fail('chat_in_use','该对话正在被使用');
      const sub:Subscription={unified_context:chatMode(current.mode)==='chat',id,writer_id:writer.id,event_name:'chat.message',chat:chat.id,account:actor.id,epoch:actor.epoch,caller,connection_hash:writer.connection_hash,event_connection:writer.event_connection,url,secret:signingKey,expires_at,cursor:Math.min(previous?.cursor??cursor,cursor),verified_at:Date.now()};
      if(previous&&previous.secret!==signingKey){sub.previous_secret=previous.secret;sub.rotation_until=Date.now()+60_000;}
      else if(previous?.rotation_until&&previous.rotation_until>Date.now()){sub.previous_secret=previous.previous_secret;sub.rotation_until=previous.rotation_until;}
      current.active=id;delete current.reconnect_until;binding.callback_url=url;await tx.put(writerKey(chat.id),binding);await tx.put(subKey(id),sub);await this.recordChange(tx,current);
      await this.expiry(tx,'subscription',id,expires_at);
      if(expires_at!==null)await tx.requestAlarm?.(expires_at);
      for(const message of (await tx.list<Message>({prefix:'chat-message:'+chat.id+':'})).values())if(message.role==='user'&&!message.replied_at){
        const old=await tx.get<Outbox>(outboxKey(chat.id,message.sequence));
        if(old?.state==='delivered'||old?.state==='resolved'||old?.state==='failed')continue;
        if(message.approval_origin&&!this.approvalNoticeMatches(message.approval_origin,sub)){
          if(old)await this.resolveNotification(tx,chat.id,message.sequence);
          continue;
        }
        // Ordinary refreshes preserve backoff; only paused/configuration-blocked work is reactivated.
        const pending=old?.state==='pending';
        await this.saveEvent(tx,{chat:chat.id,sequence:message.sequence,subscription:id,attempts:old?.attempts??0,
          next_at:pending?old.next_at:Date.now(),state:'pending',...(pending&&old.error?{error:old.error}:{}),
          ...(old?.transient_403_attempts?{transient_403_attempts:old.transient_403_attempts}:{})});
      }
      const maintenance=await tx.get<Maintenance>(maintenanceKey(chat.id));
      if(sub.unified_context&&maintenance?.state==='waiting'&&!maintenance.notified&&maintenance.next_at===null){maintenance.next_at=Date.now();await persist(tx,chat.id,maintenance);}
      if(chatMode(current.mode)==='super_agent'){const wake=await tx.get<Data>('chat-super-agent-wake:'+chat.id);if(wake){wake.next_at=Date.now();await tx.put('chat-super-agent-wake:'+chat.id,wake);await tx.requestAlarm?.(wake.next_at);}}
      else await this.rearmCollaborationWake(tx,current);
      return sub;
    });
    await this.checkGoal(chat.id);this.signal(chat.id);return {id,refreshBefore:expires_at===null?null:new Date(expires_at).toISOString(),cursor:saved.cursor?'m'+saved.cursor:null,truncated:false};
  }
  private async signed(sub:Pick<Subscription,'id'|'url'|'secret'|'previous_secret'|'rotation_until'>&{chat?:string;channel?:ChannelDiagnosticScope},event:Data,onRejection?:(category:CallbackCategory)=>void):Promise<Response>{
    const body=JSON.stringify(event),id=String(event.eventId??'verify-'+secret()),date=new Date();
    if(new TextEncoder().encode(body).length>262144)throw fail('event_too_large','事件超过 256 KiB');
    let signature=new Webhook(sub.secret).sign(id,date,body);
    if(sub.previous_secret&&sub.rotation_until!>Date.now())signature+=' '+new Webhook(sub.previous_secret).sign(id,date,body);
    let response:Response;
    try{
      response=await this.env.webhookFetch(sub.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(date.getTime()/1000)),'webhook-signature':signature,'X-MCP-Subscription-Id':sub.id},body});
    }catch(error){
      if(sub.channel){
        const classified=classifyChannelError(error);
        const diagnostic:ChannelDiagnostic={
          at:date.toISOString(),phase:event.type==='verification'?'verification':'delivery',
          ...(sub.channel.action?{action:sub.channel.action}:{}),
          ...(sub.channel.chat_id?{chat_id:sub.channel.chat_id}:{}),
          ...(sub.channel.subscription_id?{subscription_id:sub.channel.subscription_id}:{}),
          ...(sub.channel.attempt!==undefined?{attempt:sub.channel.attempt}:{}),
          ...classified,
        };
        await this.store.transaction(tx=>recordChannelDiagnostic(tx,sub.channel!.account,diagnostic)).catch(()=>{});
      }
      throw error;
    }
    if(!response.ok&&sub.channel){
      const failure=await callbackFailure(response);
      const diagnostic:ChannelDiagnostic={
        at:date.toISOString(),phase:event.type==='verification'?'verification':'delivery',
        ...(sub.channel.action?{action:sub.channel.action}:{}),
        ...(sub.channel.chat_id?{chat_id:sub.channel.chat_id}:{}),
        ...(sub.channel.subscription_id?{subscription_id:sub.channel.subscription_id}:{}),
        ...(sub.channel.attempt!==undefined?{attempt:sub.channel.attempt}:{}),
        ...failure,
      };
      await this.store.transaction(tx=>recordChannelDiagnostic(tx,sub.channel!.account,diagnostic)).catch(()=>{});
    }else if(!response.ok&&sub.chat){
      const diagnostic={...await callbackFailure(response),at:date.toISOString(),phase:event.type==='verification'?'verification' as const:'delivery' as const,
        ...(typeof event.data?.message_id==='string'&&/^m[1-9][0-9]*$/.test(event.data.message_id)?{message_id:event.data.message_id}:{}),
        ...(Number.isSafeInteger(event.data?.generation)?{generation:event.data.generation}:{})};
      onRejection?.(diagnostic.category);
      await this.store.transaction(async tx=>{if(await tx.get(key(sub.chat!)))await recordCallbackDiagnostic(tx,sub.chat!,diagnostic);}).catch(()=>{});
    }
    return response;
  }
  private async verify(url:string,signingKey:string,id:string,chat?:string,channel?:ChannelDiagnosticScope):Promise<void>{
    const challenge=secret();let response:Response|undefined;
    try{
      response=await this.signed({url,secret:signingKey,id,chat,channel},{type:'verification',challenge});
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
  private async releaseIn(tx:KeyStore,chat:string,id:string,endWriter=true):Promise<void>{
    const current=await tx.get<Conversation>(key(chat)),writer=await tx.get<Writer>(writerKey(chat));
    const ending=!!(endWriter&&writer&&(writer.id===id||current?.active===id));
    const ids=new Set<string>([id]);if(ending&&current?.active)ids.add(current.active);
    let cancelledReview:string|undefined;
    if(ending){
      for(const sub of (await tx.list<Subscription>({prefix:'chat-subscription:'})).values())if(sub.chat===chat&&(sub.writer_id??sub.id)===writer!.id)ids.add(sub.id);
      if(current){delete current.writer;cancelledReview=await this.cancelPendingReview(tx,current);}
      await tx.delete(writerKey(chat));await tx.delete(subscriptionKey(chat));await eraseSubscriptionHandoffs(tx,chat);
    }
    if(current?.active&&ids.has(current.active))delete current.active;
    if(ending)await this.parkGoal(tx,chat);
    else if(current&&!current.active)await this.pauseQueuedGoal(tx,chat);
    const summary=await tx.get<Subscription>(subscriptionKey(chat));if(summary&&ids.has(summary.id))await tx.delete(subscriptionKey(chat));
    if(current)await this.recordChange(tx,current,[],cancelledReview);
    for(const endpoint of ids){await tx.delete(subKey(endpoint));await this.expiry(tx,'subscription',endpoint);}
    for(const seq of (await tx.list<number>({prefix:'chat-pending:'+chat+':'})).values()){
      const event=await tx.get<Outbox>(outboxKey(chat,seq));if(event&&ids.has(event.subscription)){event.state='paused';await this.saveEvent(tx,event);if(current)await this.recordChange(tx,current,[seq]);}
    }
  }
  private async release(chat:string,id:string,expiresAt?:number):Promise<void>{
    const released=await this.store.transaction(async tx=>{
      if(expiresAt!==undefined){const sub=await tx.get<Subscription>(subKey(id));if(!sub||sub.expires_at!==expiresAt||expiresAt>Date.now())return false;}
      await this.releaseIn(tx,chat,id,expiresAt===undefined);return true;
    });if(released)this.background(()=>this.changed(chat));
  }
  async revoke(account:string,device?:string):Promise<void>{
    await this.initialize();
    for(const writer of (await this.store.list<Writer>({prefix:'chat-writer:'})).values()){
      const chat=await this.store.get<Conversation>(key(writer.chat));if(writer.account===account&&(!device||chat?.device===device))await this.release(writer.chat,writer.id);
    }
    if(!device){
      await this.store.transaction(async tx=>{
        for(const [k,sub] of await tx.list<ChannelSubscription>({prefix:'chat-channel-sub:'}))if(sub.account===account){
          await tx.delete(k);await this.expiry(tx,'channel',sub.id);
        }
        for(const job of (await tx.list<ChannelOutbox>({prefix:'chat-channel-outbox:'})).values())if(job.account===account){
          await this.deleteChannelOutbox(tx,job.chat,job.subscription);
        }
        await tx.delete(channelDiagnosticsKey(account));
      });
    }
  }
  private async channelEvents(method:'subscribe'|'unsubscribe',args:Data,actor:Actor,caller:string):Promise<Data>{
    if(args.delivery?.mode!=='webhook')throw fail('invalid_event','只支持 chat.channel 的 webhook 订阅');
    const input=args.arguments??{};
    if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>0)throw fail('invalid_event','chat.channel 为插件级订阅，不需要额外参数');
    const url=parseWebhookUrl(args.delivery.url);
    if(method==='unsubscribe'){
      await this.store.transaction(async tx=>{
        for(const [k,sub] of await tx.list<ChannelSubscription>({prefix:'chat-channel-sub:'})){
          if(sub.account===actor.id&&sub.epoch===actor.epoch&&sub.caller===caller&&sub.url===url){
            await tx.delete(k);await this.expiry(tx,'channel',sub.id);
          }
        }
      });
      return {};
    }
    const signingKey=parseSigningKey(args.delivery.secret);
    const existingList=[...(await this.store.list<ChannelSubscription>({prefix:'chat-channel-sub:'})).values()];
    const existing=existingList.find(s=>s.account===actor.id&&s.epoch===actor.epoch&&s.url===url);
    const id=existing?.id??'ch'+secret();
    const ttl=args.ttlMs===null?null:args.ttlMs===undefined?86_400_000:integer(args.ttlMs,'ttlMs',1);
    const expires_at=ttl===null?null:Date.now()+ttl;
    if(!existing||existing.secret!==signingKey||existing.verified_at<Date.now()-300_000)await this.verify(url,signingKey,id,undefined,{account:actor.id,subscription_id:id});
    await this.store.transaction(async tx=>{
      const currentActor=await tx.get<Actor>('account:'+actor.id);
      if(!currentActor||!(currentActor as Data).enabled||currentActor.epoch!==actor.epoch)throw fail('account_unavailable','账号已失效，请重新登录');
      const live=[...(await tx.list<ChannelSubscription>({prefix:'chat-channel-sub:'})).values()].find(s=>s.account===actor.id&&s.epoch===actor.epoch&&s.url===url);
      const targetId=live?.id??id,stamp=now();
      const sub:ChannelSubscription={id:targetId,account:actor.id,epoch:actor.epoch,caller,url,secret:signingKey,expires_at,verified_at:Date.now(),created_at:live?.created_at??stamp,updated_at:stamp};
      if(live&&live.secret!==signingKey){sub.previous_secret=live.secret;sub.rotation_until=Date.now()+60_000;}
      else if(live?.rotation_until&&live.rotation_until>Date.now()){sub.previous_secret=live.previous_secret;sub.rotation_until=live.rotation_until;}
      await tx.put(channelSubKey(targetId),sub);
      await this.expiry(tx,'channel',targetId,expires_at);
      if(expires_at!==null)await tx.requestAlarm?.(expires_at);
    });
    return {id,refreshBefore:expires_at===null?null:new Date(expires_at).toISOString(),cursor:null,truncated:false};
  }
  private async activeChannelSubs(device?:string,accountFilter?:string,epochFilter?:number):Promise<ChannelSubscription[]>{
    const rows=[...(await this.store.list<ChannelSubscription>({prefix:'chat-channel-sub:'})).values()];
    const nowMs=Date.now(),result:ChannelSubscription[]=[];
    for(const sub of rows){
      if(sub.expires_at!==null&&sub.expires_at<=nowMs)continue;
      if(accountFilter!==undefined&&sub.account!==accountFilter)continue;
      if(epochFilter!==undefined&&sub.epoch!==epochFilter)continue;
      const owner=await this.store.get<Actor & {enabled:boolean}>('account:'+sub.account);
      if(!owner?.enabled||owner.epoch!==sub.epoch)continue;
      if(device!==undefined){
        try{await this.accounts.assertAccessIn(this.store,owner,device);}
        catch(error){if(['account_unavailable','device_forbidden','device_missing'].includes((error as Data).code))continue;throw error;}
      }
      result.push(sub);
    }
    return result;
  }
  private channelGoalSatisfied(command:ChannelAction,chat?:Conversation):boolean{
    if(command==='delete'||!chat)return false;
    return command==='connect'?!!chat.active:!chat.active;
  }
  private async saveChannelOutbox(tx:KeyStore,job:ChannelOutbox):Promise<void>{
    const old=await tx.get<ChannelOutbox>(channelOutboxKey(job.chat,job.subscription));
    if(old&&old.next_at!==job.next_at)await tx.delete(channelDueKey(old.next_at,old.chat,old.subscription));
    await tx.put({[channelOutboxKey(job.chat,job.subscription)]:job,[channelDueKey(job.next_at,job.chat,job.subscription)]:{chat:job.chat,subscription:job.subscription,at:job.next_at}});
    await tx.requestAlarm?.(job.next_at);
  }
  private async deleteChannelOutbox(tx:KeyStore,chat:string,subscription:string):Promise<void>{
    const old=await tx.get<ChannelOutbox>(channelOutboxKey(chat,subscription));
    if(!old)return;
    await tx.delete([channelOutboxKey(chat,subscription),channelDueKey(old.next_at,chat,subscription)]);
  }
  private async clearChatChannelOutbox(tx:KeyStore,chat:string):Promise<void>{
    const jobs=[...(await tx.list<ChannelOutbox>({prefix:'chat-channel-outbox:'+chat+':'})).values()];
    for(const job of jobs)await tx.delete([channelOutboxKey(job.chat,job.subscription),channelDueKey(job.next_at,job.chat,job.subscription)]);
  }
  private channelPayload(command:ChannelAction,chat:Conversation,deviceName:string,source:'web'|'tui',eventId:string,requestedAt:string):Data{
    const mode=chatMode(chat.mode);
    return {
      eventId,
      name:channelEventDefinition.name,
      timestamp:requestedAt,
      data:{
        action:command,chat_id:chat.id,device_id:chat.device_id,device_name:deviceName,
        title:chat.title,mode,...modeRepository(mode,chat.repository),
        source,requested_at:requestedAt,url:this.env.publicUrl+'/chat?id='+chat.id,
        ...(command==='delete'?{instructions:channelDeleteInstructions}:{}),
      },
      cursor:null,
    };
  }
  private parseRetryAfterMs(response:Response):number{
    const retry=response.headers.get('retry-after');
    if(!retry)return 0;
    const seconds=Number(retry);
    const ms=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry)-Date.now())||0;
    return Math.min(ms,60_000);
  }
  private async dispatchChannelAttempt(sub:ChannelSubscription,payload:Data,command:ChannelAction,chatId:string,attempt:number):Promise<
    {kind:'ok';sub:ChannelSubscription}
    |{kind:'gone';sub:ChannelSubscription;diag:ChannelDiagnostic}
    |{kind:'failed';sub:ChannelSubscription;retryable:boolean;retryAfter:number;diag:ChannelDiagnostic}
  >{
    try{
      const response=await this.signed(sub,payload);
      if(response.ok){await response.body?.cancel();return {kind:'ok',sub};}
      if(response.status===410){
        await response.body?.cancel();
        return {kind:'gone',sub,diag:{at:now(),phase:'delivery',action:command,chat_id:chatId,subscription_id:sub.id,status:410,category:'gone_removed',attempt,retry_scheduled:false}};
      }
      const failure=await callbackFailure(response);
      const retryable=isChannelRetryable(failure.status,failure.category);
      return {kind:'failed',sub,retryable,retryAfter:this.parseRetryAfterMs(response),diag:{at:now(),phase:'delivery',action:command,chat_id:chatId,subscription_id:sub.id,...failure,attempt}};
    }catch(error){
      const failure=classifyChannelError(error);
      const retryable=isChannelRetryable(failure.status,failure.category);
      return {kind:'failed',sub,retryable,retryAfter:0,diag:{at:now(),phase:'delivery',action:command,chat_id:chatId,subscription_id:sub.id,...failure,attempt}};
    }
  }
  private async notifyChannel(command:ChannelAction,chat:Conversation,actor:ChatPrincipal,source:'web'|'tui'):Promise<Data>{
    const identity=normalizeIdentity(actor),diagScope=principalScope(actor),isDelete=command==='delete';
    const targets=await this.activeChannelSubs(chat.device,identity.kind==='account'?identity.actor.id:undefined,identity.kind==='account'?identity.actor.epoch:undefined);
    const stamp=now();
    const sequence=await this.store.transaction(async tx=>{
      const seq=await this.next(tx,'channel-seq:'+chat.id);
      await this.clearChatChannelOutbox(tx,chat.id);
      const liveChat=isDelete?undefined:await tx.get<Conversation>(key(chat.id));
      if(!targets.length){
        const diag:ChannelDiagnostic={at:stamp,phase:'delivery',action:command,chat_id:chat.id,status:0,category:'unconfigured',attempt:0,retry_scheduled:false};
        await recordChannelDiagnostic(tx,diagScope,diag);
        if(liveChat)await tx.put(channelCommandKey(chat.id),{action:command,chat_id:chat.id,state:'unconfigured',active:0,delivered:0,failed:0,retrying:0,sequence:seq,updated_at:stamp,last_error:diag} satisfies ChannelCommandSummary);
      }else if(liveChat){
        await tx.put(channelCommandKey(chat.id),{action:command,chat_id:chat.id,state:'retrying',active:targets.length,delivered:0,failed:0,retrying:0,sequence:seq,updated_at:stamp} satisfies ChannelCommandSummary);
      }
      return seq;
    });
    if(!targets.length)return {state:'unconfigured',active:0,delivered:0,failed:0,retrying:0,sequence};
    const device=await this.deviceView(chat.device,actor);
    const payload=this.channelPayload(command,chat,device.name,source,'ch-'+chat.id+'-c'+sequence,stamp);
    const results=await Promise.all(targets.map(sub=>this.dispatchChannelAttempt(sub,payload,command,chat.id,1)));
    let earliestAlarm:number|undefined;
    const outcome=await this.store.transaction(async tx=>{
      const liveChat=isDelete?undefined:await tx.get<Conversation>(key(chat.id));
      const cmd=isDelete?undefined:await tx.get<ChannelCommandSummary>(channelCommandKey(chat.id));
      if(!isDelete&&(!liveChat||cmd?.sequence!==sequence)){
        return {state:'notified' as const,active:targets.length,delivered:0,failed:0,retrying:0,sequence};
      }
      const goalNow=this.channelGoalSatisfied(command,liveChat);
      let delivered=0,failed=0,gone=0,retrying=0;
      let lastError:ChannelDiagnostic|undefined;
      for(const r of results){
        if(r.kind==='ok'){delivered++;continue;}
        if(r.kind==='gone'){
          gone++;failed++;lastError=r.diag;
          const liveSub=await tx.get<ChannelSubscription>(channelSubKey(r.sub.id));
          if(liveSub&&liveSub.url===r.sub.url){await tx.delete(channelSubKey(r.sub.id));await this.expiry(tx,'channel',r.sub.id);}
          await recordChannelDiagnostic(tx,r.sub.account,r.diag);
          continue;
        }
        failed++;
        const liveSub=await tx.get<ChannelSubscription>(channelSubKey(r.sub.id));
        const subAlive=!!liveSub&&(liveSub.expires_at===null||liveSub.expires_at>Date.now());
        const canRetry=r.retryable&&subAlive&&!goalNow;
        const diag:ChannelDiagnostic={...r.diag,retry_scheduled:canRetry};
        lastError=diag;
        await recordChannelDiagnostic(tx,r.sub.account,diag);
        if(canRetry){
          const delay=CHANNEL_RETRY_DELAYS[0];
          const nextAt=Date.now()+Math.max(delay,r.retryAfter);
          await this.saveChannelOutbox(tx,{
            chat:chat.id,subscription:r.sub.id,action:command,source,
            account:r.sub.account,epoch:r.sub.epoch,sequence,attempts:1,
            next_at:nextAt,created_at:stamp,updated_at:now(),last_error:diag,
            ...(isDelete?{device:chat.device,payload}:{}),
          });
          retrying++;
          earliestAlarm=earliestAlarm===undefined?nextAt:Math.min(earliestAlarm,nextAt);
        }
      }
      const active=targets.length-gone;
      const state=delivered>0||goalNow?'notified':retrying>0?'retrying':active===0?'unconfigured':'failed';
      const summary:ChannelCommandSummary={
        action:command,chat_id:chat.id,state,active,delivered,failed,retrying,sequence,updated_at:now(),
        ...(delivered===0&&!goalNow&&lastError?{last_error:lastError}:{}),
      };
      if(!isDelete)await tx.put(channelCommandKey(chat.id),summary);
      return {state,active,delivered,failed,retrying,sequence,...(summary.last_error?{last_error:summary.last_error}:{})};
    });
    if(earliestAlarm!==undefined)await this.env.schedule(earliestAlarm);
    return outcome;
  }
  private async pumpChannelOutbox():Promise<void>{
    const dueEntries=[...(await this.store.list<{chat:string;subscription:string;at:number}>({prefix:'chat-channel-due:',endBefore:'chat-channel-due:'+padded(Date.now()+1),limit:50})).entries()];
    if(!dueEntries.length)return;
    const chatsToNotify=new Set<string>();
    for(const [dueK,dueVal] of dueEntries){
      const claimed=await this.store.transaction(async tx=>{
        const job=await tx.get<ChannelOutbox>(channelOutboxKey(dueVal.chat,dueVal.subscription));
        if(!job||job.next_at!==dueVal.at){await tx.delete(dueK);return null;}
        const isDelete=job.action==='delete';
        const liveChat=isDelete?undefined:await tx.get<Conversation>(key(job.chat));
        const cmd=isDelete?undefined:await tx.get<ChannelCommandSummary>(channelCommandKey(job.chat));
        if(isDelete){
          if(!job.payload||!job.device){await this.deleteChannelOutbox(tx,job.chat,job.subscription);return null;}
        }else{
          if(!liveChat||cmd?.sequence!==job.sequence){await this.deleteChannelOutbox(tx,job.chat,job.subscription);return null;}
          if(this.channelGoalSatisfied(job.action,liveChat)){
            await this.deleteChannelOutbox(tx,job.chat,job.subscription);
            if(cmd){
              const retrying=Math.max(0,cmd.retrying-1);
              const updated:ChannelCommandSummary={...cmd,retrying,state:retrying>0?'retrying':'notified',updated_at:now()};
              if(updated.state==='notified')delete updated.last_error;
              await tx.put(channelCommandKey(job.chat),updated);
              chatsToNotify.add(job.chat);
            }
            return null;
          }
        }
        const sub=await tx.get<ChannelSubscription>(channelSubKey(job.subscription));
        const owner=sub?await tx.get<Actor & {enabled?:boolean}>('account:'+sub.account):undefined;
        let accessible=!!sub&&!!owner?.enabled&&sub.epoch===owner.epoch&&(sub.expires_at===null||sub.expires_at>Date.now());
        if(accessible){
          try{await this.accounts.assertAccessIn(tx,owner!,isDelete?job.device!:liveChat!.device);}
          catch{accessible=false;}
        }
        if(!accessible){
          await this.deleteChannelOutbox(tx,job.chat,job.subscription);
          if(!isDelete&&cmd){
            const retrying=Math.max(0,cmd.retrying-1),active=Math.max(0,cmd.active-1);
            const state=cmd.delivered>0?'notified':retrying>0?'retrying':active===0?'unconfigured':'failed';
            await tx.put(channelCommandKey(job.chat),{...cmd,retrying,active,state,updated_at:now()});
            chatsToNotify.add(job.chat);
          }
          return null;
        }
        const leased={...job,next_at:Date.now()+20_000};
        await this.saveChannelOutbox(tx,leased);
        return {job:leased,chat:liveChat,sub:sub!,owner:owner!};
      });
      if(!claimed)continue;
      const {job,chat,sub,owner}=claimed;
      const isDelete=job.action==='delete';
      let payload:Data;
      if(isDelete){
        payload=job.payload!;
      }else{
        let deviceName=chat!.device_id;
        try{deviceName=(await this.env.device(chat!.device,owner)).name;}catch{}
        payload=this.channelPayload(job.action,chat!,deviceName,job.source,'ch-'+chat!.id+'-c'+job.sequence,job.created_at);
      }
      const result=await this.dispatchChannelAttempt(sub,payload,job.action,job.chat,job.attempts+1);
      await this.store.transaction(async tx=>{
        const liveChat=isDelete?undefined:await tx.get<Conversation>(key(job.chat));
        const cmd=isDelete?undefined:await tx.get<ChannelCommandSummary>(channelCommandKey(job.chat));
        const liveJob=await tx.get<ChannelOutbox>(channelOutboxKey(job.chat,job.subscription));
        if(!liveJob||liveJob.sequence!==job.sequence||(!isDelete&&(!liveChat||!cmd))){await this.deleteChannelOutbox(tx,job.chat,job.subscription);return;}
        if(result.kind==='ok'){
          await this.deleteChannelOutbox(tx,job.chat,job.subscription);
          if(!isDelete&&cmd){
            const delivered=cmd.delivered+1,failed=Math.max(0,cmd.failed-1),retrying=Math.max(0,cmd.retrying-1);
            const updated:ChannelCommandSummary={...cmd,delivered,failed,retrying,state:'notified',updated_at:now()};
            delete updated.last_error;
            await tx.put(channelCommandKey(job.chat),updated);
            chatsToNotify.add(job.chat);
          }
          return;
        }
        if(result.kind==='gone'){
          await this.deleteChannelOutbox(tx,job.chat,job.subscription);
          const liveSub=await tx.get<ChannelSubscription>(channelSubKey(sub.id));
          if(liveSub&&liveSub.url===sub.url){await tx.delete(channelSubKey(sub.id));await this.expiry(tx,'channel',sub.id);}
          await recordChannelDiagnostic(tx,sub.account,result.diag);
          if(!isDelete&&cmd){
            const retrying=Math.max(0,cmd.retrying-1),active=Math.max(0,cmd.active-1);
            const state=cmd.delivered>0?'notified':retrying>0?'retrying':active===0?'unconfigured':'failed';
            await tx.put(channelCommandKey(job.chat),{...cmd,retrying,active,state,updated_at:now(),...(cmd.delivered===0?{last_error:result.diag}:{})});
            chatsToNotify.add(job.chat);
          }
          return;
        }
        const goalNow=this.channelGoalSatisfied(job.action,liveChat);
        const canRetry=result.retryable&&!goalNow&&job.attempts<CHANNEL_RETRY_DELAYS.length;
        const diag:ChannelDiagnostic={...result.diag,retry_scheduled:canRetry};
        await recordChannelDiagnostic(tx,sub.account,diag);
        if(canRetry){
          const delay=CHANNEL_RETRY_DELAYS[job.attempts];
          const nextAt=Date.now()+Math.max(delay,result.retryAfter);
          await this.saveChannelOutbox(tx,{...liveJob,attempts:job.attempts+1,next_at:nextAt,updated_at:now(),last_error:diag});
          if(!isDelete&&cmd)await tx.put(channelCommandKey(job.chat),{...cmd,updated_at:now(),...(cmd.delivered===0?{last_error:diag}:{})});
        }else{
          await this.deleteChannelOutbox(tx,job.chat,job.subscription);
          if(!isDelete&&cmd){
            const retrying=Math.max(0,cmd.retrying-1);
            const state=goalNow||cmd.delivered>0?'notified':retrying>0?'retrying':cmd.active===0?'unconfigured':'failed';
            const updated:ChannelCommandSummary={...cmd,retrying,state,updated_at:now(),...(!goalNow&&cmd.delivered===0?{last_error:diag}:{})};
            if(goalNow||cmd.delivered>0)delete updated.last_error;
            await tx.put(channelCommandKey(job.chat),updated);
          }
        }
        if(!isDelete)chatsToNotify.add(job.chat);
      });
    }
    if(chatsToNotify.size)await Promise.all([...chatsToNotify].map(id=>this.changed(id)));
  }
  async channelControl(command:'connect'|'disconnect',args:Data,actor:ChatPrincipal):Promise<Data>{
    await validateIdentity(this.accounts,this.store,actor);await this.initialize();
    let chat=await this.chat(textValue(args.chat_id,'chat_id'),actor);
    const source=args.source==='tui'?'tui':'web';
    if(command==='connect'&&chat.writer&&!chat.active){
      await this.store.transaction(async tx=>{
        await this.access(actor,chat.device,tx);
        const current=await tx.get<Conversation>(key(chat.id));
        if(current&&current.writer&&!current.active){current.reconnect_until=Date.now()+300_000;await tx.put(key(current.id),current);}
      });
    }
    const channel=await this.notifyChannel(command,chat,actor,source);
    chat=await this.chat(chat.id,actor);
    return {chat:await this.summary(chat,actor),channel};
  }
  private async safeCursor(tx:KeyStore,chat:string,subscription:string,sequence:number):Promise<number>{
    const first=[...(await tx.list<number>({prefix:'chat-unack:'+chat+':'+subscription+':',endBefore:unackKey(chat,subscription,sequence),limit:1})).values()][0];
    return first===undefined?sequence:first-1;
  }
  private async prepareDeliveryEnvelope(chat:Conversation,message:Message,sub:Subscription,actor:Actor,sequence:number,safeCursor:number):Promise<{message:Message;envelope:Data;blocked:boolean}>{
    try{
      let context=await this.context(chat,{message_id:message.id},true);
      let fit=fitContextToEnvelope(context as ChatContext,c=>this.eventEnvelope(chat,message,c,sub.event_connection,safeCursor));
      if((fit.requires_attachment||context?.current_message.text_truncated)&&message.text){
        // A concurrent send or metadata change may move the exact serialized boundary.
        // Preserve the original bytes in the same attachment lifecycle, never truncate them.
        const original=message.text,body=await this.textAttachment(chat,original,'saved:'+chat.id+':'+message.id,actor);
        message=await this.store.transaction(async tx=>{
          await this.access(actor,chat.device,tx);
          const current=await tx.get<Message>(messageKey(chat.id,sequence)),conversation=await tx.get<Conversation>(key(chat.id));
          if(!current||!conversation)throw fail('chat_deleted','对话已删除');
          if(current.text===original){current.text='';current.attachments=[...current.attachments,body];await tx.put(messageKey(chat.id,sequence),current);await this.recordChange(tx,conversation,[sequence]);}
          return current;
        });
        context=await this.context(chat,{message_id:message.id},true);
        fit=fitContextToEnvelope(context as ChatContext,c=>this.eventEnvelope(chat,message,c,sub.event_connection,safeCursor));
      }
      return {message,envelope:fit.envelope,blocked:fit.requires_attachment};
    }catch(error){
      if((error as Data).code==='context_metadata_too_large')return {message,envelope:{},blocked:true};
      throw error;
    }
  }
  private async deliver(event:Outbox):Promise<void>{
    const sub=await this.store.get<Subscription>(subKey(event.subscription));
    if(!sub){await this.store.transaction(async tx=>{const old=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));if(old?.state==='pending'&&old.subscription===event.subscription){old.state='paused';await this.saveEvent(tx,old);}});return;}
    let chat:Conversation,actor:Actor;
    try{actor=await this.accounts.require(sub.account,sub.epoch);chat=await this.chat(sub.chat,actor);if(chat.active!==sub.id)return;}
    catch(error){if(['account_unavailable','device_forbidden','device_missing','chat_not_found'].includes((error as Data).code)){await this.release(sub.chat,sub.id);return;}throw error;}
    let message=await this.store.get<Message>(messageKey(event.chat,event.sequence));
    if(!message){await this.store.transaction(tx=>this.dropEvent(tx,event));return;}
    if(chatMode(chat.mode)==='chat'&&(await processingRecord(this.store,chat.id,message)).state==='resolved'){
      await this.store.transaction(tx=>this.resolveNotification(tx,chat.id,event.sequence));return;
    }
    const claimed=await this.store.transaction(async tx=>{
      const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence));if(!current||current.subscription!==sub.id||current.state!=='pending'||current.next_at>Date.now())return false;
      current.next_at=Date.now()+20_000;await this.saveEvent(tx,current);
      const t=await tx.get<Timing>(timingKey(event.chat,event.sequence))??{saved_at:message!.created_at,attempts:0};t.first_attempt_at??=now();t.attempts++;
      await tx.put(timingKey(event.chat,event.sequence),t);return true;
    });if(!claimed)return;
    const safeCursor=await this.safeCursor(this.store,chat.id,sub.id,message.sequence);
    const {message:prepared,envelope,blocked}=await this.prepareDeliveryEnvelope(chat,message,sub,actor,event.sequence,safeCursor);
    message=prepared;
    if(blocked){
      await this.store.transaction(async tx=>{const current=await tx.get<Outbox>(outboxKey(chat.id,event.sequence));
        if(current?.state==='pending'&&current.subscription===sub.id){current.state='blocked';current.error='event_too_large';await this.saveEvent(tx,current);}
        const currentChat=await tx.get<Conversation>(key(chat.id));if(currentChat)await this.recordChange(tx,currentChat,[event.sequence]);});
      this.background(()=>this.changed(chat.id));return;
    }
    if(jsonBytes(envelope)>CHAT_EVENT_BYTES)throw fail('event_too_large','事件超过宿主上限');
    // Processing may have completed while context/attachment preparation was awaiting.
    // Never start a fresh callback for an explicitly resolved input. An already-sent
    // callback cannot be recalled; the stable event ID and ledger remain its evidence.
    const stillPending=await this.store.transaction(async tx=>{
      const current=await tx.get<Outbox>(outboxKey(chat.id,event.sequence));
      if(!current||current.subscription!==sub.id||current.state!=='pending')return false;
      if(message!.approval_origin){
        const live=await tx.get<Conversation>(key(chat.id));
        const route=await tx.get<Subscription>(subKey(sub.id));
        if(!route||live?.writer!==message!.approval_origin.writerId||!this.approvalNoticeMatches(message!.approval_origin,route)){
          await this.resolveNotification(tx,chat.id,event.sequence);return false;
        }
      }
      if(chatMode(chat.mode)==='chat'&&(await processingRecord(tx,chat.id,message!)).state==='resolved'){
        await this.resolveNotification(tx,chat.id,event.sequence);return false;
      }
      return beginRouteDelivery(tx,this.handoffPort(),chat.id,'chat.message',sub.id,String(envelope.eventId));
    });if(!stillPending)return;
    let status=0,error:string|undefined,retryAfter=0,category:CallbackCategory|undefined;
    try{
      const response=await this.signed(sub,envelope,value=>{category=value;});status=response.status;
      const retry=response.headers.get('retry-after');if(retry){const seconds=Number(retry);retryAfter=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry)-Date.now())||0;}
      await response.body?.cancel();
    }catch(e){error=(e as Data).code==='invalid_callback'?'callback_address':'network';}
    await this.store.transaction(async tx=>finishRouteDelivery(tx,stillPending,async()=>{
      const current=await tx.get<Outbox>(outboxKey(event.chat,event.sequence)),live=await tx.get<Subscription>(subKey(sub.id)),c=await tx.get<Conversation>(key(event.chat));
      if(!current||current.subscription!==sub.id||!live||c?.active!==sub.id)return;
      if(current.state!=='pending'&&!(current.state==='resolved'&&status>=200&&status<300))return;
      current.attempts++;
      if(status>=200&&status<300){
        current.state='delivered';current.received_at=now();delete current.error;
        await this.saveEvent(tx,current);live.cursor=await this.safeCursor(tx,event.chat,sub.id,event.sequence);
        const t=await tx.get<Timing>(timingKey(event.chat,event.sequence));if(t){t.host_accepted_at??=current.received_at;await tx.put(timingKey(event.chat,event.sequence),t);}await tx.put(subKey(sub.id),live);
      }else if(status===410){current.state='paused';current.error='callback_gone';await this.saveEvent(tx,current);await this.releaseIn(tx,chat.id,sub.id,false);}
      else if(status===403&&chatMode(c.mode)==='chat'&&message!.role==='user'&&!message!.approval_id&&
        (category==='http_rejected'||category==='edge_challenge')){
        const attempt=current.transient_403_attempts??0,delay=MESSAGE_403_RETRY_DELAYS[attempt];
        current.transient_403_attempts=attempt+1;current.error='http_403';
        if(delay===undefined)current.state='failed';
        else current.next_at=Date.now()+Math.max(delay,retryAfter);
        await this.saveEvent(tx,current);
      }
      else if(status===413||status>=400&&status<500&&status!==408&&status!==429||error==='callback_address'){
        current.state='blocked';current.error=status?'http_'+status:error;await this.saveEvent(tx,current);
      }else{
        const delay=[30_000,60_000,120_000][current.attempts-1]??300_000;
        current.next_at=Date.now()+Math.max(delay,retryAfter);current.error=status?'http_'+status:error;await this.saveEvent(tx,current);
      }
      // releaseIn may have updated c; retain that subscription state while recording the receipt.
      const latest=await tx.get<Conversation>(key(chat.id));if(latest)await this.recordChange(tx,latest,[event.sequence]);
    },status>=200&&status<300?'accepted':status>=400&&status<500&&status!==408?'not_accepted':'uncertain'));
    this.background(()=>this.changed(chat.id));
  }
  private approvalNoticeMatches(origin:ApprovalOrigin,subscription:Subscription):boolean{
    return origin.chatId===subscription.chat&&origin.writerId===(subscription.writer_id??subscription.id)&&
      origin.account===subscription.account&&origin.epoch===subscription.epoch&&origin.caller===subscription.caller;
  }
  private drain():Promise<void>{
    if(this.pumping)return this.pumping;
    this.pumping=this.pump().finally(()=>{this.pumping=undefined;this.wake=undefined;});return this.pumping;
  }
  private drainCollaboration():Promise<void>{
    if(this.collaborationPumping)return this.collaborationPumping;
    this.collaborationPumping=this.pumpCollaboration().finally(()=>{this.collaborationPumping=undefined;});
    return this.collaborationPumping;
  }

  private async pumpCollaboration():Promise<void>{
    const due=[...(await this.store.list<CollaborationWake>({prefix:collaborationWakePrefix})).entries()]
      .filter(([,wake])=>wake.next_at!==null&&wake.next_at<=Date.now());
    for(const [keyName,entry] of due){
      const job=await this.store.transaction(async tx=>{
        const wake=await tx.get<CollaborationWake>(keyName);
        if(!wake||wake.next_at!==entry.next_at)return;
        const chat=await tx.get<Conversation>(key(wake.chat));
        if(!chat){await tx.delete(keyName);return;}
        const goal=wake.kind==='goal_round'?await tx.get<GoalRecord>(goalKey(chat.id)):undefined;
        const review=wake.kind==='plan_review'?await tx.get<PlanReview>(reviewKey(chat.id,wake.ref)):undefined;
        const round=goal?.round;
        if(wake.kind==='goal_round'&&(!goal?.armed||round?.id!==wake.ref||round.state!=='queued'||chat.interaction_mode==='plan')||
          wake.kind==='plan_review'&&(!review?.decision||review.continued_by||review.writer!==chat.writer||chat.plan_review_id!==review.id||
          (chat.interaction_revision??0)!==review.mode_revision+(review.decision==='reject'?0:1))){
          await tx.delete(keyName);return;
        }
        if(!chat.active||!chat.writer){await tx.put(keyName,{...wake,next_at:null});return;}
        const sub=await tx.get<Subscription>(subKey(chat.active));
        if(!await this.validSubscription(tx,sub,chat.device)||(sub!.writer_id??sub!.id)!==chat.writer){await tx.put(keyName,{...wake,next_at:null});return;}
        if(wake.kind==='goal_round'&&goal?.writer!==chat.writer){await this.parkGoal(tx,chat.id);await this.recordChange(tx,chat);return;}
        wake.attempts++;wake.next_at=Date.now()+20_000;
        await tx.put(keyName,wake);await tx.requestAlarm?.(wake.next_at);
        return {wake,chat,sub:sub!,round,review};
      });
      if(!job)continue;
      const {wake,chat,sub,round,review}=job;
      let status=0,category:CallbackCategory|undefined,retryAfter=0;
      try{
        const response=await this.signed(sub,{
          eventId:chat.id+'-'+wake.id,name:chatEventDefinition.name,timestamp:now(),cursor:null,
          data:{kind:wake.kind,chat_id:chat.id,device_id:chat.device_id,connection:sub.event_connection,
            mode:'chat',interaction_mode:chat.interaction_mode??'normal',interaction_revision:chat.interaction_revision??0,
            url:this.env.publicUrl+'/chat?id='+chat.id,
            ...(round?{round_id:round.id,goal_id:round.goal_id,goal_revision:round.revision,round:round.number}:{review_id:review!.id}),
            processing:round?'Call chat.goal claim with this goal, revision and round before any work. Only act if claimed is true. Use its context source for bound tool calls and settle the round after verifying results.'
              :'Call chat.plan continue with this review_id before acting; only act if claimed is true. Follow the returned decision and reason. After implementing an approved plan, call chat.plan finish.',
          }},value=>{category=value;});
        status=response.status;retryAfter=this.parseRetryAfterMs(response);await response.body?.cancel();
      }catch{/* A missing HTTP result leaves this wake retryable. */}
      await this.store.transaction(async tx=>{
        const live=await tx.get<CollaborationWake>(keyName);
        if(live?.attempts!==wake.attempts)return;
        if(status>=200&&status<300){await tx.delete(keyName);return;}
        const retry=status===0||isChannelRetryable(status,category??'http_rejected');
        const delay=MESSAGE_403_RETRY_DELAYS[wake.attempts-1];
        if(retry&&delay!==undefined){
          const next_at=Date.now()+Math.max(delay,retryAfter);await tx.put(keyName,{...live,next_at});await tx.requestAlarm?.(next_at);
        }else{
          await tx.delete(keyName);
          if(round){
            const current=await tx.get<Conversation>(key(chat.id)),goal=await tx.get<GoalRecord>(goalKey(chat.id));
            if(current&&goal?.round?.id===round.id&&goal.round.state==='queued'){
              changeGoal(goal,'block',{reason:{code:'wake-failed',message:'未能通知 Dot 开始目标轮次'}});
              await this.discardGoalRound(tx,chat.id,goal);await tx.put(goalKey(chat.id),goal);await this.recordChange(tx,current);
            }
          }
        }
      });
      await this.changed(chat.id);
    }
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
    const channelDue=[...(await this.store.list<Data>({prefix:'chat-channel-due:',limit:1})).values()][0]?.at;
    const maintenance=[...(await this.store.list<Maintenance>({prefix:'chat-maintenance:'})).values()].map(s=>s.next_at??undefined);
    const taskDue=[...(await this.store.list<Data>({prefix:'chat-super-agent-due:',limit:1})).values()][0]?.at;
    const taskWakes=[...(await this.store.list<Data>({prefix:'chat-super-agent-wake:'})).values()].map(w=>w.next_at);
    const collaboration=[...(await this.store.list<CollaborationWake>({prefix:collaborationWakePrefix})).values()].map(wake=>wake.next_at??undefined);
    const times=[head?.at,expiry?.at,channelDue,...maintenance,taskDue,...taskWakes,...collaboration].filter((v):v is number=>v!==undefined);return times.length?Math.min(...times):undefined;
  }
  private async cleanup():Promise<void>{
    for(const [k,s] of await this.store.list<{chat:string;id:string;expires_at:number}>({prefix:'chat-working-snapshot:'}))if(s.expires_at<=Date.now())await this.store.transaction(tx=>eraseWorkingSnapshot(tx,s.chat,s.id));
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
        else if(e.kind==='channel'){const sub=await tx.get<ChannelSubscription>(channelSubKey(e.id));if(sub&&sub.expires_at===e.at&&sub.expires_at<=Date.now())await tx.delete(channelSubKey(e.id));}
        await this.expiry(tx,e.kind,e.id);return blob;
      });
      if(removed&&this.env.blobs)await this.env.blobs.remove(removed.chat,removed.attachment);
    }
  }
  async alarm():Promise<void>{
    await this.initialize();
    // Start ready delivery before cleanup; attachment reclamation is not on the delivery path.
    await Promise.all([this.drain(),this.drainCollaboration(),this.pumpChannelOutbox(),this.cleanup(),this.maintenanceAlarm(),this.superAgentAlarm()]);const next=await this.nextAlarm();if(next!==undefined)await this.env.schedule(next);
  }
}

