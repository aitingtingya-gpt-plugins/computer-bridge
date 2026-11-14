import {McpServer, createMcpHandler, inputRequired, isLegacyRequest,
  WebStandardStreamableHTTPServerTransport, type ServerContext, CLIENT_CAPABILITIES_META_KEY,ProtocolError} from "@modelcontextprotocol/server";
import {z} from "zod";
import type {ComputerHubCore} from "./hub";
import type {Data} from "./types";
import {toolSpecs,serverInstructions,helpText,promptText,approvalRouting} from "./contracts";
import {VERSION} from './releases';
import {commandDecision} from './approvals';
import {chatToolSpecs,chatInstructions,chatToolContext} from './chat_contracts';
import {hasToolPermission} from './tool_permissions';
import {admitMcpRequest} from './mcp_body';
import type {Actor} from './accounts';
import {toolObservationReceipt,type ObservedToolTicket} from './chat_module/tool_observation';
import {withToolObservationReceipt} from './chat_module/tool_observation_mcp';
import {resumeSummarySampling,afterReplySummarySampling,observeSamplingCapabilities} from './chat_module/summary_mcp';

// Admission must happen before parsing JSON on the gateway. Large file bytes
// belong to /transfers/, never an unbounded MCP request/response envelope.
const MAX_MCP_BODY=2*1024*1024;

const toolResult=(result:Data)=>({content:result.type==='image'?[result as any]:[{type:'text' as const,text:JSON.stringify(result)}]});

