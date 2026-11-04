import {serveApplication} from "./application";
import type {Env} from "./types";
import {WorkerEntrypoint} from 'cloudflare:workers';
export {ComputerHub} from "./cloudflare";

export class Maintenance extends WorkerEntrypoint<Env> {
  async status(drain:boolean):Promise<Record<string,any>>{
    const stub=this.env.HUB.get(this.env.HUB.idFromName('shared'));
    const response=await stub.fetch('https://internal/internal/'+(drain?'drain':'busy'),{method:'POST',body:'{}'});
    return response.json();
  }
  async resume():Promise<void>{
    await this.env.HUB.get(this.env.HUB.idFromName('shared')).fetch('https://internal/internal/resume',{method:'POST',body:'{}'});
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const service = env.HUB.get(env.HUB.idFromName("shared"));
    return serveApplication(request, {PUBLIC_URL: env.PUBLIC_URL, BRIDGE_SECRET: env.BRIDGE_SECRET,
      OAUTH_KV: env.OAUTH_KV, service: request => service.fetch(request)}, ctx);
  },
};
