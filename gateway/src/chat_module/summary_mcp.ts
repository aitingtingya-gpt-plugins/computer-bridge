/** Connects the summary producer to the actual caller's advertised MCP sampling capability. */
import {inputRequired,type ServerContext} from '@modelcontextprotocol/server';
import type {Actor} from '../accounts';
import {hash,type Data} from '../types';

type Era='modern'|'legacy';
interface SummaryHost {chats:{
  summaryProduction(action:'prepare'|'complete'|'cancel',args:Data,actor:Actor,caller:string):Promise<Data>;
  action(action:string,args:Data,actor:Actor,caller:string):Promise<Data>;
}}
interface Call {name:string;args:Data;ctx:ServerContext;actor:Actor;caller:string;hub:SummaryHost}
const result=(value:Data)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
function canonical(value:any):any {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export const summaryCallFingerprint=(name:string,args:Data)=>hash(JSON.stringify(canonical({name,args})));
/** Diagnostic facts only; advertising sampling is not evidence that any generation succeeded. */
export function observeSamplingCapabilities(era:Era,capabilities:unknown) {
  const sampling=capabilities&&typeof capabilities==='object'?(capabilities as Data).sampling:undefined;
  return {state:capabilities===undefined?'unobserved':sampling&&typeof sampling==='object'&&!Array.isArray(sampling)?'advertised':'not_advertised',
    source:era==='modern'?'request_envelope':'initialize',protocol_era:era,observed_at:new Date().toISOString()};
}
const failureReason=(error:unknown)=>{
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string'&&/^(summary_|invalid_summary|sensitive_context|chat_|device_|account_)/.test(code)?code:'summary_production_failed';
};
async function cancel(call:Call,ticket:string,fingerprint:string,reason:string):Promise<Data>{
  try{return await call.hub.chats.summaryProduction('cancel',{chat_id:call.args.chat_id,connection:call.args.connection,ticket,request_fingerprint:fingerprint,reason},call.actor,call.caller);}
  catch{return {state:'unavailable',reason:'summary_status_unpersisted'};}
}

/** Call before hub.invoke: a continuation must never execute chat.reply again. */
export async function resumeSummarySampling(call:Call) {
  const state=call.ctx.mcpReq.requestState<unknown>();
  if(typeof state!=='string'||!state.startsWith('summary:'))return undefined;
  if(call.name!=='chat.reply')return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:{code:'summary_ticket_invalid',message:'Summary state belongs only to its original reply call'}})}]};
  const ticket=state.slice('summary:'.length),fingerprint=await summaryCallFingerprint(call.name,call.args);
  let generation:Data;
  try{
    generation=await call.hub.chats.summaryProduction('complete',{chat_id:call.args.chat_id,connection:call.args.connection,ticket,
      request_fingerprint:fingerprint,response:call.ctx.mcpReq.inputResponses?.summary},call.actor,call.caller);
  }catch(error){
    const reason=failureReason(error);
    if(reason==='summary_sampling_invalid'||reason==='sensitive_context')generation=await cancel(call,ticket,fingerprint,'sampling_result_invalid');
    else generation={state:'blocked',reason};
  }
  // One fresh ticket per source segment. A repeated old continuation returns the
  // stored status instead of issuing that segment (or the original reply) again.
  if(generation.state==='ready')return inputRequired({inputRequests:{summary:inputRequired.createMessage(generation.request)},requestState:'summary:'+generation.ticket});
  // This is an authorized read of the original stable receipt, not a replay of a write.
  const receipt=await call.hub.chats.action('receipt',{chat_id:call.args.chat_id,request_key:call.args.request_key},call.actor,call.caller);
  return result({...receipt,summary_generation:generation});
}

/** Call only after a successful reply. Optional summary failures do not turn that saved reply into failure. */
export async function afterReplySummarySampling(call:Call&{result:Data;era:Era;capabilities:unknown}) {
  if(call.name!=='chat.reply'||call.result.saved!==true||call.result.chat?.mode!=='chat')return undefined;
  const observed=observeSamplingCapabilities(call.era,call.capabilities);
  const withGeneration=(generation:Data)=>result({...call.result,summary_generation:generation,host_capabilities:{sampling:observed}});
  if(observed.state!=='advertised')return withGeneration({state:'unavailable',reason:observed.state==='unobserved'?'sampling_capabilities_unobserved':'sampling_not_advertised'});
  const fingerprint=await summaryCallFingerprint(call.name,call.args);
  let prepared:Data;
  try{prepared=await call.hub.chats.summaryProduction('prepare',{chat_id:call.args.chat_id,connection:call.args.connection,
    operation_key:'reply:'+await hash(String(call.args.request_key)),reply_request_key:call.args.request_key,request_fingerprint:fingerprint},call.actor,call.caller);}
  catch(error){return withGeneration({state:'blocked',reason:failureReason(error)});}
  if(prepared.state!=='ready')return withGeneration(prepared);
  if(call.era==='modern')return inputRequired({inputRequests:{summary:inputRequired.createMessage(prepared.request)},requestState:'summary:'+prepared.ticket});
  for(;;){
    let sampled:unknown;
    try{sampled=await call.ctx.mcpReq.requestSampling(prepared.request,{timeout:90_000,signal:call.ctx.mcpReq.signal});}
    catch(error){
      // An explicit protocol rejection is different from a lost or timed-out model response.
      const code=(error as {code?:unknown})?.code;
      return withGeneration(await cancel(call,prepared.ticket,fingerprint,[-32700,-32600,-32601,-32602,-32021,-32022].includes(code as number)?'sampling_rejected':'sampling_outcome_unobserved'));
    }
    try{
      const generation=await call.hub.chats.summaryProduction('complete',{chat_id:call.args.chat_id,connection:call.args.connection,
        ticket:prepared.ticket,request_fingerprint:fingerprint,response:sampled},call.actor,call.caller);
      if(generation.state!=='ready')return withGeneration(generation);
      prepared=generation;
    }catch(error){return withGeneration(await cancel(call,prepared.ticket,fingerprint,failureReason(error)==='summary_sampling_invalid'?'sampling_result_invalid':'sampling_failed'));}
  }
}
