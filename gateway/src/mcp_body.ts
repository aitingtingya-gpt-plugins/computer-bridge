import {cancelBody} from './attachment_http';

/** Bounded control-message admission. Binary files use the separate streaming routes. */
export async function admitMcpRequest(request:Request,{maximum=2*1024*1024,idleMs=30_000,totalMs=120_000}={}):Promise<Request|Response>{
  if(!request.body)return request;
  const reader=request.body.getReader(),deadline=Date.now()+totalMs;
  const reject=(status:number,error:string)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
  const declared=request.headers.get('Content-Length');
  if(declared&&/^\d+$/.test(declared)&&Number(declared)>maximum){await cancelBody(reader);return reject(413,'Use computer.transfer for large files');}
  let bytes=new Uint8Array(Math.min(65536,maximum)),length=0;
  try{
    for(;;){
      if(request.signal.aborted||Date.now()>=deadline)return reject(408,'MCP request body timed out');
      let timer:ReturnType<typeof setTimeout>|undefined;
      let aborted:()=>void=()=>{};
      const part=await Promise.race([reader.read(),new Promise<never>((_,fail)=>{
        const stop=()=>fail(Object.assign(new Error('MCP body timeout'),{code:'mcp_body_timeout'}));
        timer=setTimeout(stop,Math.max(1,Math.min(idleMs,deadline-Date.now())));
        aborted=stop;request.signal.addEventListener('abort',aborted,{once:true});if(request.signal.aborted)stop();
      })]).finally(()=>{clearTimeout(timer);request.signal.removeEventListener('abort',aborted);});
      if(part.done)break;
      if(length+part.value.length>maximum)return reject(413,'Use computer.transfer for large files');
      if(length+part.value.length>bytes.length){const grown=new Uint8Array(Math.min(maximum,Math.max(length+part.value.length,bytes.length*2)));grown.set(bytes);bytes=grown;}
      bytes.set(part.value,length);length+=part.value.length;
    }
    return new Request(request,{body:bytes.subarray(0,length),duplex:'half'} as RequestInit);
  }catch(error){
    if((error as {code?:string}).code==='mcp_body_timeout')return reject(408,'MCP request body timed out');
    return reject(request.signal.aborted?408:400,'MCP request body interrupted');
  }finally{await cancelBody(reader);}
}
