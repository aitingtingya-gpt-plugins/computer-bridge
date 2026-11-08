import {Upload} from 'tus-js-client';

const protocols=new Map();
async function supportsTus(chatId,signal){
  if(protocols.has(chatId))return protocols.get(chatId);
  const response=await fetch('/chat/uploads/'+encodeURIComponent(chatId),{method:'OPTIONS',credentials:'same-origin',signal});
  if([404,405,501].includes(response.status)){protocols.set(chatId,false);return false;}
  if(!response.ok)throw Object.assign(new Error('无法确认附件上传协议'),{status:response.status});
  const supported=response.headers.get('Tus-Version')?.split(',').map(v=>v.trim()).includes('1.0.0');
  protocols.set(chatId,!!supported);return !!supported;
}
function base64(buffer){let binary='';const data=new Uint8Array(buffer);for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(binary);}
export async function uploadAttachment(job,{chatId,csrf,api,progress,signal}){
  const file=job.file;
  signal?.throwIfAborted();
  if(!await supportsTus(chatId,signal)){
    signal?.throwIfAborted();
    const upload=await api('upload-start',{chat_id:chatId,name:file.name||'附件',size:file.size,mime_type:file.type||'application/octet-stream',request_key:job.key});
    signal?.throwIfAborted();
    for(let offset=upload.attachment.offset;upload.attachment.state!=='ready'&&offset<file.size;){
      signal?.throwIfAborted();
      const data=await file.slice(offset,offset+upload.chunk_size).arrayBuffer();
      signal?.throwIfAborted();
      const written=await api('upload-chunk',{chat_id:chatId,attachment_id:upload.attachment.id,offset,data:base64(data)});
      signal?.throwIfAborted();
      offset=written.next_offset;progress(offset,file.size);
    }
    signal?.throwIfAborted();
    const finished=await api('upload-complete',{chat_id:chatId,attachment_id:upload.attachment.id});
    signal?.throwIfAborted();return finished.attachment;
  }
  const endpoint=new URL('/chat/uploads/'+encodeURIComponent(chatId),location.href).href;
  const safe=url=>{const parsed=new URL(url,location.href);return parsed.origin===location.origin&&new RegExp('^/chat/uploads/'+chatId+'/a[1-9][0-9]*$').test(parsed.pathname)&&!parsed.search&&!parsed.hash;};
  const upload=new Upload(file,{
    endpoint,uploadUrl:job.uploadUrl&&safe(job.uploadUrl)?job.uploadUrl:undefined,
    chunkSize:8*1024*1024,retryDelays:[0,1000,3000,5000],removeFingerprintOnSuccess:true,
    metadata:{filename:file.name||'附件',filetype:file.type||'application/octet-stream'},
    headers:{'X-CSRF-Token':csrf,'Idempotency-Key':job.key},
    fingerprint:()=>Promise.resolve(['computer-bridge',chatId,file.name,file.type,file.size,file.lastModified].join('|')),
    onBeforeRequest(request){request.getUnderlyingObject().withCredentials=true;},
    onAfterResponse(request){if(upload.url&&safe(upload.url))job.uploadUrl=upload.url;},
    onProgress:progress,
    onShouldRetry(error){const status=error.originalResponse?.getStatus();return status===undefined||status===0||status===408||status===409||status===429||status>=500;},
  });
  if(!job.uploadUrl){const previous=await upload.findPreviousUploads();const candidate=previous.find(item=>safe(item.uploadUrl));if(candidate)upload.resumeFromPreviousUpload(candidate);}
  await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>{void upload.abort().then(()=>finish(new DOMException('上传已暂停，可重新选择文件续传','AbortError')),finish);};
    upload.options.onError=error=>finish(Object.assign(error,{status:error.originalResponse?.getStatus()}));
    upload.options.onSuccess=()=>finish();
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    upload.start();
  });
  if(!upload.url||!safe(upload.url))throw new Error('上传资源地址无效');
  signal?.throwIfAborted();
  job.uploadUrl=upload.url;
  const attachmentId=new URL(upload.url).pathname.split('/').at(-1);
  // Explicitly verify server completion even when a resumed HEAD reported size.
  return (await api('upload-complete',{chat_id:chatId,attachment_id:attachmentId})).attachment;
}
window.bridgeChatUploads={upload:uploadAttachment};
