import type {KeyStore} from '../../runtime';
import {applyGoalChange,applyGoalEvent,decodeGoalChange,emptyGoalFoldState,type GoalFoldState} from './vendor/fold';
import {GoalId} from './vendor/runtime';
import type {GoalOperation} from './vendor/domain';
import type {GoalSnapshot} from './vendor/types';
import {planProjectionDefinition} from './vendor/plan-projection';
export {parseGoalCommand} from './vendor/goal-command';
export {renderGoalRoundPrompt} from './vendor/goal-prompt';
import {PLAN_POLICY} from './vendor/plan-policy';

export type InteractionMode='normal'|'plan'|'auto';
export const PLAN_GUIDANCE=PLAN_POLICY.replaceAll('exit_plan_mode','chat.plan with operation="submit"').replaceAll('ask_user_question','a question in this chat')+
  '\n\nFor Bridge, submit with the current Chat connection, interaction_revision as expected_revision, and a stable request_key. End the turn and wait for the signed plan_review event. A chat reply or webhook HTTP success is not approval. Call chat.plan continue on that event; only proceed if claimed is true. After implementing an approved plan, call chat.plan finish for that review.';
export const interactionFail=(code:string,message:string)=>Object.assign(new Error(message),{code});
export const goalKey=(id:string)=>'chat-goal:'+id;
export const reviewKey=(chat:string,id:string)=>'chat-plan-review:'+chat+':'+id;
export const collaborationWakePrefix='chat-collaboration-wake:';
export const collaborationWakeKey=(chat:string,id:string)=>collaborationWakePrefix+chat+':'+id;
export const goalWakeId=(round:GoalRound)=>'goal:'+round.id;
export const planWakeId=(review:PlanReview)=>'plan:'+review.id;

export interface GoalRound {id:string;goal_id:string;revision:number;number:number;state:'queued'|'claimed';writer?:string}
type StoredFold=Omit<GoalFoldState,'seenGoalIds'>&{seenGoalIds:GoalSnapshot['id'][]};
export interface GoalRecord {fold:StoredFold;armed:boolean;writer?:string;round?:GoalRound;blocker?:string;blockerCount?:number}
export interface PlanReview {id:string;markdown:string;mode_revision:number;writer:string;state:'pending'|'rejected'|'approved'|'cancelled';
  decision?:'reject'|'normal'|'auto';reason?:string;continued_by?:string;finished?:boolean;source_message_ids?:string[];
  anchor_sequence?:number;created_revision?:number;updated_revision?:number}
export interface CollaborationWake {chat:string;id:string;kind:'goal_round'|'plan_review';ref:string;attempts:number;next_at:number|null}
export interface AutoToolGrant {chatId:string;writerId:string;revision:number;account:string;epoch:number;caller:string}
export const transferModeKey=(grant:AutoToolGrant)=>`${grant.chatId}:${grant.revision}:${grant.writerId}`;

export const newGoal=():GoalRecord=>({fold:{...emptyGoalFoldState(),seenGoalIds:[]},armed:false});
const unfold=(row:GoalRecord):GoalFoldState=>({...row.fold,seenGoalIds:new Set(row.fold.seenGoalIds)});
function checkpoint(row:GoalRecord,state:GoalFoldState):void{row.fold={...state,seenGoalIds:[...state.seenGoalIds]};}
export function goalView(row?:GoalRecord){
  const current=row?.fold.goal;
  return current?{...current,roundsStarted:row.fold.roundsStarted,activation:row.armed?'armed':'disarmed',
    ...(row.round?{round:{id:row.round.id,number:row.round.number,state:row.round.state}}:{})}:null;
}

export function changeGoal(row:GoalRecord,operation:GoalOperation,options:{objective?:string;reason?:{code:string;message:string}}={}):void{
  const state=unfold(row),current=state.goal,stamp=Math.max(state.updatedAt??0,Date.now());
  if(operation!=='create'&&!current)throw interactionFail('goal_not_found','当前没有目标');
  const currentRef=current?{id:current.id,revision:current.revision+1}:undefined;
  let change:unknown;
  if(operation==='clear')change={kind:'goal/change',version:1,operation,cleared:currentRef,clearedAt:stamp};
  else{
    let goal:GoalSnapshot;
    if(operation==='create')goal={id:GoalId('goal-'+crypto.randomUUID()),revision:1,objective:options.objective!,phase:'active',maxGoalRounds:256};
    else{
      const {blockedReason,...rest}=current!;
      goal={...rest,...currentRef!,phase:operation==='pause'?'paused':operation==='resume'?'active':operation==='complete'?'complete':operation==='block'?'blocked':current!.phase,
        ...(operation==='edit'?{objective:options.objective!,...(blockedReason?{blockedReason}:{})}:{}),
        ...(operation==='block'?{blockedReason:options.reason}: {})};
    }
    change={kind:'goal/change',version:1,operation,goal,roundsStarted:operation==='create'?0:state.roundsStarted,
      createdAt:operation==='create'?stamp:state.createdAt,updatedAt:stamp};
  }
  try{applyGoalChange(state,decodeGoalChange(change)!);}
  catch(error){throw interactionFail('goal_invalid_transition',(error as Error).message);}
  checkpoint(row,state);
  if(operation!=='edit')row.armed=operation==='create'||operation==='resume';
  row.blocker=undefined;row.blockerCount=undefined;
}

export function admitRound(row:GoalRecord,round:GoalRound):void{
  const state=unfold(row);
  applyGoalEvent(state,{type:'user/message',seq:round.number,data:{source:{kind:'goal',goalId:GoalId(round.goal_id),revision:round.revision,round:round.number}}});
  checkpoint(row,state);
}

// Bridge has no local DSH turn boundary. A committed shared mode change is a
// plan/mode event; reuse DSH's projection at that boundary.
export function projectPlanMode(previous:InteractionMode,next:InteractionMode):boolean{
  const p=planProjectionDefinition;
  const state=p.apply({...p.init(),active:previous==='plan'},{type:'plan/mode',data:{active:next==='plan'}});
  return p.wire.view(state).active;
}

export async function queueCollaborationWake(tx:KeyStore,chat:string,id:string,kind:CollaborationWake['kind'],ref:string):Promise<void>{
  const next_at=Date.now();
  await tx.put(collaborationWakeKey(chat,id),{chat,id,kind,ref,attempts:0,next_at} satisfies CollaborationWake);
  await tx.requestAlarm?.(next_at);
}
