/** Snapshot-backed synchronous core ports. The enclosing Bridge transaction commits all state and effects together. */
import type {Decision, Repositories, Thread, Ticket, Trigger, TriggerDisposition} from './vendor/src/core/index.ts';
import {latestAssignment} from './vendor/src/core/index.ts';

export interface Records {
  triggers:Record<string,Trigger>;
  dispositions:Record<string,TriggerDisposition>;
  threads:Record<string,Thread>;
  tickets:Record<string,Ticket>;
  decisions:Record<string,Decision>;
}
export const emptyRecords=():Records=>({triggers:{},dispositions:{},threads:{},tickets:{},decisions:{}});
const clone=<T>(value:T):T=>structuredClone(value);
export class SnapshotRepositories implements Repositories {
  constructor(readonly records:Records){}
  atomic<T>(work:()=>T):T {
    const before=clone(this.records);
    try{return work();}catch(error){Object.assign(this.records,before);throw error;}
  }
  readonly triggers={
    get:(id:string)=>clone(this.records.triggers[id]),
    save:(value:Trigger)=>{this.records.triggers[value.id]=clone(value);},
    disposition:(id:string)=>clone(this.records.dispositions[id]),
    saveDisposition:(id:string,value:TriggerDisposition)=>{this.records.dispositions[id]=clone(value);},
  };
  readonly threads={
    get:(id:string)=>clone(this.records.threads[id]),
    save:(value:Thread)=>{this.records.threads[value.key]=clone(value);},
    list:()=>Object.values(this.records.threads).map(clone),
    active:()=>this.threads.list().filter(value=>value.pending.length>0||value.evaluating!==undefined),
  };
  readonly tickets={
    get:(id:string)=>clone(this.records.tickets[id]),
    save:(value:Ticket)=>{this.records.tickets[value.id]=clone(value);},
    list:()=>Object.values(this.records.tickets).reverse().map(clone),
    open:()=>this.tickets.list().filter(value=>!value.ended),
    active:()=>this.tickets.list().filter(value=>value.undelivered.length>0||['pending','running'].includes(latestAssignment(value)?.state??'')),
  };
  readonly decisions={
    get:(id:string)=>clone(this.records.decisions[id]),
    save:(value:Decision)=>{this.records.decisions[value.id]=clone(value);},
    byThread:(id:string)=>Object.values(this.records.decisions).filter(value=>value.threadKey===id).map(clone),
  };
}
