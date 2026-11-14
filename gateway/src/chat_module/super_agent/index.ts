/** Original Super Agent domain/policy/effect rules with a model-reported Bridge host. */
import type {KeyStore} from '../../runtime';
import {principalScope,normalizeIdentity,type ChatIdentity} from '../../chat_identity';
import {Engine,key,latestAssignment,ticketStage,canRetry,threadKey,type Candidate,type DomainEvent,type OutboundMessage,type ReplyStatus,type Ticket,type Trigger,type SourceScope} from './vendor/src/core/index.ts';
import {SnapshotRepositories,emptyRecords,type Records} from './repository';
import {SettingsSchema,settingsPolicy,policyEffects,policyVersion,type Settings} from './upstream-policy';
import {PersistentEffects,PersistentOutbox,receiptStore,type EffectRecord} from './effect-runtime';
import {routeOriginal} from './upstream-route';
import {MasterAssessor,AssessmentSchema,EvalReadSchema} from './upstream-assessor';
import {textPage} from './assessment-host';
import {WorkerSlots} from './upstream-slots';
import {reportRelay,followupRelay,ticketCard} from './upstream-notices';
import {rolePrompt} from './role-prompt';
import {HOST_ACTIONS,MUTATING_ACTIONS,type SuperAgentScope,type SuperAgentMessage,type TaskRequest,type RepositoryBinding} from './types';
import * as legacy from './legacy';
export type {SuperAgentScope,SuperAgentMessage,TaskRequest,RepositoryBinding} from './types';
export {HOST_ACTIONS,MUTATING_ACTIONS} from './types';
export {superAgentTaskSpec} from './contracts';
export {normalizeRepositoryBinding as normalizeRepository} from '../repositories';
export const SUPER_AGENT_UPSTREAM=legacy.SUPER_AGENT_UPSTREAM;
const PREFIX='chat-super-agent:',PENDING_SNAPSHOT_BYTES=160_000,MAX_MESSAGE_BYTES=2*1024*1024;
const clone=<T>(v:T):T=>structuredClone(v);
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const utf8Bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
const required=(v:unknown,name:string,max=16000):string=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail('invalid_task_argument',`${name} 必须为非空文本（最多 ${max} 字符）`);return v.trim();};
interface Pending {messageId:string;text:string;at:string;attachments:unknown[];author:ChatIdentity;discussing?:string[];reason?:string;routed?:string}
interface Action {id:string;kind:string;payload:Record<string,any>;at:string;completed?:string}
interface State {
 version:2;chatId:string;deviceId:string;deniedActors:string[];repository:RepositoryBinding;settings:Settings;records:Records;
 pending:Record<string,Pending>;authorities:Record<string,ChatIdentity>;candidates:Record<string,Candidate>;
 activity:Record<string,'running'|'idle'|'stopped'>;effects:EffectRecord[];actions:Record<string,Action>;outbox:Record<string,{message:OutboundMessage;status:ReplyStatus;savedMessageId?:string}>;
 aliases:Record<string,string>;counter:number;selected?:string;seen:Record<string,{fingerprint:string;result:any}>;events:DomainEvent[];generation:number;
}
const empty=(scope:SuperAgentScope):State=>({version:2,deniedActors:[],chatId:scope.chatId,deviceId:scope.deviceId,repository:scope.repository??null,
 settings:SettingsSchema.parse({}),records:emptyRecords(),pending:{},authorities:{},candidates:{},activity:{},effects:[],actions:{},outbox:{},aliases:{},counter:0,seen:{},events:[],generation:0});
