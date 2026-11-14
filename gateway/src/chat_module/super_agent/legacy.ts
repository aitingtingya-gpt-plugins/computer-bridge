/** Bridge adapter for the unmodified DeepSeek Super Agent domain core. No model, credentials or repository service is embedded. */
import type {KeyStore} from '../../runtime';
import type {ChatIdentity} from '../../chat_identity';
import {principalScope,normalizeIdentity} from '../../chat_identity';
import {Engine,key,latestAssignment,ticketStage,canRetry,type Candidate,type DomainEvent,type OutboundMessage,type Policy,type ReplyStatus,type Ticket,type TicketInput,type Trigger} from './vendor/src/core/index.ts';
import {SnapshotRepositories,emptyRecords,type Records} from './repository';
import {HOST_ACTIONS,MUTATING_ACTIONS,type RepositoryBinding,type SuperAgentScope,type SuperAgentMessage,type TaskRequest} from './types';
export type {SuperAgentScope,SuperAgentMessage,TaskRequest,RepositoryBinding} from './types';
export {HOST_ACTIONS,MUTATING_ACTIONS} from './types';
export {superAgentTaskSpec} from './contracts';

export const SUPER_AGENT_UPSTREAM={repository:'deepseek-ai/dsh-superagent-prototype',commit:'8c32a9dc5d72c033816c6a8110b37f40cf94fba4',license:'MIT'} as const;
const PREFIX='chat-super-agent:';
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const clone=<T>(value:T):T=>structuredClone(value);
type Session={ticketId:string;assignmentId:string;state:'queued'|'running'|'stopped';hostId?:string;claimedAt?:string;stopReason?:string;pending:string[]};
interface State {
  version:1;chatId:string;deviceId:string;paused:boolean;repository:RepositoryBinding;
  records:Records;candidates:Record<string,Candidate>;sessions:Record<string,Session>;
  outbox:Record<string,{message:OutboundMessage;status:ReplyStatus;savedMessageId?:string}>;events:DomainEvent[];
  aliases:Record<string,string>;counter:number;selected?:string;
  seen:Record<string,{fingerprint:string;result:any}>;
  authorities:Record<string,ChatIdentity>;
}
const empty=(scope:SuperAgentScope):State=>({version:1,chatId:scope.chatId,deviceId:scope.deviceId,paused:false,repository:scope.repository??null,
  records:emptyRecords(),authorities:{},candidates:{},sessions:{},outbox:{},events:[],aliases:{},counter:0,seen:{}});
function required(value:unknown,label:string,max=16000):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw fail('invalid_task_argument',label+' 必须为非空文本（最多 '+max+' 字符）');
  return value.trim();
}
export {normalizeRepositoryBinding as normalizeRepository} from '../repositories';

