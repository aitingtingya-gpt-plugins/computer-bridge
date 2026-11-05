import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {Readable} from 'node:stream';
import {callbackUrl,publicAddress} from '../webhook';

/** Resolve on every new connection; the addresses supplied to TLS are exactly those validated. */
export async function nodeWebhookFetch(value:string,init:RequestInit):Promise<Response>{
  const url=callbackUrl(value);
  const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length || addresses.some(item=>!publicAddress(item.address)))throw new Error('回调 DNS 必须全部解析到公共地址');
  return new Promise((resolve,reject)=>{
    const req=request(url.href,{method:init.method || 'POST',agent:false,signal:init.signal || undefined,
      headers:Object.fromEntries(new Headers(init.headers)),
      lookup:(_host,options,done)=>{
        if(options.all)done(null,addresses);
        else done(null,addresses[0].address,addresses[0].family);
      }},incoming=>{
      if(incoming.statusCode!>=300&&incoming.statusCode!<400){incoming.destroy();reject(new Error('回调不允许重定向'));return;}
      const headers=new Headers();
      for(const [key,value] of Object.entries(incoming.headers))for(const entry of Array.isArray(value)?value:value===undefined?[]:[value])headers.append(key,entry);
      resolve(new Response([204,205,304].includes(incoming.statusCode!)?null:Readable.toWeb(incoming) as unknown as ReadableStream,
        {status:incoming.statusCode!,headers}));
      if([204,205,304].includes(incoming.statusCode!))incoming.resume();
    });
    req.on('error',reject);req.end(init.body as string|Uint8Array|undefined);
  });
}
