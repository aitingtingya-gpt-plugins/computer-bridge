/** Explicit, bounded, read-only repository access. A binding is never an authorization grant. */
import type {RepositoryBinding} from '../super_agent/types';

export {repositoryToolSpec} from './contracts';
export type RepositoryFetch=(url:string,init:RequestInit)=>Promise<Response>;
export interface RepositoryReadRequest {
  operation:'info'|'branches'|'list'|'read';
  path?:string;ref?:string;page?:number;limit?:number;expected_sha?:string;
  encoding?:'text'|'base64';offset?:number;length?:number;
}
export interface RepositoryReadOptions {
  /** Internal host transport only. Must preserve URL, GET, timeout and redirect restrictions.
   * Any authentication must be authorized for this exact caller and repository, never a global shared token. */
  fetch?:RepositoryFetch;
}
type Data=Record<string,unknown>;
const fail=(code:string,message:string,details:Data={})=>Object.assign(new Error(message),{code,...details});
const MAX_JSON_BYTES=2*1024*1024;
const MAX_FILE_BYTES=1024*1024;
const MAX_READ_BYTES=65536;
const TIMEOUT_MS=20000;
const segment=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const pathSegments=(value:string)=>value.split('/').map(segment).join('/');
const object=(value:unknown):Data=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('repository_invalid_response','仓库平台返回了无法识别的响应');
  return value as Data;
};
const string=(value:unknown,max=8192)=>typeof value==='string'?value.slice(0,max):null;
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{40,64}$/i.test(value)?value:null;
const size=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
function integer(value:unknown,fallback:number,min:number,max:number,label:string):number {
  if(value===undefined)return fallback;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)
    throw fail('invalid_repository_argument',label+' 超出允许范围');
  return value;
}

