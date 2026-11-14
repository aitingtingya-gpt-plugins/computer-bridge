/** Original effect dispatch/backoff, with persistence supplied by Bridge's atomic snapshot. */
import {Effects} from './upstream-effects';
import {EffectRows,type EffectRecord,type HealthBoard,type Health} from './effect-store';
export {Later} from './upstream-effects';
export type {EffectKind,EffectPayloads} from './upstream-effects';
export type {EffectRecord} from './effect-store';
export {Outbox as PersistentOutbox} from './upstream-outbox';
export {receiptStore} from './effect-store';
export class PersistentEffects extends Effects {
  readonly storage:EffectRows;
  readonly queueHealth:Record<string,Health>;
  constructor(rows:EffectRecord[],now:()=>number=()=>Date.now()){
    const storage=new EffectRows(rows),health:Record<string,Health>={};
    const board:HealthBoard={claim:(name,initial)=>{if(initial)health[name]=initial;return {get:()=>health[name],set:value=>{health[name]=value;},release:()=>{delete health[name];}};}};
    super({effects:storage,afterCommit:body=>body()},board,now);
    this.storage=storage;this.queueHealth=health;
  }
  nextDue(){return this.storage.nextDue();}
  snapshot(){return this.storage.rows.map(row=>({...row,payload:JSON.parse(row.value)}));}
}
