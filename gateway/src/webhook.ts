import ipaddr from 'ipaddr.js';

export function publicAddress(address:string):boolean{
  if(!ipaddr.isValid(address))return false;
  const value=ipaddr.process(address);
  return value.range()==='unicast';
}
export function callbackUrl(value:string):URL{
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.hash)throw new Error('回调必须使用无凭据的 HTTPS 地址');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(ipaddr.isValid(hostname) ? !publicAddress(hostname) :
    !hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname))
    throw new Error('回调必须指向公共网络');
  return url;
}

/** Workers' global fetch validates the connection destination at its public egress boundary.
 * Never use a VPC/service binding or resolveOverride here. Redirects are never followed.
 * https://developers.cloudflare.com/workers/reference/security-model/
 */
export async function cloudflareWebhookFetch(value:string,init:RequestInit):Promise<Response>{
  const url=callbackUrl(value);
  if(!ipaddr.isValid(url.hostname.replace(/^\[|\]$/g,''))){
    const answers=await Promise.all(['A','AAAA'].map(async type=>{
      const dns=new URL('https://cloudflare-dns.com/dns-query');dns.searchParams.set('name',url.hostname);dns.searchParams.set('type',type);
      const response=await fetch(dns,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:init.signal});
      if(!response.ok)throw new Error('回调 DNS 查询失败');
      const result=await response.json<{Status:number;Answer?:{type:number;data:string}[]}>();
      if(result.Status!==0 && result.Status!==3)throw new Error('回调 DNS 查询失败');
      return (result.Answer || []).filter(a=>a.type===1||a.type===28).map(a=>a.data);
    }));
    const addresses=answers.flat();
    if(!addresses.length || addresses.some(address=>!publicAddress(address)))throw new Error('回调 DNS 必须全部解析到公共地址');
  }
  // The Workers runtime uses its own resolver and rejects private/local destinations at connect time.
  const response=await fetch(url,{...init,redirect:'manual'});
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('回调不允许重定向');}
  return response;
}
