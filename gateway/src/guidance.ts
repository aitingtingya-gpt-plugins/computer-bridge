import type {Data} from './types';
import type {Store} from './runtime';

/** Only delivery stamps are retained; original instructions remain on their computer. */
export class Guidance {
  constructor(private storage:Store) {}

  async seen(context:string,device:string):Promise<Data> {
    return (await this.storage.get<Data>('guidance:'+context))?.[device] || {};
  }

  async deliver(context:string,device:string,result:Data):Promise<Data[]> {
    if(!('_guidance_stamps' in result)) return [];
    const documents:Data[]=result._guidance || [];
    const stamps:Data=result._guidance_stamps || {};
    delete result._guidance;delete result._guidance_stamps;
    return this.storage.transaction(async tx=>{
      const all=await tx.get<Data>('guidance:'+context) || {};
      const previous=all[device] || {};
      const updates=documents.filter(d=>d.removed ? previous[d.path]!=null :
        previous[d.path]?.content!==stamps[d.path]?.content);
      const merged={...previous,...stamps};
      if(JSON.stringify(previous)!==JSON.stringify(merged)) {
        all[device]=merged;
        await tx.put('guidance:'+context,all);
      }
      return updates;
    });
  }
}
