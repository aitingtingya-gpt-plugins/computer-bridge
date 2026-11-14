import type {KeyStore} from '../../runtime';
import type {ChatPrincipal} from '../../chat_identity';
import type {ReportState} from './vendor/src/core/index.ts';
export type RepositoryBinding={provider:'github'|'cnb';url:string}|null;
export interface SuperAgentScope {chatId:string;deviceId:string;principal:ChatPrincipal;repository?:RepositoryBinding;authorizePrincipal?:(tx:KeyStore,principal:ChatPrincipal)=>Promise<void>}
export interface SuperAgentMessage extends SuperAgentScope {messageId:string;text:string;at:string;attachments?:unknown[]}
export const TASK_ACTIONS=['read','eval','eval_read','eval_decide','requeue','unsubscribe','action_done','list','detail','pending','instructions','discuss','accept','ignore','attach','stop','candidate_delivered','claim','started','inputs','inputs_delivered','inputs_read','delivery_failed','report','turn_ended','interrupted','reply','note','handback','request_status','follow','unfollow','thread_closed','cancel','retry','pause','resume','recover'] as const;
export type TaskAction=typeof TASK_ACTIONS[number];
export interface TaskRequest {
 action:TaskAction;active_only?:boolean;after?:number;limit?:number;task_id?:string;message_id?:string;message_ids?:string[];eval_id?:string;title?:string;scope?:string;summary?:string;reason?:string;assignment_id?:string;input_ids?:string[];state?:ReportState;question?:string|null;request_key?:string;
 pr_number?:number|null;pr_own?:boolean;resource?:string;offset?:number;assessment?:Record<string,unknown>;read?:Record<string,unknown>;action_id?:string;role?:'orchestrator'|'worker';text?:string;purpose?:'acknowledgement'|'answer'|'result'|'attention';acknowledgement?:string;name?:string;note?:string;reply_to_message_id?:string;question_for_message_id?:string;thread_id?:string;context_only?:boolean;outcome?:'merged'|'closed';at?:string;
}
export const HOST_ACTIONS=new Set<TaskAction>(['read','eval','eval_read','eval_decide','requeue','unsubscribe','action_done','instructions','pending','discuss','attach','accept','ignore','stop','candidate_delivered','claim','started','inputs','inputs_delivered','inputs_read','delivery_failed','report','turn_ended','interrupted','reply','note','handback','request_status','follow','unfollow','thread_closed','recover']);
export const MUTATING_ACTIONS=new Set<TaskAction>(TASK_ACTIONS.filter(action=>!['read','eval','eval_read','list','detail','pending','instructions','inputs'].includes(action)));
