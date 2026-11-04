import {opaque,type Data} from './types';
import type {DeviceSocket,HubContext} from './runtime';

const interrupted=()=>Object.assign(new Error('连接已失效；原请求可继续恢复'),{code:'connection_interrupted'});
const elapsed=()=>Object.assign(new Error('本次等待已结束；请使用原请求号继续恢复'),{code:'request_pending'});
interface Pending {
  socket:DeviceSocket;
  device:string;
  accepted:boolean;
  receipt_id?:string;
  accept:()=>void;
  resolve:(value:any)=>void;
  reject:(error:Error)=>void;
}

/** Connection lifetime owns delivery only; durable execution belongs to the device. */
export class DeviceTransport {
  active=0;
  readonly pending=new Map<string,Pending>();
  private waiters=new Map<string,Set<()=>void>>();
  private writers=new Map<DeviceSocket,Promise<void>>();
  private acks=new Map<string,{resolve:()=>void,reject:(error:Error)=>void}>();
  private frames=new Map<string,string[]>();
  private reconnecting=new Map<string,number>();
  constructor(private ctx:HubContext,private received:(id:string)=>Promise<void>) {}

  socket(device:string):DeviceSocket|undefined {
    return this.ctx.getWebSockets(device).find(ws=>{
      const a=ws.deserializeAttachment() as Data;
      if(a.ready===undefined) {
        this.invalidate(ws,'server_upgrade_handshake');return false;
      }
      if(a.ready && a.transport_v2 && Date.now()-a.last_activity>35_000) {
        this.invalidate(ws,'application_health_stale');return false;
      }
      return a.ready && !a.failed;
    });
  }
  recovering(device:string):boolean {
    return (this.reconnecting.get(device) || 0)>Date.now() || !!this.waiters.get(device)?.size ||
      [...this.pending.values()].some(p=>p.device===device);
  }
  ready(ws:DeviceSocket,info:Data):void {
    const a=ws.deserializeAttachment() as Data;
    if(a.failed) return;
    this.reconnecting.delete(a.device_id);
    ws.serializeAttachment({...a,ready:true,last_activity:Date.now(),transport_v2:info.capabilities?.includes('transport_v2'),
      request_protocol:info.request_protocol});
    this.control(ws,{type:'hello_ack',capabilities:['transport_v2']});
    for(const wake of this.waiters.get(a.device_id) || []) wake();
  }
  close(ws:DeviceSocket,reason='connection_closed'):void {
    const a=ws.deserializeAttachment() as Data;
    ws.serializeAttachment({...a,ready:false,failed:true});
    if(a.ready && reason!=='connection_closed') this.reconnecting.set(a.device_id,Date.now()+30_000);
    for(const [key,ack] of this.acks) if(key.startsWith(a.connection_id+':')) {
      ack.reject(interrupted());this.acks.delete(key);
    }
    for(const p of this.pending.values()) if(p.socket===ws) p.reject(interrupted());
    for(const key of this.frames.keys()) if(key.startsWith(a.connection_id+':')) this.frames.delete(key);
    this.writers.delete(ws);
    if(a.ready) console.info(JSON.stringify({event:'connection_invalidated',device:a.device_id,
      connection:a.connection_id,reason,time:new Date().toISOString()}));
  }
  invalidate(ws:DeviceSocket,reason:string):void {
    this.close(ws,reason);
    ws.close(1012,reason);
  }
  control(ws:DeviceSocket,value:Data):void {
    const a=ws.deserializeAttachment() as Data;
    if(a.failed) throw interrupted();
    ws.send(JSON.stringify(value));
  }
  async send(ws:DeviceSocket,value:Data):Promise<void> {
    const previous=this.writers.get(ws) || Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{
      const text=JSON.stringify(value),a=ws.deserializeAttachment() as Data;
      if(a.failed) throw interrupted();
      if(text.length<=131072){this.control(ws,value);return;}
      const id=opaque();
      for(let offset=0,sequence=0;offset<text.length;sequence++) {
        let end=Math.min(offset+131072,text.length);
        const code=text.charCodeAt(end-1);
        if(code>=0xd800 && code<=0xdbff && end<text.length) end++;
        const last=end===text.length,key=a.connection_id+':'+id+':'+sequence;
        let timer:ReturnType<typeof setTimeout>|undefined;
        const ack=a.request_protocol===1 && (sequence%8===7 || last)
          ?new Promise<void>((resolve,reject)=>{
            this.acks.set(key,{resolve,reject});timer=setTimeout(()=>reject(interrupted()),10_000);
          }):undefined;
        try {
          this.control(ws,{type:'frame',id,data:text.slice(offset,end),last,sequence});
          if(ack) await ack;
        } finally {if(timer)clearTimeout(timer);this.acks.delete(key);}
        offset=end;
      }
    });
    this.writers.set(ws,work);
    void work.finally(()=>{if(this.writers.get(ws)===work)this.writers.delete(ws);}).catch(()=>{});
    return work;
  }
  /** Return business messages; transport messages never enter a business queue. */
  async message(ws:DeviceSocket,message:string):Promise<Data|undefined> {
    let value:Data=JSON.parse(message);
    const a=ws.deserializeAttachment() as Data;
    if(a.failed) return;
    ws.serializeAttachment({...a,last_activity:Date.now()});
    if(value.type==='heartbeat') {
      this.control(ws,{type:'heartbeat_ack',id:value.id});return;
    }
    if(value.type==='frame_ack') {
      this.acks.get(a.connection_id+':'+value.id+':'+value.sequence)?.resolve();return;
    }
    if(value.type==='request_received') {
      const p=this.pending.get(value.id);
      if(p?.socket===ws && p.receipt_id===value.request_id) {
        p.accepted=true;p.accept();if(p.receipt_id) await this.received(p.receipt_id);
      }
      return;
    }
    if(value.type==='frame') {
      const key=a.connection_id+':'+value.id;
      const parts=this.frames.get(key) || [];
      parts.push(value.data);this.frames.set(key,parts);
      if(a.transport_v2 && (value.sequence%8===7 || value.last))
        this.control(ws,{type:'frame_ack',id:value.id,sequence:value.sequence});
      if(!value.last) return;
      this.frames.delete(key);value=JSON.parse(parts.join(''));
    }
    if(value.type==='response') {
      const p=this.pending.get(value.id);
      if(p?.socket!==ws) return;
      if(value.error) p.reject(Object.assign(new Error(value.error.message),{code:value.error.code,device_response:true,
        ...(p.receipt_id && value.receipt?.request_id===p.receipt_id && value.receipt?.state==='completed'
          ?{receipt_state:'completed'}:{})}));
      else p.resolve(value.result);
      return;
    }
    return value;
  }
  async rpc(device:string,method:string,params:Data,confirmed:boolean,signal:AbortSignal,receipt?:Data,
    deadline=Date.now()+30_000):Promise<any> {
    this.active++;
    try {
    while(true) {
      if(signal.aborted) throw signal.reason;
      if(Date.now()>=deadline) throw elapsed();
      try {
        const ws=await this.wait(device,signal,deadline);
        const remaining=Math.max(0,deadline-Date.now());
        // Poll the original execution within the caller's remaining network budget.
        const args=method==='bridge.recover'?{...params,seconds:Math.min(params.seconds || 0,Math.max(0,(remaining-100)/1000))}:params;
        return await this.once(ws,device,method,args,confirmed,signal,deadline,receipt);
      } catch(error) {
        if(signal.aborted || (error as Data).code!=='connection_interrupted' ||
          (!receipt && method!=='bridge.recover' && method!=='bridge.ping')) throw error;
      }
    }
    } finally {this.active--;}
  }
  private async wait(device:string,signal:AbortSignal,deadline:number):Promise<DeviceSocket> {
    while(true) {
      const ws=this.socket(device);if(ws) return ws;
      await new Promise<void>((resolve,reject)=>{
        const listeners=this.waiters.get(device) || new Set<()=>void>();this.waiters.set(device,listeners);
        const finish=(error?:Error)=>{clearTimeout(timer);listeners.delete(ready);if(!listeners.size)this.waiters.delete(device);
          signal.removeEventListener('abort',abort);error?reject(error):resolve();};
        const ready=()=>finish(),abort=()=>finish(signal.reason);
        const timer=setTimeout(()=>finish(elapsed()),Math.max(0,deadline-Date.now()));
        listeners.add(ready);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
    }
  }
  private async once(ws:DeviceSocket,device:string,method:string,params:Data,confirmed:boolean,signal:AbortSignal,
    deadline:number,receipt?:Data):Promise<any> {
    const id=opaque(),a=ws.deserializeAttachment() as Data;
    let delivery:ReturnType<typeof setTimeout>|undefined;
    const promise=new Promise((resolve,reject)=>this.pending.set(id,{socket:ws,device,accepted:false,receipt_id:receipt?.id,
      accept:()=>{if(delivery)clearTimeout(delivery);},resolve,reject}));
    const abort=()=>this.pending.get(id)?.reject(signal.reason);
    const timer=setTimeout(()=>this.pending.get(id)?.reject(elapsed()),Math.max(0,deadline-Date.now()));
    signal.addEventListener('abort',abort,{once:true});
    const start=Date.now();
    void this.send(ws,{type:'request',id,method,params,confirmed,
      ...(receipt?{request_id:receipt.id,fingerprint:receipt.fingerprint}:{})}).then(()=>{
        if(!this.pending.has(id)) return;
        if(a.transport_v2) {
          if(!this.pending.get(id)?.accepted) delivery=setTimeout(()=>this.invalidate(ws,'delivery_timeout'),10_000);
        } else if(method!=='bridge.ping') {
          // Older devices can prove their application channel using the existing ping method.
          void this.once(ws,device,'bridge.ping',{},false,signal,Math.min(deadline,Date.now()+10_000))
            .catch(()=>{if(!signal.aborted && this.pending.has(id))this.invalidate(ws,'legacy_probe_timeout');});
        }
      }).catch(()=>this.invalidate(ws,'send_failed'));
    try {if(signal.aborted)abort();return await promise;}
    finally {
      clearTimeout(timer);if(delivery)clearTimeout(delivery);this.pending.delete(id);signal.removeEventListener('abort',abort);
      console.info(JSON.stringify({event:'request_wait_end',device,connection:a.connection_id,
        request:receipt?.short,method,elapsed_ms:Date.now()-start,time:new Date().toISOString()}));
    }
  }
}