export function normalizeRepositoryBinding(value:unknown):RepositoryBinding {
  if(value===undefined||value===null||value==='none')return null;
  if(typeof value!=='object'||Array.isArray(value))throw fail('invalid_repository','仓库必须为 none、GitHub 或 CNB');
  const input=value as Data;
  if(input.provider==='none')return null;
  if(input.provider!=='github'&&input.provider!=='cnb')throw fail('invalid_repository','仓库提供方只支持 GitHub 或 CNB');
  if(typeof input.url!=='string'||!input.url.trim()||input.url.length>2048)
    throw fail('invalid_repository','请使用仓库 HTTPS URL');
  const raw=input.url.trim(),host=input.provider==='github'?'github.com':'cnb.cool';
  // Inspect the original path as well: URL silently removes dot segments and backslashes.
  if(/[\\\u0000-\u0020\u007f?#]/.test(raw))throw fail('invalid_repository','仓库 URL 不允许查询、片段、反斜线或控制字符');
  let url:URL;
  try{url=new URL(raw);}catch{throw fail('invalid_repository','请使用仓库 HTTPS URL');}
  if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password)
    throw fail('invalid_repository','请使用不含凭据的 '+host+' 仓库 HTTPS URL');
  const originalPath=raw.match(/^https:\/\/[^/]+(\/.*)?$/i)?.[1]??'';
  let parts:string[];
  try{parts=originalPath.replace(/\/$/,'').slice(1).split('/').map(decodeURIComponent);}
  catch{throw fail('invalid_repository','仓库路径编码无效');}
  if(parts.length<2||parts.length>20||(input.provider==='github'&&parts.length!==2)
    ||parts.some(p=>!p||p==='.'||p==='..'||p==='-'||!(/^[\p{L}\p{N}_.-]+$/u.test(p))))
    throw fail('invalid_repository','请使用仓库根地址，不要使用文件、分支或平台视图地址');
  parts[parts.length-1]=parts.at(-1)!.replace(/\.git$/,'');
  if(!parts.at(-1)||['.','..','-'].includes(parts.at(-1)!))throw fail('invalid_repository','仓库名称无效');
  if(input.provider==='github'&&parts.some(p=>!/^[A-Za-z0-9_.-]+$/.test(p)))throw fail('invalid_repository','GitHub 仓库路径无效');
  return {provider:input.provider,url:'https://'+host+'/'+parts.map(segment).join('/')};
}

function requestPath(value:unknown):string {
  if(value===undefined||value==='')return '';
  if(typeof value!=='string'||value.length>4096||value.startsWith('/')||/[\\\u0000-\u001f\u007f]/.test(value)
    ||value.split('/').some(p=>!p||p==='.'||p==='..'))
    throw fail('invalid_repository_argument','path 必须是仓库内的相对路径，不允许路径穿越');
  return value;
}
function requestRef(value:unknown):string|undefined {
  if(value===undefined)return undefined;
  if(typeof value!=='string'||!value||value.length>1024||/[\u0000-\u001f\u007f]/.test(value))
    throw fail('invalid_repository_argument','ref 必须为有效的分支、标签或提交');
  return value;
}
function apiBase(binding:NonNullable<RepositoryBinding>):string {
  const path=new URL(binding.url).pathname;
  return binding.provider==='github'?'https://api.github.com/repos'+path:'https://api.cnb.cool'+path;
}
async function boundedJSON(response:Response):Promise<unknown> {
  const declared=Number(response.headers.get('content-length'));
  if(declared>MAX_JSON_BYTES){await response.body?.cancel();throw fail('repository_response_too_large','仓库响应超出 2 MiB 限制，请缩小读取范围');}
  if(!response.body)throw fail('repository_invalid_response','仓库平台未返回内容');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];
  let count=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      count+=value.length;
      if(count>MAX_JSON_BYTES){await reader.cancel();throw fail('repository_response_too_large','仓库响应超出 2 MiB 限制，请缩小读取范围');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}
  catch{throw fail('repository_invalid_response','仓库平台返回的内容不是有效 JSON');}
}
async function fetchJSON(binding:NonNullable<RepositoryBinding>,url:URL,options:RepositoryReadOptions):Promise<unknown> {
  const expected=binding.provider==='github'?'https://api.github.com':'https://api.cnb.cool';
  if(url.origin!==expected)throw fail('invalid_repository','仓库请求必须使用官方 API');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
    const init:RequestInit & {credentials:'omit';referrerPolicy:'no-referrer'}={
      method:'GET',credentials:'omit',redirect:'manual',referrerPolicy:'no-referrer',signal:controller.signal,
      headers:{Accept:binding.provider==='github'?'application/vnd.github+json':'application/vnd.cnb.api+json',
        'User-Agent':'Computer-Bridge-Repository-Reader',...(binding.provider==='github'?{'X-GitHub-Api-Version':'2022-11-28'}:{})},
    };
    const response=await (options.fetch??fetch)(url.href,init);
    if(response.redirected||(response.url&&new URL(response.url).origin!==expected)||response.status>=300&&response.status<400){
      await response.body?.cancel();throw fail('repository_redirect_blocked','仓库平台要求重定向，请确认仓库根地址后重新绑定');
    }
    if(!response.ok){
      await response.body?.cancel();const details={provider:binding.provider,status:response.status};
      if(response.status===401)throw fail('repository_auth_required','平台要求认证。请使用当前宿主已授权的仓库工具；不要在聊天或仓库 URL 中提供令牌',details);
      if(response.status===429||(response.status===403&&response.headers.get('x-ratelimit-remaining')==='0'))
        throw fail('repository_rate_limited','仓库平台限流，请稍后再试或使用当前宿主已授权的仓库工具',details);
      if(response.status===403)throw fail('repository_forbidden','平台拒绝此次仓库读取；绑定仓库不会授予访问权限',details);
      if(response.status===404)throw fail('repository_not_found','未找到仓库、路径或版本，或此仓库需要使用已授权工具访问',details);
      throw fail('repository_unavailable','仓库平台暂时无法完成读取',details);
    }
    return await boundedJSON(response);
  }catch(error){
    if(error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&error.code.startsWith('repository_'))throw error;
    throw fail(controller.signal.aborted?'repository_timeout':'repository_unavailable',controller.signal.aborted?'仓库读取超时，请稍后再试':'无法连接仓库平台，请稍后再试');
  }finally{clearTimeout(timer);}
}
function entry(value:unknown):Data {
  const data=object(value),rawType=data.type;
  const type=data.submodule_git_url?'submodule':rawType==='tree'||rawType==='dir'?'directory':rawType==='blob'||rawType==='file'?'file':rawType==='link'||rawType==='symlink'?'symlink':rawType==='submodule'?'submodule':rawType==='lfs'?'lfs':'unknown';
  return {name:string(data.name,1024),path:string(data.path,4096),type,sha:sha(data.sha),size:size(data.size)};
}
function fileBytes(data:Data):Uint8Array {
  const declared=size(data.size);
  if(declared!==null&&declared>MAX_FILE_BYTES)throw fail('repository_file_too_large','文件超过 1 MiB，请通过当前宿主已授权的仓库工具读取');
  if(data.encoding!=='base64'||typeof data.content!=='string')throw fail('repository_content_unavailable','平台未返回可读取的文件内容，请使用当前宿主已授权的仓库工具');
  const encoded=data.content.replace(/[\r\n\t ]/g,'');
  if(encoded.length>Math.ceil(MAX_FILE_BYTES/3)*4)throw fail('repository_file_too_large','文件超过 1 MiB');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw fail('repository_invalid_response','平台返回的文件编码无效');
  let bytes:Uint8Array;
  try{bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{throw fail('repository_invalid_response','平台返回的文件编码无效');}
  if(bytes.length>MAX_FILE_BYTES)throw fail('repository_file_too_large','文件超过 1 MiB');
  if(declared!==null&&declared!==bytes.length)throw fail('repository_invalid_response','平台返回的文件大小与内容不一致');
  return bytes;
}
function base64(bytes:Uint8Array):string {
  let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);
}