export function handler(hub: ComputerHubCore) {
  const factory = ({era}: {era: "modern" | "legacy"}) => {
    const server = new McpServer({name: "computer-bridge", version: VERSION}, {instructions:serverInstructions+' '+chatInstructions});
    server.server.registerCapabilities({events:{}} as any);
    for(const method of ['list','subscribe','unsubscribe'] as const)server.server.setRequestHandler('events/'+method,
      {params:z.record(z.string(),z.unknown()),result:z.record(z.string(),z.unknown())},async(args,ctx)=>{
        try{
          const actor=await hub.identity(String(ctx.http?.authInfo?.extra?.bridgeAccount || ''),Number(ctx.http?.authInfo?.extra?.bridgeEpoch));
          const caller=String(ctx.http?.authInfo?.extra?.bridgeCaller || '');
          return await hub.chats.events(method,args,actor,caller);
        }
        catch(error){
          const e=error as Data;
          const code=typeof e.code==='number'?e.code:typeof e.code==='string'&&e.code.startsWith('invalid_')?-32602:-32000;
          throw new ProtocolError(code,e.message,{...e.data,code:e.code});
        }
      });
    for (const [name, description, schema] of [...toolSpecs,...chatToolSpecs]) {
      const baseSchema=name.startsWith('computer.')?(schema as z.ZodObject<any>).extend({chat_context:chatToolContext}):schema as z.ZodObject<any>;
      const inputSchema=hasToolPermission(name) && name!=='computer.exec' ? baseSchema.extend({
        ...approvalRouting,...(name==='computer.lock_mode'?{request_key:z.string().optional()}:{}),
      }) : baseSchema;
      server.registerTool(name, {description, inputSchema, annotations: {
        // computer.* may now persist explicitly bound chat observations; mixed read/write tools cannot advertise read-only.
        readOnlyHint: ["chat.list","chat.channel","chat.history","chat.context","chat.working_context","chat.pending","chat.receipt"].includes(name),
        openWorldHint: name === "computer.exec",
      }}, async (args: any, ctx: ServerContext) => {
        let observation:ObservedToolTicket|undefined,actor:Actor|undefined;let caller='';
        const finish=async(response:any,output:any=response)=>{
          if(!observation||!actor)return response;
          let receipt=toolObservationReceipt(observation);
          try{receipt=await hub.chats.finishToolObservation(observation,output,actor,caller);}catch{/* The original result remains authoritative; capture is unavailable. */}
          return withToolObservationReceipt(response,receipt);
        };
        try {
          caller=String(ctx.http?.authInfo?.extra?.bridgeCaller || '');
          actor=await hub.identity(String(ctx.http?.authInfo?.extra?.bridgeAccount || ''),Number(ctx.http?.authInfo?.extra?.bridgeEpoch));
          if(name.startsWith('computer.')&&args.chat_context!==undefined){
            const binding=args.chat_context;args={...args};delete args.chat_context;
            observation=await hub.chats.beginToolObservation(binding,name,args,actor,caller);
          }
          const capabilities=era==='modern' ? (ctx.mcpReq.envelope as Data | undefined)?.[CLIENT_CAPABILITIES_META_KEY] : server.server.getClientCapabilities();
          const summaryContinuation=await resumeSummarySampling({name,args,ctx,actor,caller,hub});
          if(summaryContinuation!==undefined)return summaryContinuation;
          const requestState=ctx.mcpReq.requestState<string>();
          const commandTicket=typeof requestState==='string' && requestState.startsWith('command:') ? requestState.slice(8) : undefined;
          if(commandTicket !== undefined) {
            const record=await hub.approvals.resume(commandTicket,caller,name,args);
            const answer=ctx.mcpReq.inputResponses?.command as Data | undefined;
            if(answer && ['accept','decline','cancel'].includes(answer.action)) {
              const decision=commandDecision(answer.action);
              const result=await hub.approvalResult(record.id,decision,caller,actor);
              return finish(toolResult(result),result);
            }
          }
          await hub.checkToolPermission(name,args,actor);
          let confirmed = false;
          const confirmation = name === "computer.module_call"
            ? (await hub.modules.require(args.module)).confirmation(args.action) : undefined;
          if (confirmation) {
            if (era === "modern") {
              const state = ctx.mcpReq.requestState<string>();
              if (!state) {
                const ticket = await hub.humanTicket(args,actor);
                return finish(inputRequired({inputRequests: {confirm: {method: "elicitation/create", params: {
                  mode: "form", message: confirmation.message,
                  requestedSchema: confirmation.schema as any,
                }}}, requestState: ticket}),{state:'awaiting_host_input',executed:false});
              }
              await hub.consumeHumanTicket(state, args,actor);
              const answer = ctx.mcpReq.inputResponses?.confirm as Data | undefined;
              confirmed = answer?.action === "accept" && answer?.content?.start === true;
            } else {
              const answer = await ctx.mcpReq.elicitInput({mode: "form", message: confirmation.message,
                requestedSchema: confirmation.schema as any});
              confirmed = answer.action === "accept" && answer.content?.start === true;
            }
            if (!confirmed) return finish({content: [{type: "text", text: JSON.stringify({started: false})}]},{started:false});
          }
          const result = await hub.invoke(name, args, confirmed, ctx.mcpReq.signal,caller,actor);
          if(result.state==='awaiting_approval' && result.approval?.channel!=='chat') {
            const elicit=capabilities?.elicitation;
            const supportsForm=elicit !== undefined && ('form' in elicit || Object.keys(elicit).length===0);
            if(supportsForm) {
              const details=await hub.approvals.details(result.approval.id,caller);
              const params={mode:'form' as const,
                message:details.method
                  ? '批准本次工具调用。\n设备 '+details.device+'\n'+details.summary
                  : (details.permission_confirmation?'此电脑要求确认本次工具使用。\n':'')
                    +'批准本次命令以当前登录用户权限在工作区沙盒外运行。授权包含子进程及后续交互输入。\n'
                    +'设备 '+details.device+'\n目录 '+details.cwd+'\n命令\n'+details.command+'\n理由 '+details.justification,
                requestedSchema:{type:'object' as const,properties:{}}};
              if(era==='modern') {
                const ticket=commandTicket !== undefined ? commandTicket :
                  await hub.approvals.ticket(result.approval.id,caller,name,args);
                return finish(inputRequired({inputRequests:{command:{method:'elicitation/create',params}},
                  requestState:'command:'+ticket}),result);
              }
              const answer=await ctx.mcpReq.elicitInput(params);
              const decision=commandDecision(answer.action);
              const completed=await hub.approvalResult(result.approval.id,decision,caller,actor);
              return finish(toolResult(completed),completed);
            }
          }
          if(name==='chat.context'||name==='chat.resume')result.host_capabilities={sampling:observeSamplingCapabilities(era,capabilities)};
          return finish(toolResult(result),result);
        } catch (error) {
          const detail={error: {
            code: (error as any).code || "computer_error", message: String((error as Error).message),
            ...((error as any).request_state?{request_state:(error as any).request_state}:{}),
            ...((error as any).request_id?{request_id:(error as any).request_id,request_key:(error as any).request_key,device_id:(error as any).device_id,
              recover:(error as any).recover}:{})}};
          return finish({isError:true,content:[{type:'text',text:JSON.stringify(detail)}]},detail);
        }
      });
    }
    server.registerResource("computer-bridge-help", "computer-bridge://help", {mimeType: "text/plain"}, async uri => ({
      contents: [{uri: uri.href, text: helpText+'\n'+chatInstructions}],
    }));
    server.registerPrompt("computer-bridge", {description: "Select a registered computer and use its local tools."}, async () => ({
      messages: [{role: "user", content: {type: "text", text: promptText}}],
    }));
    return server;
  };
  const modern = createMcpHandler(factory, {legacy: "reject", responseMode: "auto", maxRequestBodySize: MAX_MCP_BODY});
  const sessions = new Map<string, {transport:WebStandardStreamableHTTPServerTransport;caller:string;account:string}>();
  return {async fetch(request: Request): Promise<Response> {
    const admitted=await admitMcpRequest(request);
    if(admitted instanceof Response)return admitted;
    request=admitted;
    const caller=request.headers.get('x-computer-bridge-caller') || '';
    const authInfo={token:'',clientId:caller,scopes:['computer'],extra:{bridgeCaller:caller,bridgeAccount:request.headers.get('x-computer-bridge-account'),bridgeEpoch:Number(request.headers.get('x-computer-bridge-epoch'))}};
    if (!await isLegacyRequest(request, undefined, {maxRequestBodySize: MAX_MCP_BODY})) {
      return modern.fetch(request,{authInfo});
    }
    const identity = request.headers.get("mcp-session-id");
    const saved=identity ? sessions.get(identity) : undefined;
    if(saved && (saved.caller!==caller || saved.account!==authInfo.extra.bridgeAccount)) return new Response('MCP session belongs to another account',{status:403});
    let transport = saved?.transport;
    if (identity && !transport) return new Response("MCP session ended; initialize a new connection", {status: 404});
    if (!transport) {
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        maxRequestBodySize: MAX_MCP_BODY,
        onsessioninitialized: id => {sessions.set(id,{transport:transport!,caller,account:authInfo.extra.bridgeAccount || ''});},
        onsessionclosed: id => {sessions.delete(id);},
      });
      const server = factory({era: "legacy"});
      transport.onclose = () => {if (transport!.sessionId) sessions.delete(transport!.sessionId);};
      await server.connect(transport);
    }
    return transport.handleRequest(request,{authInfo});
  }};
}

