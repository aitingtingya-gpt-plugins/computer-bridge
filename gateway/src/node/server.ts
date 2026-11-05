import {pathToFileURL} from "node:url";
import {installModules,type GatewayModule} from "../modules";
import {VERSION} from '../releases';
import {createServer} from "node:http";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {timingSafeEqual} from "node:crypto";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {WebSocketServer, WebSocket} from "ws";
import {ComputerHubCore} from "../hub";
import {serveApplication,authorizeChatLive} from "../application";
import {Database, SQLiteStore, OAuthKV} from "./storage";
import {chatBlobs} from './chat_blobs';
import {nodeWebhookFetch} from './webhook';
import type {ApplicationEnv, DeviceSocket} from "../runtime";

const modulePaths:string[]=JSON.parse(process.env.BRIDGE_MODULE_PATHS || '[]');
const modules:GatewayModule[]=[];
for(const path of modulePaths) modules.push((await import(pathToFileURL(resolve(path)).href)).default);
installModules(modules);

const publicUrl = new URL(process.env.PUBLIC_URL!).origin;
const secret = process.env.BRIDGE_SECRET!;
if (!secret || secret.length < 6) throw new Error("请在 .env 设置至少 6 位的 BRIDGE_SECRET 初始管理员密码。");
const data = resolve(process.env.DATA_DIR || "data");
mkdirSync(data,{recursive:true});
const db = new Database(resolve(data,"bridge.sqlite3"));
const storage = new SQLiteStore(db);

