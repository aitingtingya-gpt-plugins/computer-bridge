import MarkdownIt from 'markdown-it';
import {Zip, ZipDeflate, strToU8} from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';

const safeName=value=>String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[ .]+|[ .]+$/g,'')||'conversation';
const pad=value=>String(value).padStart(2,'0');
const timestamp=()=>{const d=new Date();return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;};
const encoded=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const label=value=>String(value).replace(/\\/g,'\\\\').replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/\n/g,' ');
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function target(url,chat,paths){
  let value;try{value=new URL(url,location.origin);}catch{return null;}
  if(value.origin!==location.origin)return null;
  const parts=value.pathname.split('/').map(decodeURIComponent);
  return parts.length===5&&parts[1]==='chat'&&parts[2]==='files'&&parts[3]===chat?paths.get(parts[4]):null;
}
function rewrite(text,chat,paths){
  const protectedRanges=[],starts=[0];for(const match of text.matchAll(/\n/g))starts.push(match.index+1);starts.push(text.length);
  for(const token of new MarkdownIt('commonmark').parse(text,{}))if(['fence','code_block','html_block'].includes(token.type)&&token.map)protectedRanges.push([starts[token.map[0]],starts[Math.min(token.map[1],starts.length-1)]]);
  for(let position=0;position<text.length;){const found=/`+/.exec(text.slice(position));if(!found)break;const begin=position+found.index,marker=found[0],rest=text.slice(begin+marker.length),end=new RegExp('(?<!`)'+marker+'(?!`)').exec(rest);if(end){position=begin+marker.length+end.index+marker.length;protectedRanges.push([begin,position]);}else position=begin+marker.length;}
  return text.replace(/(!?\[[^\n]*?\]\(\s*<?)([^\s)>]+)(?=[>\s)]|$)|(^ {0,3}\[[^\]\n]+\]:\s*<?)([^\s>]+)/gm,(whole,lead,url,ref,refurl,offset)=>{
    if(protectedRanges.some(([begin,end])=>begin<=offset&&offset<end))return whole;
    const replaced=target(url||refurl,chat,paths);return replaced?(lead||ref)+replaced:whole;
  });
}
function messageMarkdown(message,chat,paths){
  const lines=[`## ${message.role==='assistant'?'GPT / Dot':'用户'} · ${message.id} · ${message.created_at||''}`,''];
  if(message.text)lines.push(rewrite(message.text,chat,paths),'');
  if(message.kind==='approval'&&message.approval){const a=message.approval;lines.push('### 命令审批','');for(const [key,title] of [['id','审批编号'],['device_name','电脑'],['cwd','工作目录'],['justification','理由'],['state','状态'],['decision','决定'],['delivery_pending','决定等待送达'],['expires_at','有效期']])if(key in a)lines.push(`**${title}**`,'',String(a[key]),'');if('command'in a){const command=String(a.command),fence='`'.repeat(Math.max(3,...[...command.matchAll(/`+/g)].map(m=>m[0].length+1)));lines.push('**命令**','',fence,command,fence,'');}}
  for(const attachment of message.attachments||[])lines.push(`${(attachment.mime_type||'').startsWith('image/')?'!':''}[${label(attachment.name)}](${paths.get(attachment.id)})`,'');
  return lines.join('\n')+'\n---\n\n';
}
function database(name){return new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('messages',{keyPath:'sequence'});request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});}
function writePage(db,messages){return new Promise((resolve,reject)=>{const tx=db.transaction('messages','readwrite');for(const message of messages)tx.objectStore('messages').put(message);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function readPage(db,after){return new Promise((resolve,reject)=>{const request=db.transaction('messages').objectStore('messages').getAll(IDBKeyRange.lowerBound(after,true),50);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function removeDatabase(name){return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=resolve;request.onerror=()=>reject(request.error);});}
function base64(value){const raw=atob(value),bytes=new Uint8Array(raw.length);for(let index=0;index<raw.length;index++)bytes[index]=raw.charCodeAt(index);return bytes;}
const hex=value=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');

/** Browser-local ZIP; API requests retain the page's existing authenticated scope. */
export async function exportChat(api,chat,progress=()=>{},signal){
  const check=()=>{if(signal?.aborted)throw new DOMException('已取消导出','AbortError');};
  check();const summary=(await api('get',{chat_id:chat.id})).chat,last=Number(summary.message_count),filename=`${safeName(summary.title).slice(0,80)}-${chat.id}-${timestamp()}.zip`,folder=filename.slice(0,-4),name='computer-bridge-export-'+crypto.randomUUID();
  const db=await database(name),attachments=new Map(),paths=new Map();let zip=null,completed=false,count=0;
  try{
    let after=0;
    while(after<last){check();const page=await api('history',{chat_id:chat.id,after,limit:50}),messages=page.messages.filter(message=>message.sequence<=last);check();if(!messages.length)throw new Error('会话历史不完整，未生成导出文件。');for(const message of messages){if(message.sequence!==count+1)throw new Error('会话历史不完整，未生成导出文件。');count=message.sequence;for(const file of message.attachments||[])attachments.set(file.id,file);}await writePage(db,messages);after=count;progress(`读取会话 · ${count}/${last} 条`);}
    for(const [id,file]of attachments){const clean=String(file.name).split(/[\\/]/).pop(),basename=id+'-'+safeName(clean);paths.set(id,'attachments/'+encoded(basename));}
    const chunks=[];let failure;const done=new Promise((resolve,reject)=>{zip=new Zip((error,data,final)=>{if(error){failure=error;reject(error);}else{if(data.length)chunks.push(data);if(final)resolve();}});});
    // Attach an immediate error consumer while asynchronous downloads proceed.
    done.catch(()=>{});
    const markdown=new ZipDeflate(folder+'/conversation.md');zip.add(markdown);
    markdown.push(strToU8(`# ${String(summary.title).replace(/\n/g,' ')}\n\n- 会话：${chat.id}\n- 电脑：${summary.device_name} · ${summary.device_id}\n- 导出时间：${new Date().toISOString()}\n- 保存至消息：m${last}\n\n---\n\n`),false);
    after=0;for(;;){check();const page=await readPage(db,after);if(!page.length)break;for(const message of page){markdown.push(strToU8(messageMarkdown(message,chat.id,paths)),false);after=message.sequence;}await pause();}
    markdown.push(new Uint8Array(),true);
    let index=0;
    for(const [id,file]of attachments){check();progress(`下载附件 · ${++index}/${attachments.size} · ${file.name}`);const metadata=(await api('attachment',{chat_id:chat.id,attachment_id:id})).attachment,entry=new ZipDeflate(folder+'/'+decodeURIComponent(paths.get(id))),hash=sha256.create();zip.add(entry);let offset=0;for(;;){check();const data=await api('read-attachment',{chat_id:chat.id,attachment_id:id,offset,length:262144,encoding:'base64'});check();const bytes=base64(data.data);hash.update(bytes);entry.push(bytes,false);offset=data.next_offset;if(data.eof)break;await pause();}if(offset!==metadata.size||hex(hash.digest())!==metadata.sha256)throw new Error('附件校验失败，未生成导出文件：'+file.name);entry.push(new Uint8Array(),true);}
    check();if(failure)throw failure;progress('压缩会话…');zip.end();await done;check();completed=true;
    return {blob:new Blob(chunks,{type:'application/zip'}),filename,messages:count,attachments:attachments.size};
  }finally{if(!completed&&zip)zip.terminate();db.close();await removeDatabase(name);}
}