class Runtime {
  readonly repo:SnapshotRepositories;
  readonly engine:Engine;
  constructor(readonly state:State,readonly scope:SuperAgentScope,readonly at=new Date().toISOString()) {
    this.repo=new SnapshotRepositories(state.records);
    const policy:Policy={version:'bridge-explicit-v1',get paused(){return state.paused;},evalTimeoutMs:300000,
      gate:trigger=>trigger.human&&trigger.source==='computer-bridge'&&trigger.meta.chatId===scope.chatId&&trigger.meta.deviceId===scope.deviceId
        ?{admissible:true,strength:'explicit',basis:{via:'addressed',addressed:'direct',source:'computer-bridge',scope:{chatId:scope.chatId,deviceId:scope.deviceId},sender:trigger.actor.id}}
        :{admissible:false,reason:'Only authenticated human messages in this conversation may originate work'},
      revalidate:mandate=>mandate.basis.source==='computer-bridge'&&mandate.basis.scope?.chatId===scope.chatId&&mandate.basis.scope?.deviceId===scope.deviceId,
      admitsInferred:()=>false,
    };
    this.engine=new Engine({repo:this.repo,policy:()=>policy,now:()=>this.at,
      scope:{scope:input=>input.source==='computer-bridge'&&input.meta.chatId===scope.chatId&&input.meta.deviceId===scope.deviceId
        ?{listened:true,observed:false}:{listened:false,reason:'Wrong Bridge conversation'}},
      assessor:{request:candidate=>{state.candidates[candidate.evalId]=clone(candidate);},release:id=>{delete state.candidates[id];}},
      executor:{start:(ticket,assignment)=>{state.sessions[assignment.id]??={ticketId:ticket.id,assignmentId:assignment.id,state:'queued',pending:[...ticket.undelivered]};},
        deliver:(ticket,assignment)=>{const session=state.sessions[assignment.id];if(session)session.pending=[...new Set([...session.pending,...ticket.undelivered])];},
        stop:(_ticket,assignment,reason)=>{const session=state.sessions[assignment.id];if(session){session.state='stopped';session.stopReason=reason;session.pending=[];}},},
      outbox:{send:message=>{state.outbox[message.id]??={message:clone(message),status:'pending'};},status:id=>state.outbox[id]?.status,
        withdraw:id=>{if(state.outbox[id]?.status==='pending')state.outbox[id].status='dropped';}},
      emit:event=>{state.events.push(clone(event));if(state.events.length>1000)state.events.splice(0,state.events.length-1000);},
    });
  }
  alias(id:string):string {
    const existing=Object.entries(this.state.aliases).find(([,value])=>value===id)?.[0];
    if(existing)return existing;
    const alias='k'+ ++this.state.counter;this.state.aliases[alias]=id;return alias;
  }
  resolve(value:unknown):Ticket {
    const id=required(value,'task_id',100),ticket=this.repo.tickets.get(this.state.aliases[id]??id);
    if(!ticket)throw fail('task_not_found','当前对话不存在该任务');
    return ticket;
  }
  view(ticket:Ticket) {
    const assignment=latestAssignment(ticket),session=assignment&&this.state.sessions[assignment.id];
    return {task_id:this.alias(ticket.id),id:ticket.id,title:ticket.title,scope:ticket.mandate.scope.slice(0,512),scope_truncated:ticket.mandate.scope.length>512,stage:ticketStage(ticket),
      state:ticket.ended?.outcome??(this.state.paused?'paused':assignment?.state==='pending'?'queued':assignment?.report?.state??assignment?.state??'queued'),
      can_retry:canRetry(ticket),created_at:ticket.createdAt,updated_at:ticket.updatedAt,assignment_id:assignment?.id??null,
      executor:session?.state??'unavailable',pending_inputs:session?.pending.length??0,summary:assignment?.report?.summary.slice(0,1000)??null,summary_truncated:(assignment?.report?.summary.length??0)>1000,attention:ticket.attention?.question??null,
      origin_message_id:this.repo.triggers.get(ticket.origin.triggerId)?.meta.messageId??null};
  }
  snapshot(options:Pick<TaskRequest,'active_only'|'after'|'limit'>={}) {
    const all=this.repo.tickets.list(),active=all.filter(ticket=>!ticket.ended),after=options.after??0,limit=options.limit??100;
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('invalid_task_argument','分页参数无效');
    const serial=(ticket:Ticket)=>Number(this.alias(ticket.id).slice(1));
    const filtered=options.active_only?active.filter(ticket=>serial(ticket)>after).sort((a,b)=>serial(a)-serial(b)):all;
    const page=filtered.slice(0,limit),more=filtered.length>limit;
    return {mode:'super_agent',upstream:SUPER_AGENT_UPSTREAM,paused:this.state.paused,repository:this.state.repository,
      selected_task:this.state.selected?this.alias(this.state.selected):null,
      host:{kind:'external_work_dot',execution:'claim_required',availability:'not_probed',permissions:'unchanged',
        instruction:'Use actual host/subagent execution tools. A notification is not execution. Claim the exact assignment before work, recheck cancellation with inputs before each tool step, and report the exact assignment. Ready/dropped reports and attention questions are saved to the chat by the transactional outbox; do not send that same text again with chat.reply when a receipt confirms saved:true. If host execution is unavailable, leave queued or report blocked. Never repeat an uncertain external operation without checking it.'},
      replies:Object.values(this.state.outbox).filter(item=>item.status!=='dropped').slice(-50).map(item=>({reply_id:item.message.id,task_id:item.message.ticketId?this.alias(item.message.ticketId):null,
        state:item.status==='sent'?'saved':'pending',saved:item.status==='sent',message_id:item.savedMessageId??null,delivery_confirmed:false})),
      tasks:page.map(ticket=>this.view(ticket)),tasks_more:more,tasks_cursor:options.active_only&&more?serial(page.at(-1)!):null,
      tasks_total:all.length,task_counts:{total:all.length,active:active.length,ended:all.length-active.length,
        queued:active.filter(ticket=>latestAssignment(ticket)?.state==='pending').length},
      candidates_total:Object.keys(this.state.candidates).length,candidates_more:Object.keys(this.state.candidates).length>10,
      candidates:Object.values(this.state.candidates).slice(0,10).map(candidate=>({eval_id:candidate.evalId,policy_version:candidate.policyVersion,
        messages:candidate.triggers.slice(0,10).map(trigger=>({message_id:trigger.meta.messageId,author:trigger.actor,source_identity:this.publicIdentity(trigger.id),text:trigger.text.slice(0,2048),text_truncated:trigger.text.length>2048,at:trigger.at,
          attachments:Array.isArray(trigger.meta.attachments)?trigger.meta.attachments.slice(0,10):[]}))})),
    };
  }
  publicIdentity(triggerId:string) {
    const identity=this.state.authorities[triggerId];
    return identity?{kind:identity.kind,id:identity.kind==='account'?identity.actor.id:identity.device,authenticated:true}:{kind:'unknown',authenticated:false};
  }
  inputView(input:TicketInput) {
    if(input.kind!=='trigger')return clone(input);
    const trigger=this.repo.triggers.get(input.triggerId);
    return {...clone(input),message:trigger?.text,message_id:trigger?.meta.messageId,chat_id:this.scope.chatId,attachments:trigger?.meta.attachments??[],author:trigger?.actor,
      authority:'Authenticated human message, subject to original scope and normal tool confirmations'};
  }
  trigger(message:SuperAgentMessage,text:string,task?:Ticket):Trigger {
    // Each new task has its own domain thread. A directed follow-up fans out only to that task.
    const original=task&&this.repo.triggers.get(task.origin.triggerId);
    return {id:key('bridge-trigger',message.chatId,message.messageId),source:'computer-bridge',
      threads:original?.threads??[{source:'computer-bridge',id:message.chatId+'/'+message.messageId}],
      actor:{source:'computer-bridge',id:principalScope(message.principal)},human:true,addressed:'direct',at:message.at,text,
      channel:{source:'computer-bridge',thread:message.chatId,address:{chat_id:message.chatId,message_id:message.messageId}},
      meta:{chatId:message.chatId,deviceId:message.deviceId,messageId:message.messageId,attachments:message.attachments??[]}};
  }
  create(message:SuperAgentMessage,text:string):Ticket {
    if(this.state.paused)throw fail('super_agent_paused','Super Agent 已暂停；先 /resume，再 /new 创建任务');
    const trigger=this.trigger(message,text);this.engine.receive(trigger);
    const decision=this.engine.decide(trigger.id,{kind:'accept',title:text.slice(0,100),scope:text,reason:'Authenticated human /new command'});
    const ticket=this.repo.tickets.get(decision.ticketId!)!;this.alias(ticket.id);delete this.state.selected;return ticket;
  }
  ingest(message:SuperAgentMessage) {
    const match=/^\/(task-new|task-resume|tasks|task|new|cancel|stop|retry|pause|resume)(?:\s+([\s\S]*))?$/.exec(message.text.trim());
    let reply:string|undefined,command=match?.[1]??null;
    if(command==='task-new')command='new';if(command==='task-resume')command='resume';
    if(match){
      const body=match[2]?.trim()??'';
      if(command==='tasks')reply=this.repo.tickets.list().slice(0,100).map(task=>{const view=this.view(task);return `${view.task_id} · ${view.title} · ${view.state}`;}).join('\n')||'暂无任务。用 /new 任务内容 创建任务。';
      else if(command==='pause'||command==='resume'){
        this.state.paused=command==='pause';this.engine.evaluateDue();
        reply=this.state.paused?'已暂停领取新任务。已运行工具不会被自动撤销；执行宿主须在下一工具步骤前停止。':'已恢复任务调度。';
      }else if(command==='new'){
        const ticket=this.create(message,required(body,'任务内容'));reply=`已创建 ${this.alias(ticket.id)}，等待执行宿主领取。`;
      }else{
        const [id,...rest]=body.split(/\s+/),ticket=this.resolve(id);
        if(command==='task'){
          if(ticket.ended?.by==='human')throw fail('task_stopped','该任务已由用户停止；请新建任务，不可隐式恢复');
          this.state.selected=ticket.id;
          const text=rest.join(' ');
          if(text){const trigger=this.trigger(message,text,ticket);this.engine.receive(trigger);}
          const view=this.view(this.repo.tickets.get(ticket.id)!);reply=`${view.task_id} · ${view.title} · ${view.state}`+(view.summary?'\n'+view.summary:'');
        }else if(command==='cancel'||command==='stop'){
          this.engine.stopTicket(ticket.id,body.slice(id.length).trim()||'Stopped by authenticated human');
          if(this.state.selected===ticket.id)delete this.state.selected;
          reply=`已停止 ${this.alias(ticket.id)} 的后续工作。已执行的外部操作不会自动撤销。`;
        }else if(command==='retry'){
          if(this.state.paused)throw fail('super_agent_paused','请先 /resume 再重试');
          this.engine.retryTicket(ticket.id);reply=`已重新排队 ${this.alias(ticket.id)}。`;
        }
      }
    }else{
      const selected=this.state.selected?this.repo.tickets.get(this.state.selected):undefined;
      const trigger=this.trigger(message,message.text,selected);this.engine.receive(trigger);
      this.engine.evaluateDue();
    }
    return {command,reply,...this.snapshot()};
  }
  currentSession(ticket:Ticket,request:TaskRequest,hostId:string) {
    const assignment=latestAssignment(ticket),id=required(request.assignment_id,'assignment_id',100);
    if(!assignment||assignment.id!==id)throw fail('stale_assignment','任务已切换执行批次，旧结果不可写入');
    const session=this.state.sessions[id];
    if(!session||session.hostId!==hostId)throw fail('assignment_not_owned','当前宿主未领取该执行批次');
    return session;
  }
  dispatch(request:TaskRequest,hostId?:string) {
    if(request.question!==undefined&&request.question!==null&&(typeof request.question!=='string'||request.question.length>4000))throw fail('invalid_task_argument','question 必须为文本或 null（最多 4000 字符）');
    if(request.reason!==undefined&&(typeof request.reason!=='string'||request.reason.length>2000))throw fail('invalid_task_argument','reason 必须为文本（最多 2000 字符）');
    if(HOST_ACTIONS.has(request.action)&&!hostId)throw fail('model_connection_required','此操作需要已验证的当前模型连接');
    if(request.action==='list')return this.snapshot(request);
    if(request.action==='pause'||request.action==='resume'){
      this.state.paused=request.action==='pause';this.engine.evaluateDue();return this.snapshot();
    }
    if(request.action==='accept'||request.action==='ignore'){
      if(this.state.paused)throw fail('super_agent_paused','Super Agent 已暂停');
      const messageId=required(request.message_id,'message_id',100),triggerId=key('bridge-trigger',this.scope.chatId,messageId);
      const candidate=this.engine.candidate(triggerId),evalId=required(request.eval_id,'eval_id',100);
      if(!candidate||candidate.evalId!==evalId)throw fail('stale_candidate','候选已处理或已替换，请刷新任务状态');
      // Delivery starts the upstream assessment deadline only once a verified host takes it up.
      this.engine.candidateDelivered(evalId);
      const outcome=request.action==='ignore'?{kind:'ignore' as const,reason:required(request.reason,'reason',2000),evalId}
        :{kind:'accept' as const,title:required(request.title,'title',200),scope:required(request.scope,'scope'),reason:request.reason||'Host routed authenticated human request',evalId};
      const decision=this.engine.decide(triggerId,outcome);
      if(decision.ticketId)this.alias(decision.ticketId);
      this.engine.evaluateDue();return {decision,...this.snapshot()};
    }
    const ticket=this.resolve(request.task_id);
    if(request.action==='attach'){
      const triggerId=key('bridge-trigger',this.scope.chatId,required(request.message_id,'message_id',100));
      this.engine.attach(ticket.id,triggerId);this.engine.evaluateDue();return {task:this.view(this.repo.tickets.get(ticket.id)!),...this.snapshot()};
    }
    if(request.action==='detail')return {task:{...this.view(ticket),scope:ticket.mandate.scope,scope_truncated:false,summary:latestAssignment(ticket)?.report?.summary??null,summary_truncated:false},inputs:ticket.inputs.map(input=>this.inputView(input)),...this.snapshot()};
    if(request.action==='cancel'){
      this.engine.stopTicket(ticket.id,request.reason||'Stopped by authenticated user');if(this.state.selected===ticket.id)delete this.state.selected;
    }else if(request.action==='retry'){
      if(this.state.paused)throw fail('super_agent_paused','Super Agent 已暂停');
      // A pending retry is safe only after the host has recorded blocked/failed, never automatically after a lost tool result.
      this.engine.retryTicket(ticket.id);
    }else if(request.action==='claim'){
      if(this.state.paused)throw fail('super_agent_paused','Super Agent 已暂停');
      const assignment=latestAssignment(ticket);
      if(ticket.ended||!assignment||assignment.state==='ended')throw fail('task_ended','任务已结束');
      if(request.assignment_id!==assignment.id)throw fail('stale_assignment','请提供任务当前 assignment_id');
      const session=this.state.sessions[assignment.id];
      if(!session)throw fail('session_unavailable','执行会话不存在');
      // Only the ORIGINAL request key may reuse a claim (handled by durable dedup before dispatch).
      // A new key from the same writer can be another host process and must not launch a second executor.
      if(session.hostId)throw fail('task_in_use','任务已领取；请复用原 claim 请求键，或先核实并显式恢复，不可重复启动');
      session.hostId=hostId;session.claimedAt??=this.at;session.state='running';
      this.engine.assignmentStarted(ticket.id,assignment.id);
      const origin=this.repo.triggers.get(ticket.origin.triggerId);
      return {assignment:{...clone(session),repository:this.state.repository,mandate:ticket.mandate,scope:ticket.mandate.scope,
        origin:{chat_id:this.scope.chatId,message_id:origin?.meta.messageId,text:origin?.text,attachments:origin?.meta.attachments??[],author:origin?.actor}},...this.snapshot()};
    }else if(request.action==='inputs'){
      const session=this.currentSession(ticket,request,hostId!);
      if(this.state.paused||ticket.ended||session.state==='stopped')return {stop:true,reason:session.stopReason??ticket.ended?.reason??'paused',...this.snapshot()};
      const ids=request.input_ids??[];
      if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!session.pending.includes(id)))throw fail('invalid_task_argument','只可确认当前执行批次的待处理输入');
      if(ids.length){this.engine.inputsDelivered(ticket.id,session.assignmentId,ids);this.engine.inputsRead(ticket.id,ids);session.pending=session.pending.filter(id=>!ids.includes(id));}
      const current=this.repo.tickets.get(ticket.id)!;
      return {stop:false,assignment_id:session.assignmentId,inputs:current.inputs.filter(input=>session.pending.includes(input.id)).map(input=>this.inputView(input)),...this.snapshot()};
    }else if(request.action==='report'){
      const session=this.currentSession(ticket,request,hostId!);
      if(ticket.ended||session.state==='stopped')throw fail('task_ended','任务已取消或结束，不能提交过期结果');
      if(!['progress','waiting','ready','blocked','failed','dropped'].includes(request.state??''))throw fail('invalid_task_argument','state 无效');
      if(request.state==='ready'&&(session.pending.length||ticket.undelivered.length))throw fail('unread_task_inputs','尚有用户输入未确认读取，不能完成任务');
      const summary=required(request.summary,'summary');
      const updated=this.engine.report(ticket.id,{state:request.state!,summary,...(request.question!==undefined?{question:request.question}:{})});
      if(updated.attention&&request.question)this.engine.reply({purpose:'attention',ticketId:ticket.id,question:updated.attention.question,text:updated.attention.question});
      if(request.state==='ready'||request.state==='dropped')this.engine.reply({purpose:'result',ticketId:ticket.id,text:summary});
      this.engine.turnEnded(ticket.id,session.assignmentId);
    }else if(request.action==='recover'){
      const assignment=latestAssignment(ticket);
      if(!assignment||assignment.id!==request.assignment_id||ticket.ended)throw fail('stale_assignment','任务批次已结束或已替换');
      const session=this.state.sessions[assignment.id];
      if(!session?.hostId)throw fail('assignment_not_owned','未开始的任务不需要恢复');
      // Recovery is explicit and records uncertainty as a blocker. It never auto-replays an external operation.
      this.engine.report(ticket.id,{state:'blocked',summary:'Host recovery required. '+required(request.reason,'reason',2000),
        question:'检查此前外部操作是否已经生效，再明确重试；不要重复结果不确定的操作。'});
      session.hostId=hostId;session.state='running';
    }else throw fail('unknown_task_action','未知任务操作');
    return {task:this.view(this.repo.tickets.get(ticket.id)!),...this.snapshot()};
  }
}

