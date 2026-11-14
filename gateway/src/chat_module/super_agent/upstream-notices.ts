/** Unchanged pure projections and notice rules extracted from upstream app/cards.ts and app/notices.ts. */
import {key,latestReport,ticketStage,type Ticket,type WorkerReport} from './vendor/src/core/index.ts';
const SOURCE='github';
const pullNumber = (thread: string): number | undefined => thread.startsWith(`${SOURCE}:`) ? Number(thread.slice(SOURCE.length + 1)) : undefined
export const pullsOf = (ticket: Pick<Ticket, 'follows'>, open = false): number[] =>
  (ticket.follows ?? []).filter(item => !open || !item.closed).flatMap(item => pullNumber(item.thread) ?? [])
export const pullOf = (ticket: Pick<Ticket, 'follows'>): number | undefined => pullsOf(ticket, true).at(-1) ?? pullsOf(ticket).at(-1)
/** True when the PR was opened by the agent account from a branch in the configured repository (not a fork). */

export function preview(text: string): string { return text.replace(/\s+/g, ' ').slice(0, 160) }

/** The states a ticket card shows: an open ticket's stage (docs/003), and an ended ticket's outcome. */
export const TICKET_STATES = ['person/delivery', 'person/answer', 'person/review', 'person/blocked', 'person/failed', 'working', 'working/queued', 'idle',
  'completed', 'merged', 'closed', 'dropped', 'stopped'] as const
export type TicketCardState = typeof TICKET_STATES[number]
function cardState(ticket: Ticket): TicketCardState {
  if (ticket.ended) return ticket.ended.outcome
  const stage = ticketStage(ticket)
  if (stage.stage === 'person') return `person/${stage.action}`
  return stage.stage === 'idle' ? 'idle' : stage.stage === 'working' && stage.action ? 'working/queued' : 'working'
}
export function ticketCard(ticket: Ticket) {
  const ended = ticket.ended && { at: ticket.ended.at, by: ticket.ended.by, reason: ticket.ended.reason ?? ticket.ended.outcome }
  const { attention } = ticket
  return { ticket_id: ticket.id, title: ticket.title, state: cardState(ticket), strength: ticket.mandate.strength,
    ...(pullOf(ticket) ? { pr_number: pullOf(ticket) } : {}), ...(ended ? { ended } : {}),
    ...(attention ? { attention: { question: attention.question, ...attention.triggerId ? { trigger_id: attention.triggerId } : {} } } : {}),
    preview: preview(latestReport(ticket)?.summary ?? ''), read: `ticket/${ticket.id}` }
}

function brief(ticket: Ticket) {
  const { preview: _preview, ...card } = ticketCard(ticket)
  return card
}

export interface Relay { id: string; text: string }
/** What a follow-up asks of the main Session: nothing but a stop the person asks for, since its ticket's worker decides it. */
const FOLLOWUP_NOTE = 'Its ticket\'s worker has it and decides; act only if the person asks to stop the work '
  + '(orchestrator_route kind stop with this trigger_id).'

/**
 * A person's message that reached tickets, as the main Session hears of it: the message as their workers read it, and the
 * tickets it reached with their state. Their workers decide it; the main Session may only stop the work on it.
 */
export function followupRelay(message: { trigger_id: string },
  tickets: readonly { ticket_id: string; title: string; state: string; context?: boolean }[]): Relay {
  return { id: `followup:${message.trigger_id}`, text: JSON.stringify({ kind: 'follow_up', ...message, delivered_to: tickets,
    note: FOLLOWUP_NOTE }) }
}
/** Formats a worker report relay for the main Session (truncating summaries over 600 characters behind `ticket/<id>/result`); `replyTo` names the human question trigger it answers. */
export function resultRelay(ticket: Ticket, state: string, text: string, replyTo?: string): Relay {
  const id = key('worker-result', ticket.id, ticket.updatedAt, text)
  const summary = text.length > 600 ? { summary: text.slice(0, 600), chars: text.length } : { summary: text }
  const report = { kind: 'worker_report', ticket: brief(ticket), trigger_id: ticket.origin.triggerId, state, ...replyTo ? { answer_to: replyTo } : {},
    ...summary, read: `ticket/${ticket.id}/result` }
  return { id: `report:${id}`, text: JSON.stringify(report) }
}
/**
 * Converts a worker report recorded on `ticket` into a main-Session relay: a question for a person produces a
 * `worker_attention` relay, and a result, blocker, end, or answer to a question produces a `worker_report` relay, while
 * routine `progress` reports without `answers` stay internal.
 * @returns The steering `Relay`, or `undefined` when the report is not relayed to the main Session.
 */
export function reportRelay(ticket: Ticket, report: Pick<WorkerReport, 'state' | 'summary' | 'question' | 'answers'>): Relay | undefined {
  const asked = report.question ? ticket.attention : undefined
  if (asked) {
    return { id: `attention:${ticket.id}:${asked.id}`,
      text: JSON.stringify({ kind: 'worker_attention', ticket: brief(ticket), state: report.state, read: `ticket/${ticket.id}/result` }) }
  }
  if (report.state === 'progress' && !report.answers) return undefined
  return resultRelay(ticket, report.state, report.summary, report.answers)
}
