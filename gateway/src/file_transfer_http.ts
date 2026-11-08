import type {Store} from './runtime';
import {hash,json,opaque,type Data} from './types';
import {byteRange,unsignedHeader,MAX_PATCH_SIZE,cancelBody} from './attachment_http';
import {transferClientSource,transferClientSha256} from './transfer_client';

/** Only routing metadata is stored here. File bytes stay on the executor and computer. */
export interface FileTransferGrant {
  id:string; device:string; session:string; account:string; epoch:number; revision:number;
  transfer_id:string; direction:'upload'|'download'; size:number; sha256:string; etag?:string;
  expires_at:number;
}
const CHUNK=256*1024,TTL=3600_000;
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const encode=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const hex=(value:ArrayBuffer)=>[...new Uint8Array(value)].map(b=>b.toString(16).padStart(2,'0')).join('');

export class FileTransferHttp {
  private active=new Set<string>();
  private signingKey:Promise<CryptoKey>;
  constructor(private store:Store,secret:string,private publicUrl:string,
    private authorize:(grant:FileTransferGrant)=>Promise<void>,
    private rpc:(grant:FileTransferGrant,action:string,args:Data,signal:AbortSignal)=>Promise<Data>){
    this.signingKey=crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  }
  private message(grant:FileTransferGrant){return new TextEncoder().encode('computer-bridge-file-transfer-v1\n'+JSON.stringify(grant));}
  async issue(result:Data,projection:Data,epoch:number):Promise<Data>{
    if(!/^[a-f0-9]{32}$/.test(result.transfer_id)||!Number.isSafeInteger(result.size)||result.size<0||!/^[a-f0-9]{64}$/.test(result.sha256))throw fail('transfer_invalid','Invalid computer transfer metadata');
    const direction=projection.args.action==='upload_begin'?'upload':'download';
    const index='file-transfer-index:'+await hash(JSON.stringify([projection.account,projection.device,projection.args.session,result.transfer_id]));
    const grant=await this.store.transaction(async tx=>{
      const old=await tx.get<string>(index),existing=old?await tx.get<FileTransferGrant>('file-transfer:'+old):undefined;
      if(existing&&existing.expires_at>Date.now()&&existing.epoch===epoch&&existing.revision===projection.transfer_revision)return existing;
      if(existing)await tx.delete('file-transfer:'+existing.id);
      const grant:FileTransferGrant={id:opaque(),device:projection.device,session:projection.args.session,
        account:projection.account,epoch,revision:projection.transfer_revision,transfer_id:result.transfer_id,
        direction,size:result.size,sha256:result.sha256,...(result.etag?{etag:result.etag}:{}),expires_at:Date.now()+TTL};
      await tx.put('file-transfer:'+grant.id,grant);await tx.put(index,grant.id);return grant;
    });
    await this.authorize(grant);
    await this.store.setAlarm(grant.expires_at);
    const signature=hex(await crypto.subtle.sign('HMAC',await this.signingKey,this.message(grant)));
    return {url:this.publicUrl+'/transfers/'+grant.id,headers:{Authorization:'Bearer '+signature},
      expires_at:new Date(grant.expires_at).toISOString(),direction,max_patch_size:MAX_PATCH_SIZE,
      client_url:this.publicUrl+'/transfers/'+grant.id+'/client',client_sha256:transferClientSha256,
      ...(direction==='upload'?{commit_url:this.publicUrl+'/transfers/'+grant.id+'/commit'}:{}),
      instructions:'Use the executor transfer helper. Keep this short-lived, single-file credential private; never send file chunks through model messages.'};
  }
  private async call(grant:FileTransferGrant,action:string,args:Data,signal:AbortSignal):Promise<Data>{
    if(grant.expires_at<=Date.now())throw fail('transfer_expired','Transfer credential expired');
    await this.authorize(grant);
    const result=await this.rpc(grant,action,args,AbortSignal.any([signal,AbortSignal.timeout(30_000)]));
    await this.authorize(grant);
    if(result.transfer_id!==grant.transfer_id||result.size!==grant.size||result.sha256&&result.sha256!==grant.sha256)throw fail('transfer_changed','Computer transfer identity changed');
    return result;
  }
  async fetch(request:Request):Promise<Response>{
    const match=/^\/transfers\/([a-f0-9]{64})(\/(?:commit|client))?$/.exec(new URL(request.url).pathname);
    if(!match)return json({error:'transfer_missing'},404);
    let held:string|undefined;
    try{
      const grant=await this.store.get<FileTransferGrant>('file-transfer:'+match[1]);
      if(!grant||grant.expires_at<=Date.now())throw fail('transfer_expired','Transfer credential expired');
      const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'');
      if(!token||!await crypto.subtle.verify('HMAC',await this.signingKey,Uint8Array.from(token[1].match(/../g)!,b=>parseInt(b,16)),this.message(grant)))throw fail('transfer_unauthorized','Invalid transfer credential');
      await this.authorize(grant);
      if(match[2]==='/client'){
        if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
        return new Response(request.method==='HEAD'?null:transferClientSource,{headers:{
          'Content-Type':'text/x-python; charset=utf-8','Content-Disposition':'attachment; filename="transfer_file.py"',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Content-SHA256':transferClientSha256,
          'Content-Length':String(new TextEncoder().encode(transferClientSource).length),
        }});
      }
      const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Content-SHA256':grant.sha256});
      const action=(name:string,args:Data={})=>this.call(grant,name,args,request.signal);
      if(request.method==='DELETE'&&!match[2]){
        if(this.active.has(grant.id))throw fail('transfer_conflict','A transfer request is still active');
        held=grant.id;this.active.add(held);
        const result=await action(grant.direction+'_cancel');
        return json(result);
      }
      if(grant.direction==='upload'){
        headers.set('Upload-Length',String(grant.size));
        if(request.method==='POST'&&match[2]){
          if(this.active.has(grant.id))throw fail('transfer_conflict','A transfer request is still active');
          held=grant.id;this.active.add(held);
          const result=await action('upload_commit');
          return json(result);
        }
        if(match[2]||!['HEAD','PATCH'].includes(request.method))return new Response(null,{status:405,headers});
        const status=await action('upload_status');headers.set('Upload-Offset',String(status.offset));headers.set('X-Transfer-State',status.state);
        if(status.state==='cancelled')throw fail('transfer_expired','Transfer was cancelled');
        if(request.method==='HEAD')return new Response(null,{headers});
        if(request.headers.get('Content-Type')!=='application/octet-stream')return new Response(null,{status:415,headers});
        const offset=unsignedHeader(request.headers.get('Upload-Offset'));
        if(offset===undefined)return new Response(null,{status:400,headers});
        if(offset!==status.offset)return new Response(null,{status:409,headers});
        const length=unsignedHeader(request.headers.get('Content-Length'));
        if(request.headers.has('Content-Length')&&length===undefined)return new Response(null,{status:400,headers});
        if(length!==undefined&&(length>MAX_PATCH_SIZE||offset+length>grant.size))return new Response(null,{status:413,headers});
        if(this.active.has(grant.id))return new Response(null,{status:409,headers});
        if(this.active.size>=8)return new Response(null,{status:429,headers});
        this.active.add(grant.id);held=grant.id;
        const reader=request.body?.getReader();let position=offset,total=0,used=0;
        // Network stream fragments are not storage chunks. Coalesce them into
        // one fixed-size buffer instead of paying one remote RPC/fsync per fragment.
        const pending=new Uint8Array(CHUNK),deadline=Date.now()+300_000;
        const uploadSignal=AbortSignal.any([request.signal,AbortSignal.timeout(300_000)]);
        const flush=async()=>{
          if(!used)return;
          if(uploadSignal.aborted||Date.now()>=deadline)throw fail('transfer_timeout','Upload deadline reached');
          let written:Data;
          try{written=await this.call(grant,'upload_write',{offset:position,data_base64:encode(pending.subarray(0,used))},uploadSignal);}
          catch(error){if(uploadSignal.aborted)throw fail('transfer_timeout','Upload deadline reached');throw error;}
          if(written.offset!==position+used)throw fail('transfer_changed','Unexpected acknowledged offset');
          position=written.offset;headers.set('Upload-Offset',String(position));used=0;
        };
        try{
          if(reader)for(;;){
            if(uploadSignal.aborted||Date.now()>=deadline)throw fail('transfer_timeout','Upload deadline reached');
            let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
            const part=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{
              abort=()=>reject(fail('transfer_timeout','Upload cancelled or expired'));
              timer=setTimeout(abort,Math.max(1,Math.min(30_000,deadline-Date.now())));
              uploadSignal.addEventListener('abort',abort,{once:true});if(uploadSignal.aborted)abort();
            })]).finally(()=>{clearTimeout(timer);uploadSignal.removeEventListener('abort',abort);});
            if(part.done)break;
            if(total+part.value.length>MAX_PATCH_SIZE||offset+total+part.value.length>grant.size)return new Response(null,{status:413,headers});
            total+=part.value.length;
            for(let cursor=0;cursor<part.value.length;){
              const count=Math.min(CHUNK-used,part.value.length-cursor);
              pending.set(part.value.subarray(cursor,cursor+count),used);used+=count;cursor+=count;
              if(used===CHUNK)await flush();
            }
          }
          if(length!==undefined&&total!==length)return new Response(null,{status:400,headers});
          await flush();
          return new Response(null,{status:204,headers});
        }finally{await cancelBody(reader);}
      }
      if(match[2]||!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers});
      const status=await action('download_status');
      if(status.state!=='active')throw fail('transfer_expired','Transfer was cancelled');
      const etag=grant.etag??'"'+grant.sha256+'"';
      headers.set('Content-Type','application/octet-stream');headers.set('Accept-Ranges','bytes');headers.set('ETag',etag);
      const ifRange=request.headers.get('If-Range');
      const range=(!ifRange||ifRange===etag)?byteRange(request.headers.get('Range'),grant.size):null;
      if(range===false){headers.set('Content-Range','bytes */'+grant.size);return new Response(null,{status:416,headers});}
      const start=range?range.start:0,end=range?range.end:grant.size-1;let offset=start;
      headers.set('Content-Length',String(Math.max(0,end-start+1)));
      if(range)headers.set('Content-Range',`bytes ${start}-${end}/${grant.size}`);
      if(request.method==='GET'){
        if(this.active.has(grant.id))return new Response(null,{status:409,headers:{'Cache-Control':'no-store'}});
        if(this.active.size>=8)return new Response(null,{status:429,headers:{'Cache-Control':'no-store'}});
        this.active.add(grant.id);
      }
      const stopped=new AbortController();
      const finish=()=>{this.active.delete(grant.id);request.signal.removeEventListener('abort',finish);stopped.abort();};
      if(request.method==='GET')request.signal.addEventListener('abort',finish,{once:true});
      const body=request.method==='HEAD'?null:new ReadableStream<Uint8Array>({pull:async controller=>{
        try{
          if(offset>end){controller.close();finish();return;}
          const length=Math.min(CHUNK,end-offset+1),part=await this.call(grant,'download_read',{offset,length,etag},AbortSignal.any([request.signal,stopped.signal]));
          const bytes=decode(part.data_base64);
          if(part.offset!==offset||part.etag!==etag||bytes.length!==length)throw fail('transfer_changed','Download source changed');
          offset+=bytes.length;controller.enqueue(bytes);
        }catch(error){controller.error(error);finish();}
      },cancel:finish},{highWaterMark:0});
      return new Response(body,{status:range?206:200,headers});
    }catch(error){
      const code=(error as Data).code||'transfer_unavailable';
      const status=code==='transfer_unauthorized'?401:['transfer_expired','transfer_missing'].includes(code)?410:
        ['account_unavailable','device_forbidden','handle_forbidden','tool_forbidden','approval_invalidated','access_changed'].includes(code)?403:
        ['transfer_conflict','transfer_busy','transfer_changed','transfer_offset','file_exists'].includes(code)?409:code==='transfer_timeout'?408:503;
      // Do not echo downstream errors: they can contain private filesystem paths.
      return json({error:code},status);
    }finally{if(held)this.active.delete(held);}
  }
  async cleanup():Promise<void>{
    const expired=new Set<string>();let next=Infinity;
    for(const [key,grant] of await this.store.list<FileTransferGrant>({prefix:'file-transfer:'}))if(grant.expires_at<=Date.now()){expired.add(grant.id);this.active.delete(grant.id);await this.store.delete(key);}else next=Math.min(next,grant.expires_at);
    for(const [key,id] of await this.store.list<string>({prefix:'file-transfer-index:'}))if(expired.has(id))await this.store.delete(key);
    if(next<Infinity)await this.store.setAlarm(next);
  }
}
