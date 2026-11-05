import {McpServer, createMcpHandler, inputRequired, isLegacyRequest,
  WebStandardStreamableHTTPServerTransport, type ServerContext, CLIENT_CAPABILITIES_META_KEY,ProtocolError} from "@modelcontextprotocol/server";
import {z} from "zod";
import type {ComputerHubCore} from "./hub";
import type {Data} from "./types";
import {toolSpecs,serverInstructions,helpText,promptText} from "./contracts";
import {VERSION} from './releases';
import {commandDecision} from './approvals';
import {chatToolSpecs,chatInstructions} from './chat_contracts';

export function handler(hub: ComputerHubCore) {
  const factory = ({era}: {era: "modern" | "legacy"}) => {
    const server = new McpServer({name: "computer-bridge", version: VERSION}, {instructions:serverInstructions+' '+chatInstructions});
    server.server.registerCapabilities({events:{}} as any);
    for(const method of ['list','subscribe','unsubscribe'] as const)server.server.setRequestHandler('events/'+method,
      {params:z.record(z.string(),z.unknown()),result:z.record(z.string(),z.unknown())},async(args,ctx)=>{
        const actor=await hub.identity(String(ctx.http?.authInfo?.extra?.bridgeAccount || ''),Number(ctx.http?.authInfo?.extra?.bridgeEpoch));
        const caller=String(ctx.http?.authInfo?.extra?.bridgeCaller || '');
        try{return await hub.chats.events(method,args,actor,caller);}
        catch(error){const e=error as Data;throw new ProtocolError(typeof e.code==='number'?e.code:-32602,e.message,e.data || {code:e.code});}
      });
    for (const [name, description, schema] of [...toolSpecs,...chatToolSpecs]) {
      server.registerTool(name, {description, inputSchema: schema as z.ZodObject<any>, annotations: {
        readOnlyHint: ["computer.recover", "computer.list", "computer.workspaces", "computer.image", "computer.skills", "computer.agents", "computer.jobs", "computer.modules", "computer.module_tools","chat.list","chat.history"].includes(name),
        openWorldHint: name === "computer.exec",
      }}, async (args: any, ctx: ServerContext) => {
        try {
          const caller=String(ctx.http?.authInfo?.extra?.bridgeCaller || '');
          const actor=await hub.identity(String(ctx.http?.authInfo?.extra?.bridgeAccount || ''),Number(ctx.http?.authInfo?.extra?.bridgeEpoch));
          const requestState=ctx.mcpReq.requestState<string>();
          const commandTicket=typeof requestState==='string' && requestState.startsWith('command:') ? requestState.slice(8) : undefined;
          if(commandTicket !== undefined) {
            const record=await hub.approvals.resume(commandTicket,caller,name,args);
            const answer=ctx.mcpReq.inputResponses?.command as Data | undefined;
            if(answer && ['accept','decline','cancel'].includes(answer.action)) {
              const decision=commandDecision(answer.action);
              const result=await hub.approvalResult(record.id,decision,caller,actor);
              return {content:[{type:'text',text:JSON.stringify(result)}]};
            }
          }
          let confirmed = false;
          const confirmation = name === "computer.module_call"
            ? (await hub.modules.require(args.module)).confirmation(args.action) : undefined;
          if (confirmation) {
            if (era === "modern") {
              const state = ctx.mcpReq.requestState<string>();
              if (!state) {
                const ticket = await hub.humanTicket(args,actor);
                return inputRequired({inputRequests: {confirm: {method: "elicitation/create", params: {
                  mode: "form", message: confirmation.message,
                  requestedSchema: confirmation.schema as any,
                }}}, requestState: ticket});
              }
              await hub.consumeHumanTicket(state, args,actor);
              const answer = ctx.mcpReq.inputResponses?.confirm as Data | undefined;
              confirmed = answer?.action === "accept" && answer?.content?.start === true;
            } else {
              const answer = await ctx.mcpReq.elicitInput({mode: "form", message: confirmation.message,
                requestedSchema: confirmation.schema as any});
              confirmed = answer.action === "accept" && answer.content?.start === true;
            }
            if (!confirmed) return {content: [{type: "text", text: JSON.stringify({started: false})}]};
          }
          const result = await hub.invoke(name, args, confirmed, ctx.mcpReq.signal,caller,actor);
          if(result.state==='awaiting_approval') {
            const capabilities=era==='modern' ? (ctx.mcpReq.envelope as Data | undefined)?.[CLIENT_CAPABILITIES_META_KEY] : server.server.getClientCapabilities();
            const elicit=capabilities?.elicitation;
            const supportsForm=elicit !== undefined && ('form' in elicit || Object.keys(elicit).length===0);
            if(supportsForm) {
              const details=await hub.approvals.details(result.approval.id,caller);
              const params={mode:'form' as const,
                message:'批准本次命令以当前登录用户权限在工作区沙盒外运行。授权包含子进程及后续交互输入。\n'
                  +'设备 '+details.device+'\n目录 '+details.cwd+'\n命令\n'+details.command+'\n理由 '+details.justification,
                requestedSchema:{type:'object' as const,properties:{}}};
              if(era==='modern') {
                const ticket=commandTicket !== undefined ? commandTicket :
                  await hub.approvals.ticket(result.approval.id,caller,name,args);
                return inputRequired({inputRequests:{command:{method:'elicitation/create',params}},
                  requestState:'command:'+ticket});
              }
              const answer=await ctx.mcpReq.elicitInput(params);
              const decision=commandDecision(answer.action);
              const completed=await hub.approvalResult(result.approval.id,decision,caller,actor);
              return {content:[{type:'text',text:JSON.stringify(completed)}]};
            }
          }
          if (name === "computer.image") return {content: [result as any]};
          if(name==='chat.attachment' && args.operation==='image')return {content:[result as any]};
          return {content: [{type: "text", text: JSON.stringify(result)}]};
        } catch (error) {
          return {isError: true, content: [{type: "text", text: JSON.stringify({error: {
            code: (error as any).code || "computer_error", message: String((error as Error).message),
            ...((error as any).request_state?{request_state:(error as any).request_state}:{}),
            ...((error as any).request_id?{request_id:(error as any).request_id,request_key:(error as any).request_key,device_id:(error as any).device_id,
              recover:(error as any).recover}:{})}})}]};
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
  const modern = createMcpHandler(factory, {legacy: "reject", responseMode: "auto", maxRequestBodySize: Number.MAX_SAFE_INTEGER});
  const sessions = new Map<string, {transport:WebStandardStreamableHTTPServerTransport;caller:string;account:string}>();
  return {async fetch(request: Request): Promise<Response> {
    const caller=request.headers.get('x-computer-bridge-caller') || '';
    const authInfo={token:'',clientId:caller,scopes:['computer'],extra:{bridgeCaller:caller,bridgeAccount:request.headers.get('x-computer-bridge-account'),bridgeEpoch:Number(request.headers.get('x-computer-bridge-epoch'))}};
    if (!await isLegacyRequest(request, undefined, {maxRequestBodySize: Number.MAX_SAFE_INTEGER})) {
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
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
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
