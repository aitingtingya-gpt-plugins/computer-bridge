/** Small, non-sensitive subscription audit. No payloads, identities, URLs or exception text. */
import type {KeyStore} from '../runtime';

export const MAX_MAINTENANCE_DIAGNOSTICS=8;
export const maintenanceDiagnosticsKey=(chat:string)=>'chat-maintenance-diagnostics:'+chat;
const phases=['entered','verification_passed','failed','stored','unsubscribed'] as const;
const operations=['subscribe','unsubscribe'] as const;
const categories=['invalid_request','invalid_callback','invalid_signing_key','connection_rejected','access_denied','chat_unavailable','callback_timeout','callback_verification_failed','unexpected_error'] as const;
export type MaintenanceDiagnosticPhase=typeof phases[number];
export type MaintenanceDiagnosticOperation=typeof operations[number];
export type MaintenanceDiagnosticCategory=typeof categories[number];
export interface MaintenanceDiagnostic {event:'chat.summary_due';operation:MaintenanceDiagnosticOperation;phase:MaintenanceDiagnosticPhase;at:string;error_category?:MaintenanceDiagnosticCategory}

export function maintenanceDiagnosticError(error:unknown):MaintenanceDiagnosticCategory{
 const e=error as {code?:unknown;name?:unknown;data?:{reason?:unknown}}|null;
 if(e?.code===-32015)return e.data?.reason==='timeout'?'callback_timeout':'callback_verification_failed';
 if(e?.code==='invalid_event_secret'||e?.name==='InvalidCharacterError')return 'invalid_signing_key';
 if(e?.code==='invalid_callback')return 'invalid_callback';
 if(['invalid_event','invalid_chat_argument','chat_mode_mismatch'].includes(String(e?.code)))return 'invalid_request';
 if(['chat_in_use','chat_not_connected','connection_expired','model_connection_required'].includes(String(e?.code)))return 'connection_rejected';
 if(['account_unavailable','device_forbidden','device_unauthorized'].includes(String(e?.code)))return 'access_denied';
 if(['chat_deleted','chat_not_found'].includes(String(e?.code)))return 'chat_unavailable';
 return 'unexpected_error';
}

/** Project even persisted rows through the allowlist before returning them to a chat reader. */
export async function readMaintenanceDiagnostics(tx:KeyStore,chat:string):Promise<MaintenanceDiagnostic[]>{
 const saved=await tx.get<unknown>(maintenanceDiagnosticsKey(chat));
 if(!Array.isArray(saved))return [];
 return saved.slice(-MAX_MAINTENANCE_DIAGNOSTICS).flatMap(value=>{
  if(!value||value.event!=='chat.summary_due'||!operations.includes(value.operation)||!phases.includes(value.phase)||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at)))return [];
  const row:MaintenanceDiagnostic={event:'chat.summary_due',operation:value.operation,phase:value.phase,at:new Date(Date.parse(value.at)).toISOString()};
  if(value.phase==='failed')row.error_category=categories.includes(value.error_category)?value.error_category:'unexpected_error';
  return [row];
 });
}
export async function recordMaintenanceDiagnostic(tx:KeyStore,chat:string,operation:MaintenanceDiagnosticOperation,phase:MaintenanceDiagnosticPhase,error?:unknown):Promise<void>{
 const rows=await readMaintenanceDiagnostics(tx,chat),row:MaintenanceDiagnostic={event:'chat.summary_due',operation,phase,at:new Date().toISOString()};
 if(phase==='failed')row.error_category=maintenanceDiagnosticError(error);
 await tx.put(maintenanceDiagnosticsKey(chat),[...rows,row].slice(-MAX_MAINTENANCE_DIAGNOSTICS));
}