async function load(tx:KeyStore,scope:SuperAgentScope,at?:string) {
  const saved=await tx.get<State|StoredSnapshot>(PREFIX+scope.chatId);
  const state=saved&&'storage' in saved?await readSnapshot(tx,scope.chatId,saved):saved??empty(scope);
  if(state.version!==1)throw fail('super_agent_version','不支持的 Super Agent 数据版本');
  if(state.deviceId!==scope.deviceId||state.chatId!==scope.chatId)throw fail('device_forbidden','任务不属于当前电脑对话');
  return new Runtime(clone(state),scope,at);
}

async function authorizeOrigin(tx:KeyStore,runtime:Runtime,triggerId:string):Promise<void> {
  const authority=runtime.state.authorities[triggerId];
  if(!authority||!runtime.scope.authorizePrincipal)throw fail('task_authority_unavailable','任务原授权身份无法复核，暂不执行');
  await runtime.scope.authorizePrincipal(tx,authority);
}
function compactResult(result:any):any {
  const {mode,upstream,paused,repository,selected_task,host,tasks,candidates,tasks_total,tasks_more,tasks_cursor,task_counts,candidates_total,candidates_more,replies,...rest}=result;return rest;
}

/** Durable Object KV has a per-value limit. Chunk inside the same transaction, without dropping any history. */
interface StoredSnapshot {storage:'chunks-v1';chunks:number;length:number;digest:string}
const partKey=(chatId:string,index:number)=>PREFIX+chatId+':part:'+String(index).padStart(8,'0');
async function readSnapshot(tx:KeyStore,chatId:string,saved:StoredSnapshot):Promise<State> {
  let json='';
  for(let index=0;index<saved.chunks;index++){
    const part=await tx.get<string>(partKey(chatId,index));
    if(typeof part!=='string')throw fail('super_agent_state_corrupt','任务快照不完整，已停止执行');json+=part;
  }
  if(json.length!==saved.length||key(json)!==saved.digest)throw fail('super_agent_state_corrupt','任务快照校验失败，已停止执行');
  return JSON.parse(json) as State;
}
async function saveSnapshot(tx:KeyStore,state:State):Promise<void> {
  const previous=await tx.get<State|StoredSnapshot>(PREFIX+state.chatId),json=JSON.stringify(state),size=16000,chunks=Math.ceil(json.length/size);
  for(let index=0;index<chunks;index++)await tx.put(partKey(state.chatId,index),json.slice(index*size,(index+1)*size));
  if(previous&&'storage' in previous)for(let index=chunks;index<previous.chunks;index++)await tx.delete(partKey(state.chatId,index));
  await tx.put(PREFIX+state.chatId,{storage:'chunks-v1',chunks,length:json.length,digest:key(json)} satisfies StoredSnapshot);
}

