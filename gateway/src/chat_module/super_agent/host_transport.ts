import type {HostTransport} from './host';
import type {TaskRequest} from './types';
import {HostRequestRejected} from './host_errors';
export {HostRequestRejected} from './host_errors';

/** The Work/Dot host supplies its existing authenticated MCP tools/call capability. This creates no new account access. */
export function createMcpTaskTransport(callTool:(name:string,args:Record<string,unknown>)=>Promise<unknown>,
  binding:{chatId:string;connection:string}):HostTransport {
  return {task:async(request:TaskRequest)=>{
    let result:Record<string,any>;
    try{result=await callTool('chat.task',{...request,chat_id:binding.chatId,connection:binding.connection}) as Record<string,any>;}
    catch(error){
      const code=(error as {code?:string})?.code;
      const status=(error as any)?.status??(error as any)?.statusCode??(error as any)?.response?.status;
      if(status===401||status===403)throw new HostRequestRejected('The authenticated MCP endpoint rejected access','http_'+status);
      if(typeof code==='string'&&/^(account_|device_|task_|chat_|stale_|invalid_|model_|assignment_|request_key_|super_agent_|outbox_|unknown_|unread_)/.test(code))
        throw new HostRequestRejected(error instanceof Error?error.message:'The server rejected the request',code);
      throw error;
    }
    if(result?.isError){
      let detail:any=result.structuredContent;
      if(!detail){try{detail=JSON.parse(result.content?.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n')??'');}catch{}}
      const error=detail?.error??detail;
      throw new HostRequestRejected(typeof error?.message==='string'?error.message.slice(0,2000):'The authenticated chat.task tool rejected the operation',typeof error?.code==='string'?error.code:undefined);
    }
    if(result?.structuredContent&&typeof result.structuredContent==='object')return result.structuredContent;
    const text=Array.isArray(result?.content)?result.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n'):null;
    if(text){const decoded=JSON.parse(text);if(decoded&&typeof decoded==='object')return decoded;}
    // Direct in-process transports return the normalized action result; MCP transports use the shapes above.
    if(result&&typeof result==='object'&&('mode' in result||'task' in result||'assignment' in result))return result;
    throw new Error('chat.task returned no usable structured result; its outcome is unknown and must be recovered by repeating the original request and request_key');
  }};
}
