/** Bounded webhook failure evidence. Never retain payloads, callback URLs or credentials. */
import type {KeyStore} from '../runtime';

const categories=['http_rejected','edge_challenge','signature_rejected','timestamp_rejected','subscription_unavailable','authentication_rejected','permission_denied','rate_limited'] as const;
export type CallbackCategory=typeof categories[number];
export interface CallbackDiagnostic {at:string;phase:'verification'|'delivery';status:number;category:CallbackCategory;request_id?:string;cf_ray?:string;message_id?:string;generation?:number}
export const callbackDiagnosticsKey=(chat:string)=>'chat-callback-diagnostics:'+chat;
export const requestId=(value:unknown):value is string=>typeof value==='string'&&/^(?:req_[A-Za-z0-9_-]{8,100}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value);
export const cfRay=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{16}-[A-Z]{3}$/i.test(value);
const codeCategories:Record<string,CallbackCategory>={
  invalid_signature:'signature_rejected',invalid_webhook_signature:'signature_rejected',signature_verification_failed:'signature_rejected',webhook_signature_verification_failed:'signature_rejected',
  invalid_timestamp:'timestamp_rejected',timestamp_expired:'timestamp_rejected',stale_timestamp:'timestamp_rejected',webhook_timestamp_too_old:'timestamp_rejected',
  subscription_not_found:'subscription_unavailable',subscription_expired:'subscription_unavailable',subscription_disabled:'subscription_unavailable',webhook_not_found:'subscription_unavailable',webhook_disabled:'subscription_unavailable',
  authentication_error:'authentication_rejected',invalid_api_key:'authentication_rejected',invalid_token:'authentication_rejected',token_expired:'authentication_rejected',expired_token:'authentication_rejected',
  permission_denied:'permission_denied',insufficient_permissions:'permission_denied',rate_limit_exceeded:'rate_limited',rate_limited:'rate_limited',
};

export async function callbackFailure(response:Response):Promise<Omit<CallbackDiagnostic,'at'|'phase'>>{
  const result:Omit<CallbackDiagnostic,'at'|'phase'>={status:response.status,category:'http_rejected'};
  const id=response.headers.get('x-request-id')??response.headers.get('request-id'),ray=response.headers.get('cf-ray');
  if(requestId(id))result.request_id=id;if(cfRay(ray))result.cf_ray=ray;
  if(response.headers.get('cf-mitigated')==='challenge')result.category='edge_challenge';
  const reader=response.body?.getReader();if(!reader)return result;
  const timer=setTimeout(()=>{void reader.cancel().catch(()=>{});},250);
  try{
    let bytes=new Uint8Array();
    for(;;){const part=await reader.read();if(part.done)break;if(bytes.length+part.value.length>8192)return result;
      const merged=new Uint8Array(bytes.length+part.value.length);merged.set(bytes);merged.set(part.value,bytes.length);bytes=merged;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    for(const code of [body?.error?.code,body?.error?.type,body?.code,body?.type]){
      if(typeof code==='string'&&Object.hasOwn(codeCategories,code.toLowerCase())){result.category=codeCategories[code.toLowerCase()];break;}
    }
  }catch{/* A malformed/streaming rejection must not change its delivery outcome. */}
  finally{clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
  return result;
}

export async function readCallbackDiagnostics(tx:KeyStore,chat:string):Promise<CallbackDiagnostic[]>{
  const rows=await tx.get<CallbackDiagnostic[]>(callbackDiagnosticsKey(chat));
  return (rows??[]).slice(-8).map(row=>({at:row.at,phase:row.phase,status:row.status,category:row.category,
    ...(requestId(row.request_id)?{request_id:row.request_id}:{}),...(cfRay(row.cf_ray)?{cf_ray:row.cf_ray}:{}),
    ...(row.message_id&&/^m[1-9][0-9]*$/.test(row.message_id)?{message_id:row.message_id}:{}),
    ...(Number.isSafeInteger(row.generation)?{generation:row.generation}:{})}));
}
export async function recordCallbackDiagnostic(tx:KeyStore,chat:string,row:CallbackDiagnostic):Promise<void>{
  const rows=await readCallbackDiagnostics(tx,chat);await tx.put(callbackDiagnosticsKey(chat),[...rows,row].slice(-8));
}