/** Caller must authorize the principal against the conversation/device in THIS transaction. Only newly saved human messages enter here. */
export async function superAgentMessage(tx:KeyStore,message:SuperAgentMessage):Promise<any> {
  const runtime=await load(tx,message,message.at),fingerprint=key(message.text,JSON.stringify(message.attachments??[])),id='message:'+message.messageId;
  const previous=runtime.state.seen[id];if(previous){if(previous.fingerprint!==fingerprint)throw fail('request_key_conflict','同一消息 ID 内容发生变化');return {...clone(previous.result),...runtime.snapshot()};}
  runtime.state.authorities[key('bridge-trigger',message.chatId,message.messageId)]=normalizeIdentity(message.principal);
  // Invalid slash commands are durable human-visible feedback, not a lost human message. No partial core changes are retained.
  const before=clone(runtime.state);let result;
  try{
    const command=/^\/(task|retry)\s+(\S+)/.exec(message.text.trim());
    const target=command?runtime.resolve(command[2]):!message.text.trim().startsWith('/')&&runtime.state.selected?runtime.resolve(runtime.state.selected):undefined;
    if(target)await authorizeOrigin(tx,runtime,target.origin.triggerId);
    result=runtime.ingest(message);
  }catch(error){
    if(!message.text.trim().startsWith('/'))throw error;
    const clean=new Runtime(before,message,message.at);
    result={command:'error',reply:(error as Error).message,error:(error as {code?:string}).code??'task_command_failed',...clean.snapshot()};
    for(const name of Object.keys(runtime.state))delete (runtime.state as any)[name];
    Object.assign(runtime.state,clean.state);
  }
  runtime.state.seen[id]={fingerprint,result:clone(compactResult(result))};await saveSnapshot(tx,runtime.state);return result;
}

