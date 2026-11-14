/** Read and model-attachment ports used by the original MasterAssessor. */
import type {Ticket} from './vendor/src/core/index.ts';
import {ticketCard} from './upstream-notices';
export interface Commands {withSignal(signal:AbortSignal):Commands;readRepositoryPath(path:string,kind:'file'|'directory'):Promise<string>}
export interface Deployment {stateDir:string;admissionContextTimeoutMs:{get():number};admissionContextMaxPages:{get():number}}
export interface ContextMessage {id:string;from:string;at:string;text:string;bot?:true;deleted?:true;reply_to?:string;url?:string;path?:string;line?:number}
export interface ContextPart {messages:ContextMessage[];next?:string;body:Record<string,unknown>;status?:string}
export interface TriggerContext {readonly messageId:string;read(commands:Commands,part:'thread'|'root'|'parent',cursor?:string):Promise<ContextPart>;images(text:string):string[];image(agent:unknown,commands:Commands,message:{id:string;text:string},key:string,stateDir:string,signal:AbortSignal):Promise<unknown>}
export const readRepositoryPath=(commands:Commands,path:string,kind:'file'|'directory')=>commands.readRepositoryPath(path,kind);
/** Slices text by UTF-16 code units so concatenated pages reconstruct the exact string. */
export function textPage(resource: string, text: string, offset: number, limit: number) {
  const end = Math.min(text.length, offset + limit)
  return { resource, offset, total_chars: text.length, next_offset: end < text.length ? end : null, text: text.slice(offset, end) }
}
export function relatedTickets(tickets: readonly Ticket[]) {
  const order = [...tickets].sort((a, b) => Number(!a.ended) === Number(!b.ended) ? b.createdAt.localeCompare(a.createdAt) : a.ended ? 1 : -1)
  return { related_tickets: order.slice(0, 8).map(ticketCard), tickets_total: tickets.length }
}