const triggerId=(chat:string,message:string)=>key('bridge-trigger',chat,message);
class Runtime {
 readonly repo:SnapshotRepositories;readonly engine:Engine;readonly effects:PersistentEffects;readonly outbox:PersistentOutbox;readonly assessor:MasterAssessor;
 readonly source:SourceScope;
 constructor(readonly state:State,readonly scope:SuperAgentScope,readonly at=new Date().toISOString(),send?: (m:OutboundMessage)=>Promise<'sent'|'gone'|'waiting'>){
  this.repo=new SnapshotRepositories(state.records);state.activity??={};const previousSettings=clone(state.settings);
  this.source={scope:input=>input.source==='computer-bridge'&&input.meta.chatId===scope.chatId&&input.meta.deviceId===scope.deviceId?{listened:true,observed:false,row:scope.chatId}:{listened:false,reason:'Wrong Bridge conversation'}};
  // Bridge authentication supplies the source's allowed senders; the upstream Policy still evaluates their mandates.
  state.deniedActors??=[];const identities=Object.values(state.authorities).map(principalScope).filter(actor=>!state.deniedActors.includes(actor));
  state.settings.policy.sources['computer-bridge']={allowed:[...new Set(identities)].map(id=>({id})),admission:{}};
  this.effects=new PersistentEffects(state.effects,()=>Date.parse(this.at));
  const atomic=<T>(body:()=>T)=>this.repo.atomic(body);
  this.outbox=new PersistentOutbox({store:receiptStore(state.outbox,state.effects,atomic),effects:this.effects,paused:()=>state.settings.paused||!send,commands:undefined,
   sources:{instance:()=>({enabled:!!send}),channelAllowed:c=>c.source==='computer-bridge'&&c.thread===scope.chatId&&c.address.chat_id===scope.chatId,
    send:async m=>send?send(m):'waiting'}});
  const issue=(kind:string,id:string,payload:Record<string,any>)=>{
   const previous=state.actions[id];
   if(previous&&!previous.completed&&JSON.stringify(previous.payload)===JSON.stringify(payload))return;
   state.actions[id]={id,kind,payload:clone(payload),at:this.at};state.generation++;
  };
  const self=this;
  const commands={withSignal:(_signal:AbortSignal)=>commands,readRepositoryPath:async (_path:string,_kind:'file'|'directory'):Promise<string>=>{throw fail('source_tool_required','Use the configured chat.repository or authorized computer tools for repository reads');}};
  this.assessor=new MasterAssessor({get engine(){return self.engine;},commands,deployment:{stateDir:'',admissionContextTimeoutMs:{get:()=>30000},admissionContextMaxPages:{get:()=>4}},effects:this.effects,settings:()=>state.settings,paused:()=>state.settings.paused,
   candidateCard:async c=>({eval_id:c.evalId,trigger_id:c.triggers[0]!.id,triggers:c.triggers,related_tickets:c.tickets.map(ticketCard)}),
   deliver:async(id,text)=>issue('assessment',id.replace(/^candidate:/,''),{text}),
   threadContext:trigger=>({messageId:String(trigger.meta.messageId),images:()=>[],image:async()=>{throw fail('attachment_tool_required','Read the original attachment through chat.attachment');},
    read:async(_commands,part,cursor)=>{const rows=Object.values(state.pending).sort((a,b)=>Number(a.messageId.slice(1))-Number(b.messageId.slice(1)));const selected=part==='thread'?rows:rows.filter(p=>p.messageId===trigger.meta.messageId),offset=cursor?Number(cursor):0;if(!Number.isSafeInteger(offset)||offset<0)throw fail('invalid_cursor','无效的来源游标');const page=selected.slice(offset,offset+50);return {messages:page.map(p=>({id:p.messageId,from:principalScope(p.author),at:p.at,text:p.text})),...(offset+50<selected.length?{next:String(offset+50)}:{}),body:{}};}})});
  this.effects.handle('launch',async ({ticketId,assignmentId})=>{const t=this.repo.tickets.get(ticketId);if(t&&!t.ended&&latestAssignment(t)?.id===assignmentId)this.authorized(t)&&issue('launch',assignmentId,{task_id:this.alias(ticketId),assignment_id:assignmentId});},{limit:()=>state.settings.paused?0:state.settings.executor.maxWorkers});
  this.effects.handle('delivery',async ({ticketId})=>{const t=this.repo.tickets.get(ticketId),a=t&&latestAssignment(t);if(t&&!t.ended&&a&&t.undelivered.length)this.authorized(t)&&issue('delivery','delivery:'+a.id,{task_id:this.alias(ticketId),assignment_id:a.id,input_ids:t.undelivered});},{limit:()=>state.settings.paused?0:1});
  this.effects.handle('relay',async ({text},id)=>issue('relay',id,{text}),{ordered:true,limit:()=>state.settings.paused?0:1});
  this.effects.handle('notice',async ({value,summary},id)=>issue('notice',id,{value,summary}),{ordered:true,limit:()=>state.settings.paused?0:1});
  this.engine=new Engine({repo:this.repo,now:()=>this.at,policy:()=>settingsPolicy(state.settings,this.source),scope:this.source,
   assessor:{request:c=>{state.candidates[c.evalId]=clone(c);this.assessor.request(c);},release:id=>{delete state.candidates[id];this.assessor.release(id);this.effects.cancel('assessment',id);this.done(id);}},
   executor:{start:(t,a)=>this.effects.enqueue('launch',a.id,{ticketId:t.id,assignmentId:a.id}),deliver:t=>this.effects.enqueue('delivery',t.id,{ticketId:t.id}),
    stop:(t,a,reason)=>{state.activity[a.id]='stopped';this.effects.cancel('launch',a.id);this.effects.cancel('delivery',t.id);this.done(a.id);this.done('delivery:'+a.id);issue('stop','stop:'+a.id,{task_id:this.alias(t.id),assignment_id:a.id,reason});}},
   outbox:this.outbox,emit:event=>{state.events.push(clone(event));state.generation++;if(state.events.length>1000)state.events.shift();}});
  const from=policyVersion(previousSettings),to=policyVersion(state.settings);if(from!==to)this.engine.policyChanged(from,to,policyEffects(this.repo.tickets.open(),previousSettings,state.settings,()=>this.source));
 }
 authorized(t:Ticket){return [t.origin.triggerId,...t.inputs.flatMap(i=>i.kind==='trigger'?[i.triggerId]:[])].every(id=>{const actor=this.state.authorities[id];return actor&&!this.state.deniedActors.includes(principalScope(actor));});}
 done(id:string){if(this.state.actions[id]&&!this.state.actions[id].completed){this.state.actions[id].completed=this.at;this.state.generation++;}}
 async settle(){this.engine.evaluateDue();this.effects.start();await this.effects.idle();await this.effects.drain();}
 nextDue():number|undefined {
  if(this.state.settings.paused)return undefined;
  const deadlines=this.repo.threads.active().flatMap(t=>t.evaluating?.delivered?[Date.parse(t.evaluating.deadline)]:[]);
  const effect=this.effects.nextDue();if(effect!==undefined)deadlines.push(effect);
  return deadlines.length?Math.min(...deadlines):undefined;
 }
 alias(id:string){for(const [a,v]of Object.entries(this.state.aliases))if(v===id)return a;const a='k'+ ++this.state.counter;this.state.aliases[a]=id;return a;}
 resolve(v:unknown){const id=required(v,'task_id',100),t=this.repo.tickets.get(this.state.aliases[id]??id);if(!t)throw fail('task_not_found','当前对话不存在该任务');return t;}
 view(t:Ticket){const a=latestAssignment(t);return {...ticketCard(t),task_id:this.alias(t.id),id:t.id,stage:ticketStage(t),authorization:this.authorized(t)?'available':'revoked',state:t.ended?.outcome??(a?.state==='pending'?'queued':a?.report?.state??a?.state??'queued'),
  assignment_id:a?.id??null,reported_activity:a?this.state.activity[a.id]??'not_reported':'not_reported',can_retry:canRetry(t),scope:t.mandate.scope,summary:a?.report?.summary??null,attention:t.attention?.question??null,pending_inputs:t.undelivered.length,created_at:t.createdAt,updated_at:t.updatedAt,
  origin_message_id:this.repo.triggers.get(t.origin.triggerId)?.meta.messageId??null};}
 private pendingSummary(p:Pending,includeText:boolean){
  const reads=this.attachmentReads(p);
  return {message_id:p.messageId,text:includeText?p.text:'',text_truncated:!includeText&&p.text.length>0,
    ...(reads.length?{attachment_reads:reads}:{}),discussing:p.discussing??null,at:p.at};
 }
 private pendingSnapshot(pending:Pending[]){
  const window=pending.slice(0,50);
  const items=window.map(p=>this.pendingSummary(p,false));
  let totalBytes=utf8Bytes(items);
  for(let i=window.length-1;i>=0;i--){
   if(!window[i]!.text.length)continue;
   const full=this.pendingSummary(window[i]!,true),delta=utf8Bytes(full)-utf8Bytes(items[i]!);
   if(totalBytes+delta<=PENDING_SNAPSHOT_BYTES){items[i]=full;totalBytes+=delta;}
  }
  return items;
 }
 snapshot(options:Pick<TaskRequest,'active_only'|'after'|'limit'>={}){
  const all=this.repo.tickets.list(),limit=options.limit??100,after=options.after??0;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(after)||after<0)throw fail('invalid_task_argument','分页参数无效');
  const tasks=all.filter(t=>(!options.active_only||!t.ended)&&Number(this.alias(t.id).slice(1))>after).sort((a,b)=>Number(this.alias(a.id).slice(1))-Number(this.alias(b.id).slice(1))),page=tasks.slice(0,limit);
  const pending=Object.values(this.state.pending).filter(p=>!p.routed);
  return {mode:'super_agent',runtime_version:2,upstream:SUPER_AGENT_UPSTREAM,paused:this.state.settings.paused,repository:this.state.repository,
   selected_task:this.state.selected?this.alias(this.state.selected):null,host:{execution:'model_reports',lifecycle:'self_reported',subagent_id_required:false,tool_priority:'none',instructions:{action:'instructions',role:'orchestrator'}},
   tasks:page.map(t=>this.view(t)),tasks_more:tasks.length>limit,tasks_cursor:tasks.length>limit?Number(this.alias(page.at(-1)!.id).slice(1)):null,tasks_total:all.length,
   task_counts:{total:all.length,active:all.filter(t=>!t.ended).length,ended:all.filter(t=>t.ended).length,queued:all.filter(t=>!t.ended&&latestAssignment(t)?.state==='pending').length},
   pending_messages:this.pendingSnapshot(pending),pending_total:pending.length,
   candidates:Object.values(this.state.candidates).map(c=>({eval_id:c.evalId,policy_version:c.policyVersion,messages:c.triggers.map(t=>({message_id:t.meta.messageId,text:t.text,author:t.actor,at:t.at}))})),
   actions:Object.values(this.state.actions).filter(a=>!a.completed&&(!a.payload.task_id||a.kind==='stop'||this.authorized(this.resolve(a.payload.task_id)))).slice(0,100),generation:this.state.generation,next_due:this.nextDue()??null,
   replies:Object.values(this.state.outbox).slice(-50).map(r=>({reply_id:r.message.id,state:r.status==='sent'?'saved':r.status,saved:r.status==='sent',message_id:r.savedMessageId??null,delivery_confirmed:false}))};
 }
 trigger(message:Pending,thread?:Trigger['threads']):Trigger{return {id:triggerId(this.scope.chatId,message.messageId),source:'computer-bridge',threads:thread??[{source:'computer-bridge',id:this.scope.chatId+'/'+message.messageId}],actor:{source:'computer-bridge',id:principalScope(message.author)},human:true,addressed:'direct',at:message.at,text:message.text,channel:{source:'computer-bridge',thread:this.scope.chatId,address:{chat_id:this.scope.chatId,message_id:message.messageId}},meta:{chatId:this.scope.chatId,deviceId:this.scope.deviceId,messageId:message.messageId,attachments:message.attachments}};}
 release(ids:string[]){
  if(!ids.length||new Set(ids).size!==ids.length)throw fail('invalid_task_argument','message_ids 必须包含不重复的原消息 ID');
  const messages=ids.map(id=>{const p=this.state.pending[id];if(!p)throw fail('message_not_found','当前对话不存在该待归类消息');if(p.routed)throw fail('message_already_routed','消息已归类，请读取原任务');return p;});
  const thread=[{source:'computer-bridge',id:this.scope.chatId+'/'+messages[0]!.messageId}];
  for(const p of messages){this.engine.receive(this.trigger(p,thread));p.routed='submitted';}
  this.engine.evaluateDue();return triggerId(this.scope.chatId,messages[0]!.messageId);
 }
 ingest(message:SuperAgentMessage){
  const pending:Pending={messageId:message.messageId,text:message.text,at:message.at,attachments:message.attachments??[],author:normalizeIdentity(message.principal)};
  this.state.pending[message.messageId]=pending;this.state.generation++;
  const match=/^\/(task-new|task-resume|tasks|task|new|cancel|stop|retry|pause|resume)(?:\s+([\s\S]*))?$/.exec(message.text.trim());
  if(!match){
   if(this.state.selected&&this.resolve(this.state.selected).ended?.by==='human')delete this.state.selected;
   if(this.state.selected){const ticket=this.resolve(this.state.selected),origin=this.repo.triggers.get(ticket.origin.triggerId)!;this.engine.receive(this.trigger(pending,origin.threads));pending.routed=ticket.id;
    const relay=followupRelay({trigger_id:triggerId(this.scope.chatId,pending.messageId)},[{ticket_id:ticket.id,title:ticket.title,state:this.view(ticket).state}]);this.effects.enqueue('relay',relay.id,{text:relay.text});}
   return {command:null,...this.snapshot()};
  }
  const command=match[1],body=match[2]?.trim()??'';let reply='';
  if(command==='tasks')reply=this.repo.tickets.list().map(t=>{const v=this.view(t);return `${v.task_id} · ${v.title} · ${v.state}`;}).join('\n')||'暂无任务。';
  else if(['pause','resume','task-resume'].includes(command)){this.state.settings.paused=command==='pause';reply=command==='pause'?'已暂停调度。':'已恢复调度。';}
  else if(command==='new'||command==='task-new'){if(!body&&!pending.attachments.length)required(body,'任务内容',MAX_MESSAGE_BYTES);pending.text=body?required(body,'任务内容',MAX_MESSAGE_BYTES):'';this.state.selected=undefined;reply='请求已保存，等待主 Agent 归类。';return {command,reply,...this.snapshot()};}
  else{const [id,...rest]=body.split(/\s+/),ticket=this.resolve(id);
   if(command==='task'){if(ticket.ended?.by==='human')throw fail('task_stopped','已停止的任务不能隐式恢复');this.state.selected=ticket.id;
    if(rest.length||pending.attachments.length){pending.text=rest.join(' ');this.engine.receive(this.trigger(pending,this.repo.triggers.get(ticket.origin.triggerId)!.threads));}reply=`${this.alias(ticket.id)} · ${ticket.title}`;}
   else if(command==='retry'){this.engine.retryTicket(ticket.id);reply='已重新排队 '+this.alias(ticket.id);}
   else{this.engine.stopTicket(ticket.id,rest.join(' ')||'Stopped by authenticated user');if(this.state.selected===ticket.id)delete this.state.selected;reply='已停止 '+this.alias(ticket.id);}}
  pending.routed='command';return {command,reply,...this.snapshot()};
 }
 assignment(ticket:Ticket,request:TaskRequest){const a=latestAssignment(ticket);if(!a||a.id!==required(request.assignment_id,'assignment_id',100))throw fail('stale_assignment','执行批次已结束或替换');return a;}
 messageId(value:unknown):string {
  const id=required(value,'message_id',200);
  if(/^m[1-9]\d*$/.test(id)&&this.state.pending[id])return id;
  const trigger=this.repo.triggers.get(id),message=trigger?.meta.messageId;
  if(trigger?.source==='computer-bridge'&&trigger.meta.chatId===this.scope.chatId&&trigger.meta.deviceId===this.scope.deviceId&&typeof message==='string'&&this.state.pending[message])return message;
  throw fail('message_not_found','消息或 trigger ID 不属于当前对话');
 }
 normalize(request:TaskRequest):TaskRequest {
  return {...request,...(request.message_id?{message_id:this.messageId(request.message_id)}:{}),...(request.message_ids?{message_ids:request.message_ids.map(id=>this.messageId(id))}:{}),
   ...(request.reply_to_message_id?{reply_to_message_id:this.messageId(request.reply_to_message_id)}:{}),...(request.question_for_message_id?{question_for_message_id:this.messageId(request.question_for_message_id)}:{}),
   ...(request.read?.message_id?{read:{...request.read,message_id:this.messageId(request.read.message_id)}}:{})};
 }
 ids(request:TaskRequest){const ids=request.message_ids??(request.message_id?[request.message_id]:[]);if(!ids.length)throw fail('invalid_task_argument','需要原消息 ID');return ids.map(id=>this.messageId(id));}
 attachmentReads(message:Pending){return message.attachments.flatMap((raw:any)=>{const id=typeof raw==='string'?raw:raw?.id??raw?.attachment_id;if(typeof id!=='string')return [];return [{attachment_id:id,...(raw?.name?{name:raw.name}:{}),read:{tool:'chat.attachment',arguments:{chat_id:this.scope.chatId,operation:raw?.mime?.startsWith('image/')||raw?.mime_type?.startsWith('image/')?'image':'info',attachment_id:id}}}];});}
 externalRead(request:TaskRequest){
  const read=EvalReadSchema.parse({...request.read,trigger_id:triggerId(this.scope.chatId,this.messageId(request.message_id))});
  if(read.resource==='file'||read.resource==='directory'){
   if(!this.state.repository)return {read_via:'host_tool',status:'repository_not_bound',resource:read.resource,path:read.path,reason:'No repository is bound. Select an authorized Bridge computer workspace or an authorized host source for this path; this reply did not read it.',workspace_discovery:{tool:'computer.workspaces',arguments:{device_id:this.scope.deviceId}}};
   return {read_via:'host_tool',status:'not_read',requested_character_offset:read.offset,continuation:'Read from byte offset 0, then use chat.repository next_offset and expected_sha. Original assessment character offsets are not repository byte offsets.',tool:'chat.repository',arguments:{chat_id:this.scope.chatId,operation:read.resource==='directory'?'list':'read',path:read.path,...(read.resource==='file'?{offset:0,length:4000,encoding:'text'}:{})}};
  }
  if(read.resource==='image'){
   const slash=read.image_id!.indexOf('/'),source=slash>=0?this.messageId(read.image_id!.slice(0,slash)):this.messageId(request.message_id),attachment=slash>=0?read.image_id!.slice(slash+1):read.image_id!;
   const message=this.state.pending[source]!,ref=this.attachmentReads(message).find(a=>a.attachment_id===attachment);
   if(!ref)throw fail('attachment_not_found','图片引用不属于指定原消息；先读取 pending 或 trigger 原文中的附件引用');
   return {read_via:'host_tool',status:'not_read',tool:'chat.attachment',arguments:{chat_id:this.scope.chatId,operation:'image',attachment_id:attachment}};
  }
  return undefined;
 }
 async dispatch(r:TaskRequest){
  if(r.action==='read'){
   const resource=required(r.resource,'resource',400),parts=resource.split('/');let value:unknown;
   if(parts[0]==='trigger'){const id=parts[1]!,found=this.repo.triggers.get(id)??this.repo.triggers.get(triggerId(this.scope.chatId,id));if(!found)throw fail('message_not_found','原消息不存在');value={...found,attachment_reads:this.attachmentReads(this.state.pending[this.messageId(found.id)]!)};}
   else if(parts[0]==='ticket'){const ticket=this.resolve(parts[1]);value=parts[2]==='result'?latestAssignment(ticket)?.report:parts[2]==='inputs'?ticket.inputs.map(i=>i.kind==='trigger'?{...i,message:this.repo.triggers.get(i.triggerId)}:i):ticket;}
   else if(resource==='tickets')value=this.repo.tickets.list().map(ticketCard);
   else if(resource==='settings')value=this.state.settings;
   else if(resource.startsWith('settings/'))value=(this.state.settings as any)[parts[1]!];
   else if(resource==='pending')value=Object.values(this.state.pending).filter(p=>!p.routed).map(({author,...p})=>({...p,author:principalScope(author)}));
   else throw fail('resource_not_found','可读取 trigger/ID、ticket/ID、ticket/ID/result、ticket/ID/inputs、tickets、settings 和 pending');
   return textPage(resource,JSON.stringify(value??null),r.offset??0,4000);
  }
  if(['eval','eval_read','eval_decide','requeue'].includes(r.action)){
   const id=triggerId(this.scope.chatId,required(r.message_id,'message_id',100));
   if(r.action==='requeue'){this.engine.reevaluate(id);return this.snapshot();}
   if(r.action==='eval')return this.assessor.context(id);
   if(r.action==='eval_read'){const external=this.externalRead(r);if(external)return external;await this.assessor.context(id);return this.assessor.read(null,EvalReadSchema.parse({...r.read,trigger_id:id}),new AbortController().signal);}
   return this.assessor.decide(id,AssessmentSchema.parse(r.assessment));
  }
  if(r.action==='unsubscribe'){const raw=required(r.thread_id,'thread_id',300),sep=raw.indexOf(':');if(sep<1)throw fail('invalid_task_argument','thread_id 必须为 source:id');this.engine.unsubscribe(raw);return this.snapshot();}
  if(r.action==='action_done'){const id=required(r.action_id,'action_id',500),action=this.state.actions[id];if(!action||!['relay','notice','stop'].includes(action.kind))throw fail('invalid_task_argument','此动作必须使用对应的生命周期回报');this.done(id);return this.snapshot();}
  if(r.action==='list')return this.snapshot(r);
  if(r.action==='instructions')return {role:r.role??'orchestrator',text:rolePrompt(r.role??'orchestrator',this.state.settings,{chatId:this.scope.chatId,deviceId:this.scope.deviceId,repository:this.state.repository}),...this.snapshot()};
  if(r.action==='pending')return {messages:this.ids(r).map(id=>{const p=this.state.pending[id];if(!p)throw fail('message_not_found','消息不存在');const {author,...publicMessage}=p;return {...clone(publicMessage),author:{kind:author.kind,id:principalScope(author)},attachment_reads:this.attachmentReads(p)};}),...this.snapshot()};
  if(r.action==='discuss'){const ids=this.ids(r);for(const id of ids){const p=this.state.pending[id];if(!p||p.routed)throw fail('message_already_routed','只能讨论尚未归类的请求');p.discussing=ids;p.reason=r.reason;}this.state.generation++;return this.snapshot();}
  if(r.action==='pause'||r.action==='resume'){this.state.settings.paused=r.action==='pause';return this.snapshot();}
  if(r.action==='candidate_delivered'){const id=required(r.eval_id,'eval_id',100);if(!this.state.candidates[id])throw fail('stale_candidate','候选已结束');this.engine.candidateDelivered(id);this.done(id);return this.snapshot();}
  if(['accept','ignore','attach','stop'].includes(r.action)){
   if(this.state.settings.paused)throw fail('super_agent_paused','Super Agent 已暂停');
   const ids=this.ids(r);const first=triggerId(this.scope.chatId,ids[0]!);const id=this.repo.triggers.get(first)?first:this.release(ids);
   const c=this.engine.candidate(id);if(r.eval_id&&r.eval_id!==c?.evalId)throw fail('stale_candidate','候选已替换');
   let result:any;
   const target=r.action==='attach'||r.action==='stop'?this.resolve(r.task_id).id:undefined;
   const routed=routeOriginal(this.engine,this.repo,{kind:r.action,trigger_id:id,ticket_id:target,title:r.title,worktree_name:r.name,acknowledgement:r.acknowledgement,note:r.note,reason:r.reason});
   if('refused' in routed)throw fail('route_refused',routed.refused);
   if(routed.ticketId)this.alias(routed.ticketId);
   if(r.action==='attach'&&target)for(const message of ids.slice(1))this.engine.attach(target,triggerId(this.scope.chatId,message),r.note);
   result={decision:routed,...(routed.ticketId?{task:this.view(this.resolve(routed.ticketId))}:{})};
   this.state.generation++;return {...result,...this.snapshot()};
  }
  const ticket=this.resolve(r.task_id);
  if(r.action==='detail')return {task:this.view(ticket),assignment:latestAssignment(ticket),origin:ticket.origin,original_messages:ticket.origin.triggerIds.map(id=>this.repo.triggers.get(id)),inputs:ticket.inputs.map(i=>i.kind==='trigger'?{...i,message:this.repo.triggers.get(i.triggerId)}:i),...this.snapshot()};
  if(r.action==='cancel'){this.engine.stopTicket(ticket.id,r.reason||'Stopped by authenticated user');if(this.state.selected===ticket.id)delete this.state.selected;}
  else if(r.action==='retry')this.engine.retryTicket(ticket.id);
  else if(r.action==='request_status')return {requested:this.engine.requestStatus(ticket.id),...this.snapshot()};
  else if(r.action==='note')this.engine.note(ticket.id,required(r.text,'text'));
  else if(r.action==='handback')return {queued:this.engine.handback(ticket.id,triggerId(this.scope.chatId,required(r.message_id,'message_id',100)),required(r.reason,'reason',2000)),...this.snapshot()};
  else if(r.action==='reply'){
   const text=required(r.text,'text'),purpose=r.purpose??'result',id=r.message_id?triggerId(this.scope.chatId,r.message_id):undefined;
   const reply=purpose==='acknowledgement'?this.engine.reply({purpose,ticketId:ticket.id,triggerId:id??triggerId(this.scope.chatId,required(r.message_id,'message_id',100)),text}):this.engine.reply({purpose,ticketId:ticket.id,triggerId:id,text,question:r.question??undefined});return {reply,...this.snapshot()};
  }else if(r.action==='follow'||r.action==='unfollow'||r.action==='thread_closed'){
   const raw=required(r.thread_id,'thread_id',300),sep=raw.indexOf(':'),ref={source:raw.slice(0,sep),id:raw.slice(sep+1)};if(sep<1)throw fail('invalid_task_argument','thread_id 必须为 source:id');
   if(r.action==='follow'){if(r.context_only!==false)this.engine.followForContext(ticket.id,ref);else this.engine.bindThread(ticket.id,ref,true);}
   else if(r.action==='unfollow')this.engine.markUnrelated(ticket.id,raw,required(r.reason,'reason',2000));
   else this.engine.threadClosed(ref,r.outcome??'closed',r.at??this.at);
  }else{
   const a=this.assignment(ticket,r);
   if(r.action==='claim')return {assignment:{ticket_id:ticket.id,task_id:this.alias(ticket.id),assignment_id:a.id,mandate:ticket.mandate,origin:ticket.origin,original_messages:ticket.origin.triggerIds.map(id=>this.repo.triggers.get(id)),inputs:ticket.inputs,reported_state:a.state},...this.snapshot()};
   if(r.action==='inputs'){if(r.input_ids?.length)throw fail('explicit_input_report_required','inputs 只读；请分别使用 inputs_delivered 和 inputs_read');return {stop:!!ticket.ended||this.state.settings.paused,assignment_id:a.id,inputs:ticket.inputs.map(i=>i.kind==='trigger'?{...i,message:this.repo.triggers.get(i.triggerId)}:i),...this.snapshot()};}
   if(r.action==='started'){if(this.state.settings.paused)throw fail('super_agent_paused','Super Agent 已暂停');if(a.state==='ended'||ticket.ended)throw fail('task_ended','任务已结束');const slots=new WorkerSlots(()=>this.repo.tickets.open().filter(t=>{const x=latestAssignment(t);return !!x&&this.state.activity[x.id]==='running';}).map(t=>t.id),()=>this.state.settings.executor.maxWorkers);if(this.state.activity[a.id]!=='running')slots.reserve(ticket.id,a.state==='pending'?'launch':ticket.undelivered.some(id=>ticket.inputs.some(i=>i.id===id&&i.kind==='trigger'&&i.human))?'person':'wake');this.engine.assignmentStarted(ticket.id,a.id);this.state.activity[a.id]='running';slots.free(ticket.id);this.done(a.id);}
   else if(r.action==='inputs_delivered'||r.action==='inputs_read'){
    const ids=r.input_ids??[];if(a.state!=='running'||!ids.length||ids.some(id=>!ticket.inputs.some(i=>i.id===id)))throw fail('invalid_task_argument','只能回报当前运行批次的输入');
    if(r.action==='inputs_read'&&ids.some(id=>ticket.undelivered.includes(id)))throw fail('input_not_delivered','请先报告输入已送达');
    if(r.action==='inputs_delivered')this.engine.inputsDelivered(ticket.id,a.id,ids);else this.engine.inputsRead(ticket.id,ids);
    if(!this.resolve(ticket.id).undelivered.length)this.done('delivery:'+a.id);
   }else if(r.action==='delivery_failed')this.engine.deliveryFailed(ticket.id,a.id,required(r.reason,'reason',2000));
   else if(r.action==='turn_ended'){this.engine.turnEnded(ticket.id,a.id);this.state.activity[a.id]='idle';}
   else if(r.action==='interrupted'||r.action==='recover')this.engine.assignmentInterrupted(ticket.id,a.id);
   else if(r.action==='report'){
    if(!r.state)throw fail('invalid_task_argument','需要 state');
    if(r.pr_number!=null){if(this.state.repository?.provider!=='github'||!Number.isSafeInteger(r.pr_number)||r.pr_number<1||typeof r.pr_own!=='boolean')throw fail('invalid_pull_report','报告 PR 需要当前 GitHub 仓库、正整数 pr_number 和 pr_own（是否由本任务创建）');this.engine.bindThread(ticket.id,{source:'github',id:String(r.pr_number)},r.pr_own);}
    const report={state:r.state,summary:required(r.summary,'summary'),...(r.question!==undefined?{question:r.question}:{}),...(r.reply_to_message_id?{answers:triggerId(this.scope.chatId,r.reply_to_message_id)}:{}),...(r.question_for_message_id?{askedBy:triggerId(this.scope.chatId,r.question_for_message_id)}:{})};
    const updated=this.engine.report(ticket.id,report),relay=reportRelay(updated,report);if(relay)this.effects.enqueue('relay',relay.id,{text:relay.text});
   }else throw fail('unknown_task_action','未知任务操作');
  }
  this.state.generation++;return {task:this.view(this.resolve(ticket.id)),...this.snapshot()};
 }
}
interface Chunked {storage:'chunks-v1';chunks:number;length:number;digest:string}
const part=(chat:string,i:number)=>PREFIX+chat+':part:'+String(i).padStart(8,'0');
async function read(tx:KeyStore,scope:SuperAgentScope):Promise<any>{const saved=await tx.get<any>(PREFIX+scope.chatId);if(!saved)return empty(scope);if(!('storage'in saved))return saved;let json='';for(let i=0;i<saved.chunks;i++){const p=await tx.get<string>(part(scope.chatId,i));if(typeof p!=='string')throw fail('super_agent_state_corrupt','任务数据不完整');json+=p;}if(json.length!==saved.length||key(json)!==saved.digest)throw fail('super_agent_state_corrupt','任务数据校验失败');return JSON.parse(json);}
async function save(tx:KeyStore,state:State){const previous=await tx.get<any>(PREFIX+state.chatId),json=JSON.stringify(state),chunks=Math.ceil(json.length/16000);for(let i=0;i<chunks;i++)await tx.put(part(state.chatId,i),json.slice(i*16000,(i+1)*16000));if(previous?.storage)for(let i=chunks;i<previous.chunks;i++)await tx.delete(part(state.chatId,i));await tx.put(PREFIX+state.chatId,{storage:'chunks-v1',chunks,length:json.length,digest:key(json)} satisfies Chunked);}
async function authorize(tx:KeyStore,runtime:Runtime,ids:string[]){for(const id of new Set(ids)){const principal=runtime.state.authorities[id];if(!principal||!runtime.scope.authorizePrincipal)throw fail('task_authority_unavailable','原消息授权无法复核');await runtime.scope.authorizePrincipal(tx,principal);}}
function runtime(state:State,scope:SuperAgentScope,at?:string){if(state.version!==2)throw fail('super_agent_version','不支持的任务版本');if(state.chatId!==scope.chatId||state.deviceId!==scope.deviceId)throw fail('device_forbidden','任务不属于当前对话');return new Runtime(clone(state),scope,at);}
function compact(result:any){const {mode,runtime_version,upstream,paused,repository,selected_task,host,tasks,tasks_more,tasks_cursor,tasks_total,task_counts,pending_messages,pending_total,candidates,actions,generation,next_due,replies,...rest}=result;return rest;}
export async function superAgentMessage(tx:KeyStore,message:SuperAgentMessage){const state=await read(tx,message);if(state.version===1)return {runtime_version:1,...await legacy.superAgentMessage(tx,message)};
 const id='message:'+message.messageId,fp=key(message.text,JSON.stringify(message.attachments??[])),old=state.seen[id];if(old){if(old.fingerprint!==fp)throw fail('request_key_conflict','消息内容发生变化');return {...old.result,...runtime(state,message).snapshot()};}
 state.authorities[triggerId(message.chatId,message.messageId)]=normalizeIdentity(message.principal);const run=runtime(state,message,message.at);
 if(run.state.selected&&run.resolve(run.state.selected).ended?.by!=='human')await authorize(tx,run,[run.resolve(run.state.selected).origin.triggerId]);
 let result:any;try{result=run.ingest(message);await run.settle();}catch(error){if(!message.text.trim().startsWith('/'))throw error;const clean=runtime(state,message,message.at);result={command:'error',reply:(error as Error).message,...clean.snapshot()};clean.state.seen[id]={fingerprint:fp,result:compact(result)};await save(tx,clean.state);return result;}
 run.state.seen[id]={fingerprint:fp,result:compact(result)};await save(tx,run.state);return {...result,...run.snapshot()};}
