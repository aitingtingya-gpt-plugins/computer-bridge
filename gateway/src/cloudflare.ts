import {DurableObject} from "cloudflare:workers";
import {ComputerHubCore} from "./hub";
import {json, type Env} from "./types";
import type {DeviceSocket,Store,KeyStore,ListOptions} from "./runtime";
import {cloudflareWebhookFetch} from './webhook';

function keyStore(storage:DurableObjectStorage|DurableObjectTransaction):KeyStore{
  return {get:storage.get.bind(storage),put:storage.put.bind(storage),delete:storage.delete.bind(storage),
    list:<T>(options:ListOptions)=>{
      const {endBefore,...rest}=options;
      return storage.list<T>({...rest,...(endBefore?{end:endBefore}:{})});
    }};
}
function durableStore(storage:DurableObjectStorage):Store{
  return {...keyStore(storage),setAlarm:time=>storage.setAlarm(time),
    transaction:body=>storage.transaction(tx=>body(keyStore(tx)))};
}

/** Cloudflare is one runtime adapter; the service core is shared with ordinary Node.js. */
export class ComputerHub extends DurableObject<Env> {
  private core: ComputerHubCore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new ComputerHubCore({storage: durableStore(ctx.storage),waitUntil:work=>ctx.waitUntil(work),
      acceptWebSocket: (socket, tags) => ctx.acceptWebSocket(socket as WebSocket, tags),
      getWebSockets: tag => ctx.getWebSockets(tag).filter(socket=>socket.readyState===WebSocket.OPEN),
      equal: (a, b) => crypto.subtle.timingSafeEqual(a, b)}, {...env,RUNTIME:'cloudflare',webhookFetch:cloudflareWebhookFetch,
        updateServer:env.UPDATER?async body=>{
          const response=await env.UPDATER!.fetch('https://update/',{method:'POST',body:JSON.stringify(body)});
          const result=await response.json<Record<string,any>>();
          if(!response.ok)throw new Error(result.error);return result;
        }:undefined});
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if(url.pathname==='/chat/live') {
      const identity=JSON.parse(request.headers.get('x-computer-bridge-chat')!);
      const pair=new WebSocketPair();
      await this.core.acceptChat(pair[1],identity);
      return new Response(null,{status:101,webSocket:pair[0]});
    }
    if (url.pathname !== "/device/connect") return this.core.fetch(request);
    const id = url.searchParams.get("id")!;
    const key = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (!await this.core.authorizeDevice(id, key)) return json({error: "device_unauthorized"}, 401);
    const pair = new WebSocketPair();
    await this.core.acceptDevice(pair[1], id);
    return new Response(null, {status: 101, webSocket: pair[0]});
  }
  webSocketMessage(socket: DeviceSocket, message: string | ArrayBuffer) {return this.core.webSocketMessage(socket, message);}
  webSocketClose(socket: DeviceSocket, code: number, reason: string) {
    (socket as WebSocket).close();
    return this.core.webSocketClose(socket, code, reason);
  }
  webSocketError(socket: DeviceSocket) {return this.core.webSocketError(socket);}
  alarm() {return this.core.alarm();}
}
