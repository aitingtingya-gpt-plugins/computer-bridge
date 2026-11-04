import type {DeviceSocket} from './runtime';

export interface LatencyReading {
  latency_ms:number|null;
  latency_state:'ok'|'timeout'|'offline'|'unavailable';
  latency_checked_at:string;
}

interface Sample {
  expires:number;
  result:Promise<LatencyReading>;
}

/** Demand-only RTT samples belong to actual sockets, never to durable device records. */
export class ConnectionLatency {
  private samples=new Map<DeviceSocket,Sample>();
  constructor(private socket:(device:string)=>DeviceSocket|undefined,
    private probe:(device:string,signal:AbortSignal)=>Promise<unknown>) {}

  read(device:string,force=false):Promise<LatencyReading> {
    const socket=this.socket(device);
    if(!socket) return Promise.resolve({latency_ms:null,latency_state:'offline',latency_checked_at:new Date().toISOString()});
    const cached=this.samples.get(socket);
    if(cached && (cached.expires===Infinity || !force && cached.expires>performance.now())) return cached.result;
    const sample:Sample={expires:Infinity,result:this.measure(device)};
    sample.result=sample.result.finally(()=>{sample.expires=performance.now()+5000;});
    this.samples.set(socket,sample);
    return sample.result;
  }

  private async measure(device:string):Promise<LatencyReading> {
    const controller=new AbortController();
    const signal=controller.signal;
    const deadline=setTimeout(()=>controller.abort(),2000);
    const start=performance.now();
    let state:LatencyReading['latency_state']='ok';
    let milliseconds:number|null=null;
    try {
      await this.probe(device,signal);
      milliseconds=Math.round((performance.now()-start)*100)/100;
    } catch {
      state=!this.socket(device)?'offline':signal.aborted?'timeout':'unavailable';
    } finally {
      clearTimeout(deadline);
    }
    return {latency_ms:milliseconds,latency_state:state,latency_checked_at:new Date().toISOString()};
  }

  clear(socket:DeviceSocket):void {this.samples.delete(socket);}
}
