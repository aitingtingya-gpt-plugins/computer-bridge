/** Transaction-local persistence ports for upstream Effects and Outbox; serialized by the enclosing Bridge transaction. */
import type {OutboundMessage,ReplyStatus,ChannelRef} from './vendor/src/core/index.ts';
import type {EffectKind} from './upstream-effects';
export interface Health {state:'starting'|'ready'|'paused'|'error';detail:string;at?:string}
export interface HealthEntry {get():Health|undefined;set(value:Health):void;release():void}
export interface HealthBoard {claim(name:string,initial?:Health):HealthEntry}
export interface EffectRecord {kind:EffectKind;key:string;value:string;seq:number;generation:number;attempts:number;error:string;due:number;since:string}
export class EffectRows {
  constructor(readonly rows:EffectRecord[]){}
  maxSequence(){return this.rows.reduce((max,row)=>Math.max(max,row.seq),0);}
  upsert(kind:EffectKind,key:string,value:string,seq:number,due:number,since:string){
    const row=this.rows.find(row=>row.kind===kind&&row.key===key);
    if(row)Object.assign(row,{value,generation:row.generation+1,attempts:0,error:'',due});
    else this.rows.push({kind,key,value,seq,due,since,generation:0,attempts:0,error:''});
  }
  pending(kind:EffectKind,key?:string){return this.rows.some(row=>row.kind===kind&&(key===undefined||row.key===key));}
  remove(kind:EffectKind,key:string){const at=this.rows.findIndex(row=>row.kind===kind&&row.key===key);if(at>=0)this.rows.splice(at,1);}
  ready(kind:EffectKind,now:number,ordered:boolean,limit:number){return this.rows.filter(row=>row.kind===kind&&(ordered||row.due<=now)).sort((a,b)=>a.seq-b.seq).slice(0,ordered?1:limit).map(row=>({...row}));}
  private owned(kind:EffectKind,key:string,seq:number,generation:number){return this.rows.find(row=>row.kind===kind&&row.key===key&&row.seq===seq&&row.generation===generation);}
  removeOwned(kind:EffectKind,key:string,seq:number,generation:number){const row=this.owned(kind,key,seq,generation);if(row)this.rows.splice(this.rows.indexOf(row),1);}
  reschedule(due:number,error:string|undefined,kind:EffectKind,key:string,seq:number,generation:number){const row=this.owned(kind,key,seq,generation);if(row){row.due=due;if(error!==undefined){row.attempts++;row.error=error;}}}
  summary(kind:EffectKind){const rows=this.rows.filter(row=>row.kind===kind);return {waiting:rows.length,since:rows.map(row=>row.since).sort()[0],attempts:Math.max(0,...rows.map(row=>row.attempts)),error:rows.filter(row=>row.attempts>0).sort((a,b)=>b.seq-a.seq)[0]?.error};}
  nextDue(){return this.rows.length?Math.min(...this.rows.map(row=>row.due)):undefined;}
}
export interface EffectStore {effects:EffectRows;afterCommit(body:()=>void):void}
export interface StoredReply {message:OutboundMessage;status:ReplyStatus;savedMessageId?:string;dropped?:{at:string;reason:string}}
export interface SavedReceipt extends OutboundMessage {status:ReplyStatus;dropped?:{at:string;reason:string}}
export interface ReceiptStore {
  atomic<T>(work:()=>T):T;
  receipts:{get(id:string):SavedReceipt|undefined;add(message:OutboundMessage):boolean;behind(id:string,failures:number):boolean;withdraw(id:string):boolean;settle(message:OutboundMessage,outcome:'sent'|'channelGone'|'channelIgnored'):void};
}
export interface ReplySource {
  instance(source:string):{enabled:boolean}|undefined;
  channelAllowed(channel:ChannelRef):boolean;
  send(message:OutboundMessage,commands:unknown):Promise<'sent'|'gone'|'waiting'>;
}
export function receiptStore(outbox:Record<string,StoredReply>,effects:EffectRecord[],atomic:<T>(work:()=>T)=>T):ReceiptStore{
  return {atomic,receipts:{
    get:id=>{const row=outbox[id];return row?{...structuredClone(row.message),status:row.status,...(row.dropped?{dropped:row.dropped}:{})}:undefined;},
    add:message=>{if(outbox[message.id])return false;outbox[message.id]={message:structuredClone(message),status:'pending'};return true;},
    behind:(id,failures)=>{const current=outbox[id];if(!current?.message.ticketId||current.status!=='pending')return false;
      for(const [otherId,row] of Object.entries(outbox)){
        if(otherId===id)break;
        if(row.status==='pending'&&row.message.ticketId===current.message.ticketId&&row.message.channel.source===current.message.channel.source&&row.message.channel.thread===current.message.channel.thread&&(effects.find(e=>e.kind==='reply'&&e.key===otherId)?.attempts??0)<failures)return true;
      }return false;},
    withdraw:id=>{if(outbox[id]?.status!=='pending')return false;delete outbox[id];return true;},
    settle:(message,outcome)=>{const row=outbox[message.id]??={message:structuredClone(message),status:'pending'};if(row.status!=='pending')return;row.status=outcome==='sent'?'sent':'dropped';if(outcome!=='sent')row.dropped={at:new Date().toISOString(),reason:outcome};},
  }};
}