/** Caller must revalidate live chat ACL and (for HOST_ACTIONS) the writer credential in THIS transaction, including on retries. */
export async function superAgentTask(tx:KeyStore,scope:SuperAgentScope,request:TaskRequest,hostId?:string):Promise<any> {
  const runtime=await load(tx,scope);
  if(HOST_ACTIONS.has(request.action)&&!hostId)throw fail('model_connection_required','需要已验证的当前模型连接');
  const changing=MUTATING_ACTIONS.has(request.action)||request.action==='inputs';
  const requestKey=changing?required(request.request_key,'request_key',200):null;
  const id=requestKey?'request:'+key(principalScope(scope.principal),hostId??'human',requestKey):null;
  const fingerprint=key(JSON.stringify(request));
  if(['accept','ignore','attach'].includes(request.action))await authorizeOrigin(tx,runtime,key('bridge-trigger',scope.chatId,required(request.message_id,'message_id',100)));
  if(['attach','claim','inputs','report','retry','recover'].includes(request.action)){
    const ticket=runtime.resolve(request.task_id);
    const sources=new Set([ticket.origin.triggerId,...ticket.inputs.flatMap(input=>input.kind==='trigger'?[input.triggerId]:[])]);
    for(const triggerId of sources)await authorizeOrigin(tx,runtime,triggerId);
  }
  const previous=id&&runtime.state.seen[id];
  if(previous){
    if(previous.fingerprint!==fingerprint)throw fail('request_key_conflict','相同 request_key 参数不一致');
    // Never let an old successful poll/claim conceal a subsequent pause, cancellation or assignment replacement.
    if(request.action==='inputs'||request.action==='claim'){
      const ticket=runtime.resolve(request.task_id),assignment=latestAssignment(ticket);
      if(runtime.state.paused||ticket.ended||assignment?.id!==request.assignment_id)
        return {stop:true,reason:ticket.ended?.outcome??(runtime.state.paused?'paused':'stale_assignment'),...runtime.snapshot()};
    }
    return {...clone(previous.result),...runtime.snapshot()};
  }
  const result=runtime.dispatch(request,hostId);
  if(id)runtime.state.seen[id]={fingerprint,result:clone(compactResult(result))};
  if(changing)await saveSnapshot(tx,runtime.state);
  return result;
}