/** No network is used until explicitly called. No writes, cloning, PRs, hooks, credentials or redirects. */
export async function readRepository(binding:RepositoryBinding,args:RepositoryReadRequest,options:RepositoryReadOptions={}):Promise<Data> {
  const repository=normalizeRepositoryBinding(binding);
  if(!repository)throw fail('repository_not_bound','此 Super Agent 会话未绑定仓库；不绑定仓库时普通任务仍可使用');
  if(!args||!['info','branches','list','read'].includes(args.operation))throw fail('invalid_repository_argument','不支持的仓库读取操作');
  const path=requestPath(args.path),ref=requestRef(args.ref);
  const page=integer(args.page,1,1,10000,'page'),limit=integer(args.limit,100,1,100,'limit');
  const offset=integer(args.offset,0,0,MAX_FILE_BYTES,'offset'),length=integer(args.length,MAX_READ_BYTES,4,MAX_READ_BYTES,'length');
  if(args.encoding!==undefined&&args.encoding!=='text'&&args.encoding!=='base64')throw fail('invalid_repository_argument','encoding 必须为 text 或 base64');
  if(args.expected_sha!==undefined&&!sha(args.expected_sha))throw fail('invalid_repository_argument','expected_sha 必须为 Git 对象哈希');
  const isGitHub=repository.provider==='github',base=apiBase(repository);
  const common={repository,operation:args.operation,read_only:true,untrusted:true};
  if(args.operation==='info'){
    const data=object(await fetchJSON(repository,new URL(base),options));
    return {...common,name:string(data.name,1024),full_name:string(isGitHub?data.full_name:data.path,4096),
      description:string(data.description),default_branch:string(data.default_branch,1024),
      visibility:isGitHub?(data.private===true?'private':data.private===false?'public':null):string(data.visibility_level,128)?.toLowerCase()??null,url:repository.url};
  }
  if(args.operation==='branches'){
    const url=new URL(base+(isGitHub?'/branches':'/-/git/branches'));
    url.searchParams.set('page',String(page));url.searchParams.set(isGitHub?'per_page':'page_size',String(limit));
    const data=await fetchJSON(repository,url,options);
    if(!Array.isArray(data)||data.length>limit)throw fail('repository_invalid_response','平台返回的分支列表不符合分页范围');
    return {...common,page,limit,next_page:data.length===limit?page+1:null,
      branches:data.map(value=>{const item=object(value);return {name:string(item.name,1024),sha:sha(object(item.commit).sha),protected:item.protected===true};})};
  }
  if(args.operation==='read'&&!path)throw fail('invalid_repository_argument','读取文件需要 path');
  const url=new URL(base+(isGitHub?'/contents':'/-/git/contents')+(path?'/'+pathSegments(path):''));
  if(ref!==undefined)url.searchParams.set('ref',ref);
  const data=await fetchJSON(repository,url,options);
  if(args.operation==='list'){
    const directory=Array.isArray(data)?data:object(data);
    const rows=Array.isArray(directory)?directory:directory.type==='tree'||directory.type==='dir'?directory.entries:undefined;
    if(!Array.isArray(rows))throw fail('repository_not_directory','该路径不是目录');
    const start=(page-1)*limit,entries=rows.slice(start,start+limit).map(entry);
    // GitHub contents has a documented 1000-entry cap and no server pagination.
    const sourceLimitReached=isGitHub&&rows.length>=1000;
    return {...common,path,ref:ref??null,page,limit,entries,total_returned_by_provider:rows.length,
      next_page:start+limit<rows.length?page+1:null,source_limit_reached:sourceLimitReached,complete:!sourceLimitReached,
      ...(sourceLimitReached?{note:'GitHub 目录 API 最多返回 1000 项；需要完整树时请使用宿主已授权的 Git Trees 工具'}:{})};
  }
  if(Array.isArray(data))throw fail('repository_not_file','该路径不是文件');
  const file=object(data);
  if(args.expected_sha!==undefined&&args.expected_sha.toLowerCase()!==String(file.sha).toLowerCase())throw fail('repository_version_changed','文件版本已变化，请固定提交版本或从头重新读取，避免混合不同版本');
  if(!['file','blob'].includes(String(file.type))||file.submodule_git_url)
    throw fail('repository_not_file','该路径不是普通文件；目录、符号链接、子模块和 LFS 不会自动跟随');
  const bytes=fileBytes(file),encoding=args.encoding??'text';
  if(offset>bytes.length)throw fail('invalid_repository_argument','offset 超出文件大小');
  let end=Math.min(bytes.length,offset+length),content:string;
  if(encoding==='text'){
    if(offset<bytes.length&&(bytes[offset]&0xc0)===0x80)throw fail('invalid_repository_argument','offset 必须位于 UTF-8 字符边界；请沿用 next_offset');
    while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
    try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(offset,end));}
    catch{throw fail('repository_binary_file','文件不是有效 UTF-8，请用 encoding=base64 读取');}
    if(content.includes('\0'))throw fail('repository_binary_file','文件包含二进制内容，请用 encoding=base64 读取');
  }else content=base64(bytes.subarray(offset,end));
  return {...common,path,ref:ref??null,sha:sha(file.sha),size:bytes.length,encoding,content,offset,length:end-offset,
    next_offset:end<bytes.length?end:null,truncated:offset>0||end<bytes.length};
}