export async function superAgentTask(tx:KeyStore,scope:SuperAgentScope,r:TaskRequest,hostId?:string){const state=await read(tx,scope);if(state.version===1){
 if(['instructions','pending'].includes(r.action)){if(!hostId)throw fail('model_connection_required','需要当前模型连接');const snapshot=await legacy.superAgentTask(tx,scope,{action:'list'},hostId);return {runtime_version:1,protocol:'legacy',...snapshot,text:'This existing conversation uses the previous protocol until its tasks finish. Use accept/ignore with candidate eval_id; claim starts a legacy assignment; inputs with input_ids acknowledges legacy delivery/read; report also closes its legacy turn. Do not use v2 started/inputs_delivered/inputs_read/turn_ended in this conversation. New Super Agent conversations use v2. No new Bridge working conversation is required.'};}
 return {runtime_version:1,...await legacy.superAgentTask(tx,scope,r,hostId)};
 }
 if(HOST_ACTIONS.has(r.action)&&!hostId)throw fail('model_connection_required','需要当前模型连接');const run=runtime(state,scope),changing=MUTATING_ACTIONS.has(r.action),id=changing?'request:'+key(principalScope(scope.principal),hostId??'human',required(r.request_key,'request_key',200)):null;
 r=run.normalize(r);const fp=key(JSON.stringify(r));const sources=[...(r.message_ids??[]),...(r.message_id?[r.message_id]:[]),...(r.reply_to_message_id?[r.reply_to_message_id]:[]),...(r.question_for_message_id?[r.question_for_message_id]:[])].map(m=>triggerId(scope.chatId,m));if(r.task_id){const t=run.resolve(r.task_id);sources.push(t.origin.triggerId,...t.inputs.flatMap(i=>i.kind==='trigger'?[i.triggerId]:[]));}await authorize(tx,run,sources);
 if(id&&run.state.seen[id]){const old=run.state.seen[id];if(old.fingerprint!==fp)throw fail('request_key_conflict','同一 request_key 参数不同');return {...old.result,...run.snapshot()};}
 const result=await run.dispatch(r);if(changing){await run.settle();run.state.seen[id!]={fingerprint:fp,result:compact(result)};await save(tx,run.state);}return {...result,...run.snapshot()};}
