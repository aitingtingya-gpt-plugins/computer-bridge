import type {OutboundMessage,Ticket} from './vendor/src/core/index.ts';
import type {Records} from './repository';
import type {SuperAgentMessageMeta} from './types';

export interface SuperAgentTicketSummary {
  task_id:string;
  id:string;
  title:string;
}

export interface SuperAgentMessageLookup {
  resolve(idOrAlias:string):SuperAgentTicketSummary|undefined;
  outboxByMessageId:Map<string,SuperAgentTicketSummary>;
}

const SLASH_COMMAND_PATTERN=/^\/(task-new|task-resume|tasks|task|new|cancel|stop|retry|pause|resume)(?:\s+([\s\S]*))?$/;
const TASK_COMMANDS=new Set(['task','cancel','stop','retry']);

/** Parse a Super Agent slash command for attribution without mutating state. */
export function parseSuperAgentCommand(text:string):{command:string;target?:string}|null {
  const match=SLASH_COMMAND_PATTERN.exec(text.trim());
  if(!match)return null;
  const command=match[1]!,body=match[2]?.trim()??'';
  if(!TASK_COMMANDS.has(command))return {command};
  const [target]=body.split(/\s+/);
  return {command,...(target?{target}:{})};
}

/** Build a read-only index from a persisted v1 or v2 Super Agent snapshot. */
export function buildLookupFromState(
  records:Pick<Records,'tickets'>,
  aliases:Record<string,string>,
  outbox:Record<string,{message:OutboundMessage;savedMessageId?:string}>,
):SuperAgentMessageLookup {
  const reverseAliases=new Map<string,string>();
  for(const [alias,ticketId]of Object.entries(aliases))reverseAliases.set(ticketId,alias);
  const summarize=(ticket:Ticket,fallbackId=ticket.id):SuperAgentTicketSummary=>({
    task_id:reverseAliases.get(ticket.id)??fallbackId,
    id:ticket.id,
    title:ticket.title,
  });
  const resolve=(idOrAlias:string):SuperAgentTicketSummary|undefined=>{
    const ticket=records.tickets[aliases[idOrAlias]??idOrAlias];
    return ticket?summarize(ticket,idOrAlias):undefined;
  };
  const outboxByMessageId=new Map<string,SuperAgentTicketSummary>();
  for(const row of Object.values(outbox)){
    if(!row.savedMessageId||!row.message.ticketId)continue;
    const ticket=records.tickets[row.message.ticketId];
    if(ticket)outboxByMessageId.set(row.savedMessageId,summarize(ticket));
  }
  return {resolve,outboxByMessageId};
}

export function commandAttribution(command:string|null,ticket?:Ticket,alias?:string):SuperAgentMessageMeta|undefined {
  if(!command)return undefined;
  if(TASK_COMMANDS.has(command)&&ticket&&alias)return {task_id:alias,task_title:ticket.title};
  return {sender_role:'master'};
}