class Socket implements DeviceSocket {
  attachment: unknown;
  constructor(readonly ws: WebSocket, readonly tags: string[] = []) {}
  send(value: string): void {this.ws.send(value);}
  close(code: number, reason: string): void {this.ws.close(code,reason);}
  serializeAttachment(value: unknown): void {this.attachment = value;}
  deserializeAttachment(): unknown {return this.attachment;}
}
const sockets = new Set<Socket>();
const updateServer=process.env.BRIDGE_UPDATER_URL?async(value:Record<string,any>)=>{
  const response=await fetch(process.env.BRIDGE_UPDATER_URL!,{method:'POST',headers:{
    Authorization:'Bearer '+process.env.BRIDGE_UPDATER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(value)});
  const result=await response.json() as Record<string,any>;
  if(!response.ok)throw new Error(result.error);return result;
}:undefined;
const serviceSettings={PUBLIC_URL:publicUrl,BRIDGE_SECRET:secret,RUNTIME:'node' as const,
  GITHUB_RELEASE_TOKEN:process.env.GITHUB_RELEASE_TOKEN,updateServer,
  webhookFetch:nodeWebhookFetch,chatBlobs:chatBlobs(data)};
const core = new ComputerHubCore({storage,
  acceptWebSocket: (socket,tags) => {const s = socket as Socket;s.tags.push(...tags);sockets.add(s);},
  getWebSockets: tag => [...sockets].filter(s => s.tags.includes(tag) && s.ws.readyState === WebSocket.OPEN),
  equal: timingSafeEqual}, serviceSettings);
storage.onAlarm = () => core.alarm();
await storage.restoreAlarm();
void core.chats.start().catch(error=>console.error("chat_start",error.name));
const env: ApplicationEnv = {...serviceSettings,
  OAUTH_KV: new OAuthKV(db) as unknown as KVNamespace, service: request => core.fetch(request)};
const context = {waitUntil: (work: Promise<unknown>) => {void work.catch(console.error);},
  passThroughOnException: () => {}} as unknown as ExecutionContext;

let activePosts=0;
const server = createServer(async (incoming,outgoing) => {
  if(incoming.url?.startsWith('/internal-runtime/') && process.env.BRIDGE_UPDATER_TOKEN &&
      incoming.headers.authorization==='Bearer '+process.env.BRIDGE_UPDATER_TOKEN) {
    outgoing.setHeader('Content-Type','application/json');
    if(incoming.url.endsWith('/resume'))core.draining=false;
    outgoing.end(JSON.stringify(incoming.url.endsWith('/drain')?{ready:activePosts===0 && core.drain()}:
      {version:VERSION,install_id:process.env.BRIDGE_INSTALL_ID}));return;
  }
  if(!['GET','HEAD'].includes(incoming.method!)){
    activePosts++;
    let finished=false;
    const finish=()=>{if(!finished){finished=true;activePosts--;}};
    outgoing.once('finish',finish);outgoing.once('close',finish);
  }
  const abort = new AbortController();
  outgoing.on("close",() => {if (!outgoing.writableEnded) abort.abort();});
  try {
    const headers = new Headers();
    for (const [key,value] of Object.entries(incoming.headers)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(key,item);
    }
    const body = ["GET","HEAD"].includes(incoming.method!) ? undefined : Readable.toWeb(incoming);
    const request = new Request(new URL(incoming.url!,publicUrl),{
      method:incoming.method,headers,body,duplex:"half",signal:abort.signal} as RequestInit);
    const response = await serveApplication(request,env,context);
    outgoing.statusCode = response.status;
    for (const [key,value] of response.headers) if (key !== "set-cookie") outgoing.setHeader(key,value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie",cookies);
    if (response.headers.get('content-type')?.startsWith('text/event-stream')) outgoing.flushHeaders();
    if (response.body) await pipeline(Readable.fromWeb(response.body as any),outgoing);
    else outgoing.end();
  } catch (error) {
    if (abort.signal.aborted) return;
    console.error("http",(error as Error).message);
    if (!outgoing.headersSent) outgoing.writeHead(500,{"Content-Type":"application/json"});
    outgoing.end(JSON.stringify({error:(error as Error).message}));
  }
});
server.requestTimeout = 0;
const websocket = new WebSocketServer({noServer:true,maxPayload:0});
server.on("upgrade",(request,connection,head) => {
  void (async () => {
    const url = new URL(request.url!,publicUrl);
    const id = url.searchParams.get("id") || "";
    const key = request.headers.authorization?.replace(/^Bearer /,"") || "";
    let chatIdentity:Record<string,any>|undefined;
    if(url.pathname==='/chat/live') {
      const headers=new Headers();
      for(const [name,value] of Object.entries(request.headers))if(value!==undefined)
        headers.set(name,Array.isArray(value)?value.join(','):value);
      const result=await authorizeChatLive(new Request(url,{headers}),env);
      if(result instanceof Response) {
        connection.end(`HTTP/1.1 ${result.status} Unauthorized\r\nConnection: close\r\n\r\n`);return;
      }
      chatIdentity=result;
    } else if (url.pathname !== "/device/connect" || !await core.authorizeDevice(id,key)) {
      connection.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");return;
    }
    websocket.handleUpgrade(request,connection,head,ws => {
      const socket = new Socket(ws);
      let messages = chatIdentity?core.acceptChat(socket,chatIdentity):core.acceptDevice(socket,id);
      messages=messages.catch(error=>{console.error('websocket accept',error.message);socket.close(1008,'Chat access expired');});
      ws.on("message",data => {messages = messages.then(() => core.webSocketMessage(socket,data.toString()))
        .catch(error => {console.error("device",error.message);socket.close(1011,"Device transport error");});});
      ws.on("close",(code,reason) => {sockets.delete(socket);void core.webSocketClose(socket,code,reason.toString());});
      ws.on("error",error => {console.error("websocket",error.message);});
    });
  })().catch(error => {console.error("upgrade",error.message);connection.destroy();});
});
server.listen(Number(process.env.PORT || 8787),process.env.HOST || "127.0.0.1",() => {
  console.log(JSON.stringify({service:"computer-bridge",version:VERSION,public_url:publicUrl,
    host:process.env.HOST || "127.0.0.1",port:Number(process.env.PORT || 8787),data,
    install_id:process.env.BRIDGE_INSTALL_ID}));
});
async function stop(): Promise<void> {
  for (const socket of sockets) socket.ws.terminate();
  server.closeAllConnections();server.close();storage.close();await db.close();process.exit(0);
}
process.once("SIGINT",() => {void stop();});
process.once("SIGTERM",() => {void stop();});