export async function superAgentTick(tx:KeyStore,scope:SuperAgentScope):Promise<{changed:boolean;next_due?:number;generation?:number;runtime_version:number}>{
 const state=await read(tx,scope);if(state.version===1)return {changed:false,runtime_version:1};
 const run=runtime(state,scope),before=run.state.generation,oldSettings=clone(run.state.settings);
 const identities=new Map(Object.values(run.state.authorities).map(author=>[principalScope(author),author]));const denied:string[]=[];
 for(const [actor,principal]of identities){try{if(!scope.authorizePrincipal)throw fail('task_authority_unavailable','无法检查消息授权');await scope.authorizePrincipal(tx,principal);}catch(error){if(!['account_unavailable','device_forbidden','device_unauthorized','device_missing'].includes((error as any)?.code))throw error;denied.push(actor);}}
 if(JSON.stringify([...denied].sort())!==JSON.stringify([...run.state.deniedActors].sort())){
  run.state.deniedActors=denied;run.state.settings.policy.sources['computer-bridge']!.allowed=[...identities.keys()].filter(id=>!denied.includes(id)).map(id=>({id}));
  const from=policyVersion(oldSettings),to=policyVersion(run.state.settings);run.engine.policyChanged(from,to,policyEffects(run.repo.tickets.open(),oldSettings,run.state.settings,()=>run.source));
  for(const t of run.repo.tickets.open()){const a=latestAssignment(t);if(a&&run.authorized(t)){if(a.state==='pending')run.effects.enqueue('launch',a.id,{ticketId:t.id,assignmentId:a.id});if(a.state==='running'&&t.undelivered.length)run.effects.enqueue('delivery',t.id,{ticketId:t.id});}}
  run.state.generation++;
 }
 await run.settle();await save(tx,run.state);return {changed:before!==run.state.generation,next_due:run.nextDue(),generation:run.state.generation,runtime_version:2};
}
export async function superAgentErase(tx:KeyStore,chatId:string){return legacy.superAgentErase(tx,chatId);}
export interface SuperAgentOutbound {id:string;chatId:string;taskId?:string;replyTo?:string;text:string;kind:OutboundMessage['kind']}
export async function superAgentDrainOutbox(tx:KeyStore,scope:SuperAgentScope,saveReply:(m:SuperAgentOutbound)=>Promise<{messageId:string}>){const state=await read(tx,scope);if(state.version===1)return legacy.superAgentDrainOutbox(tx,scope,saveReply);const receipts:{reply_id:string;message_id:string;saved:true;delivery_confirmed:false}[]=[];
 const run=new Runtime(clone(state),scope,undefined,async m=>{if(m.ticketId)await authorize(tx,run,[run.resolve(m.ticketId).origin.triggerId]);const saved=await saveReply({id:m.id,chatId:scope.chatId,taskId:m.ticketId?run.alias(m.ticketId):undefined,replyTo:m.channel.address.message_id,text:m.text,kind:m.kind});run.state.outbox[m.id]!.savedMessageId=saved.messageId;receipts.push({reply_id:m.id,message_id:saved.messageId,saved:true,delivery_confirmed:false});return 'sent';});
 await run.settle();await save(tx,run.state);return receipts;
}
