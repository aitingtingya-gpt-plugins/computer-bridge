/** HTTP attachment policy. Deliberately no multipart ranges or optional tus extensions. */
export const TUS_VERSION='1.0.0';
export const MAX_ATTACHMENT_SIZE=1024*1024*1024;
export const MAX_PATCH_SIZE=8*1024*1024;
/** Do not let an uncooperative stream cancel callback retain upload locks forever. */
export async function cancelBody(reader:ReadableStreamDefaultReader<Uint8Array>|undefined):Promise<void>{
  if(!reader)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([reader.cancel().catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}
  finally{clearTimeout(timer);}
}
export function unsignedHeader(value:string|null):number|undefined {
  if(value===null||!/^\d+$/.test(value))return undefined;
  const n=Number(value);return Number.isSafeInteger(n)?n:undefined;
}
/** null means ignore malformed/unsupported Range, false means unsatisfiable. */
export function byteRange(value:string|null,size:number):{start:number;end:number}|null|false {
  if(!value)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||!match[1]&&!match[2])return null;
  if(!size)return false;
  if(!match[1]){const n=unsignedHeader(match[2]);return n===undefined?null:n===0?false:{start:Math.max(0,size-n),end:size-1};}
  const start=unsignedHeader(match[1]),end=match[2]?unsignedHeader(match[2]):size-1;
  if(start===undefined||end===undefined||match[2]&&end<start)return null;
  return start>=size?false:{start,end:Math.min(size-1,end)};
}
export function uploadMetadata(value:string|null):Record<string,string> {
  const result:Record<string,string>=Object.create(null);
  if(!value)return result;
  if(value.length>8192)throw Error('metadata too large');
  for(const entry of value.split(',')){
    const match=/^([A-Za-z0-9_-]+)(?: ([A-Za-z0-9+/]*={0,2}))?$/.exec(entry.trim());
    if(!match||Object.hasOwn(result,match[1]))throw Error('invalid metadata');
    const raw=match[2]??'';const binary=atob(raw);
    if(btoa(binary)!==raw)throw Error('invalid base64');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));
    if(/[\x00-\x1f\x7f]/.test(text))throw Error('invalid metadata');
    result[match[1]]=text;
  }
  return result;
}
