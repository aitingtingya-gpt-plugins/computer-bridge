import {hash,opaque,type Data} from './types';
import type {KeyStore,Store} from './runtime';
import {References} from './references';

function canonical(value:any):any {
  if(Array.isArray(value)) return value.map(canonical);
  if(!value || typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}

/** Routing and receipt metadata only. Never persist tool bodies or file contents in the gateway. */
export class RequestRecords {
  constructor(private store:Store,private refs:References) {}

  async begin(device:string,method:string,args:Data,projection:Data,validateNew?:(tx:KeyStore)=>Promise<void>):Promise<Data> {
    const {request_key,_access,_guidance_stamps,...parameters}=args;
    const fingerprint=await hash(JSON.stringify(canonical({method,parameters})));
    if(typeof request_key==='string' && /^x[1-9][0-9]*$/.test(request_key)) {
      const reference=await this.refs.get(request_key);
      if(reference?.kind==='x') {
        const record=await this.get(request_key,device,projection.account);
        if(record.fingerprint!==fingerprint) throw Object.assign(new Error('原请求号的参数不同'),{code:'request_conflict'});
        return record;
      }
    }
    const index=request_key ? 'request-key:'+await hash(JSON.stringify([device,args.session || '',method,request_key,...(projection.account && projection.account!=='u1'?[projection.account]:[])])) : '';
    const raw=await this.store.transaction(async tx=>{
      const previous=index && await tx.get<string>(index);
      if(previous) {
        const record=(await tx.get<Data>('request:'+previous))!;
        if(record.fingerprint!==fingerprint) throw Object.assign(new Error('同一 request_key 的参数不同'),{code:'request_conflict'});
        return record;
      }
      await validateNew?.(tx);
      const id=opaque();
      const record={id,device,method,fingerprint,projection,created:Date.now(),state:'pending',claimed:false};
      await tx.put('request:'+id,record);
      if(index) await tx.put(index,id);
      return record;
    });
    return {...raw,short:await this.refs.assign('x',raw.id,'',{device})};
  }

  async get(id:string,device:string,account:string):Promise<Data> {
    const raw=await this.refs.raw(id);
    const record=await this.store.get<Data>('request:'+raw);
    if(!record || record.device!==device || (record.projection.account || 'u1')!==account) throw Object.assign(new Error('请求不属于这台电脑'),{code:'request_missing'});
    return {...record,short:await this.refs.assign('x',raw,'',{device})};
  }

  async received(id:string):Promise<void> {
    await this.store.transaction(async tx=>{
      const record=await tx.get<Data>('request:'+id);
      if(record && !record.received_at) await tx.put('request:'+id,{...record,received_at:Date.now()});
    });
  }

  async complete(id:string,claimed:boolean):Promise<void> {
    await this.store.transaction(async tx=>{
      const record=await tx.get<Data>('request:'+id);
      if(record) await tx.put('request:'+id,{...record,state:'completed',claimed,completed:record.completed || Date.now()});
    });
  }

  async list(device:string,account:string):Promise<Data[]> {
    const records=await this.store.list<Data>({prefix:'request:'});
    return Promise.all([...records.values()].filter(r=>r.device===device && (r.projection.account || 'u1')===account && !r.claimed && (r.state!=='completed' || r.completed>Date.now()-86400_000)).sort((a,b)=>b.created-a.created).slice(0,100).map(async r=>({
      request_id:await this.refs.assign('x',r.id,'',{device}),method:r.method,state:r.state,
      created_at:new Date(r.created).toISOString(),
    })));
  }
}