export async function superAgentErase(tx:KeyStore,chatId:string):Promise<void>{
  const saved=await tx.get<State|StoredSnapshot>(PREFIX+chatId);
  if(saved&&'storage' in saved)for(let index=0;index<saved.chunks;index++)await tx.delete(partKey(chatId,index));
  await tx.delete(PREFIX+chatId);
}

export interface SuperAgentOutbound {
  id:string;chatId:string;taskId?:string;replyTo?:string;text:string;kind:OutboundMessage['kind'];
}
/**
 * Bridge's internal channel adapter. The caller must keep this in the same Store transaction as task mutation and
 * saveReply. The callback writes normal chat history, not a network send. Any failure rolls back both the task and reply.
 * No bearer token, original private principal, or new host privilege crosses this boundary.
 */
export async function superAgentDrainOutbox(tx:KeyStore,scope:SuperAgentScope,
  saveReply:(message:SuperAgentOutbound)=>Promise<{messageId:string}>):Promise<{reply_id:string;message_id:string;saved:true;delivery_confirmed:false}[]> {
  const runtime=await load(tx,scope),receipts:{reply_id:string;message_id:string;saved:true;delivery_confirmed:false}[]=[];
  for(const row of Object.values(runtime.state.outbox)){
    if(row.status!=='pending')continue;
    const message=row.message;
    if(message.channel.source!=='computer-bridge'||message.channel.thread!==scope.chatId||message.channel.address.chat_id!==scope.chatId)
      throw fail('outbox_destination_mismatch','任务回复不属于当前对话，已停止保存');
    if(message.ticketId)await authorizeOrigin(tx,runtime,runtime.resolve(message.ticketId).origin.triggerId);
    const saved=await saveReply({id:message.id,chatId:scope.chatId,taskId:message.ticketId?runtime.alias(message.ticketId):undefined,
      replyTo:message.channel.address.message_id,text:message.text,kind:message.kind});
    row.status='sent';row.savedMessageId=required(saved.messageId,'saved message id',100);
    receipts.push({reply_id:message.id,message_id:row.savedMessageId,saved:true,delivery_confirmed:false});
  }
  if(receipts.length)await saveSnapshot(tx,runtime.state);
  return receipts;
}
