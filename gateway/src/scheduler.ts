import type {Store} from './runtime';

/** One native alarm, shared by independent maintenance and event delivery deadlines. */
export class HubScheduler {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private storage:Store){}
  private run(work:()=>Promise<void>):Promise<void>{
    const result=this.tail.then(work);this.tail=result.catch(()=>{});return result;
  }
  schedule(name:string,time:number):Promise<void>{
    return this.run(async()=>{
      const deadlines=await this.storage.get<Record<string,number>>('runtime:deadlines') || {};
      deadlines[name]=Math.min(deadlines[name]??Infinity,time);
      await this.storage.put('runtime:deadlines',deadlines);
      await this.storage.setAlarm(Math.max(Date.now()+10,Math.min(...Object.values(deadlines))));
    });
  }
  fired():Promise<void>{
    return this.run(async()=>{
      const deadlines=await this.storage.get<Record<string,number>>('runtime:deadlines') || {};
      for(const [name,time] of Object.entries(deadlines))if(time<=Date.now())delete deadlines[name];
      await this.storage.put('runtime:deadlines',deadlines);
      if(Object.keys(deadlines).length)await this.storage.setAlarm(Math.max(Date.now()+10,Math.min(...Object.values(deadlines))));
    });
  }
  store():Store{
    const base=this.storage;
    return {get:base.get.bind(base),put:base.put.bind(base),delete:base.delete.bind(base),
      list:base.list.bind(base),transaction:base.transaction.bind(base),
      setAlarm:time=>this.schedule('maintenance',time)};
  }
}
