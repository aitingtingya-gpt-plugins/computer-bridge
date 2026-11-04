/** Stable supervisor and loopback update executor, outside the replaceable service process. */
import {createServer} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import type {Data} from '../types';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const data=resolve(process.env.DATA_DIR || 'data');
await mkdir(join(data,'update-jobs'),{recursive:true});
const activeFile=join(data,'active-program.json');
const secret=randomBytes(32).toString('hex');
let child:ChildProcess|undefined;
let stopping=false;
let switching=false;
const shutdown=new AbortController();
const running=new Map<string,Promise<void>>();
const jobLocks=new Map<string,Promise<void>>();
class UpdateCancelled extends Error {}

async function withJob<T>(id:string,action:()=>Promise<T>):Promise<T>{
 const previous=jobLocks.get(id) || Promise.resolve();
 let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve;});
 jobLocks.set(id,current);
 await previous;
 try{return await action();}
 finally{release();if(jobLocks.get(id)===current)jobLocks.delete(id);}
}

async function read(path:string):Promise<Data>{return JSON.parse(await readFile(path,'utf8'));}
async function save(path:string,value:Data):Promise<void>{const temporary=path+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);}
async function exists(path:string):Promise<boolean>{try{await stat(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
if(!await exists(activeFile)) await save(activeFile,{id:'initial',root,version:(await read(join(root,'package.json'))).version,modules:{}});
const jobFile=(id:string)=>join(data,'update-jobs',id+'.json');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function startChild():Promise<void>{
 const active=await read(activeFile);
 child=spawn(process.execPath,[join(active.root,'build/server.mjs')],{stdio:'inherit',env:{...process.env,
  DATA_DIR:data,BRIDGE_UPDATER_URL:controlUrl,BRIDGE_UPDATER_TOKEN:secret,
  BRIDGE_MODULE_PATHS:JSON.stringify(Object.values(active.modules).map((m:any)=>m.path)),BRIDGE_INSTALL_ID:active.id}});
 child.once('exit',()=>{child=undefined;if(!stopping && !switching)setTimeout(()=>void startChild(),1000);});
}
async function stopChild():Promise<void>{
 if(!child)return;
 const current=child;
 const stopped=new Promise<void>(resolve=>current.once('exit',()=>resolve()));
 current.kill('SIGTERM');await stopped;
}
async function command(binary:string,args:string[],cwd:string):Promise<void>{
 const process=spawn(binary,args,{cwd,stdio:'inherit'});
 const stop=()=>process.kill('SIGTERM');shutdown.signal.addEventListener('abort',stop,{once:true});
 try{await new Promise<void>((resolve,reject)=>process.once('exit',code=>code===0?resolve():reject(new Error('安装命令退出码 '+code))));}
 finally{shutdown.signal.removeEventListener('abort',stop);}
}
async function asset(value:Data):Promise<Uint8Array>{
 const headers:Record<string,string>={'Accept':'application/octet-stream','User-Agent':'Computer-Bridge-Updater'};
 if(process.env.GITHUB_RELEASE_TOKEN) headers.Authorization='Bearer '+process.env.GITHUB_RELEASE_TOKEN;
 const response=await fetch(value.url,{headers,signal:shutdown.signal});if(!response.ok)throw new Error('下载失败：HTTP '+response.status);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length!==value.size || createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw new Error('发布资源校验失败');
 return bytes;
}
async function unpack(bytes:Uint8Array,destination:string):Promise<void>{
 for(const [name,content] of Object.entries(unzipSync(bytes))){
  const target=resolve(destination,name);
  const rel=relative(resolve(destination),target);
  if(isAbsolute(rel) || rel==='..' || rel.startsWith('../') || rel.startsWith('..\\'))throw new Error('安装包路径无效');
  if(name.endsWith('/')){await mkdir(target,{recursive:true});continue;}
  await mkdir(dirname(target),{recursive:true});await writeFile(target,content);
 }
}
async function serviceControl(action:string):Promise<Data>{
 const response=await fetch('http://127.0.0.1:'+(process.env.PORT || '8787')+'/internal-runtime/'+action,
  {headers:{Authorization:'Bearer '+secret},signal:shutdown.signal});
 if(!response.ok)throw new Error('业务进程交接失败：HTTP '+response.status);return response.json() as Promise<Data>;
}
async function healthy(active:Data):Promise<void>{
 const deadline=Date.now()+60_000;
 let observed='等待启动';
 while(Date.now()<deadline){
  if(stopping)throw new Error('更新执行器正在停止');
  try{const value=await serviceControl('state');if(value.version===active.version && value.install_id===active.id)return;
    observed=JSON.stringify(value);
  }catch(error){observed=(error as Error).message;}
  await sleep(500);
 }
 throw new Error('新服务未能恢复通信：'+observed+'；期望 '+active.id+' '+active.version);
}
async function execute(job:Data):Promise<void>{
 const previous=job.previous || await read(activeFile);
 const folder=join(data,'releases',job.id);
 let switched=false;
 const state=async(state:string,message:string)=>withJob(job.id,async()=>{
   const current=await read(jobFile(job.id));
   if(state!=='cancelled' && (current.state==='cancelled' || await exists(jobFile(job.id)+'.cancel')))
     throw new UpdateCancelled('更新已取消');
   job={...current,previous,state,message};await save(jobFile(job.id),job);
 });
 const cancelled=async()=>{if(stopping)throw new Error('更新执行器正在停止');
   if((await read(jobFile(job.id))).state==='cancelled' || await exists(jobFile(job.id)+'.cancel'))
     throw new UpdateCancelled('更新已取消');};
 try{
  const actual=await read(activeFile);
  if(actual.id===job.id){switched=true;await healthy(actual);await state('completed','更新完成，实际版本 '+actual.version);return;}
  await mkdir(folder,{recursive:true});
  let candidate:Data={...previous,id:job.id,modules:{...previous.modules}};
  if(job.kind==='core'){
   await state('preparing','下载并校验服务端');
   await unpack(await asset(job.artifact),folder);
   await cancelled();await state('installing','准备独立服务目录');
   const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
     resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean) as string[];
   let npm:string|undefined;
   for(const candidate of candidates)if(await exists(candidate)){npm=candidate;break;}
   if(!npm)throw new Error('需要包含 npm 的 Node.js 安装');
   await command(process.execPath,[npm,'ci','--omit=dev','--no-audit','--no-fund'],folder);
   candidate={...candidate,root:folder,version:job.artifact.version};
  }else if(['module_install','module_update'].includes(job.kind)){
   const path=join(folder,'module.mjs');await writeFile(path,await asset(job.artifact));
   await command(process.execPath,['--input-type=module','-e',
    `const m=(await import(${JSON.stringify(pathToFileURL(path).href)})).default;if(m.id!==${JSON.stringify(job.module)}||m.api!==1)process.exit(1)`],folder);
   candidate.modules[job.module]={path,version:job.artifact.version};
  }else if(job.kind==='module_remove')delete candidate.modules[job.module];
  await state('waiting_idle','等待在途请求完成');
  while(true){await cancelled();if((await serviceControl('drain')).ready)break;await sleep(500);}
  await state('switching','切换服务进程');switching=true;
  switched=true;await stopChild();await save(activeFile,candidate);
  await startChild();await state('verifying','核验服务版本和原数据连接');await healthy(candidate);
  switching=false;await state('completed','更新完成，实际版本 '+candidate.version);
 }catch(error){
  if(stopping)return; // The persisted stage resumes after the stable launcher starts again.
  if(switched){await stopChild();await save(activeFile,previous);await startChild();
   try{await healthy(previous);await state('rolled_back',(error as Error).message+'；原服务已恢复');}
   catch(restore){await state('failed','恢复原服务失败：'+(restore as Error).message);}
  }else {
   await withJob(job.id,async()=>{
    const current=await read(jobFile(job.id));
    const cancelled=current.state==='cancelled' || error instanceof UpdateCancelled || await exists(jobFile(job.id)+'.cancel');
    job={...current,previous,state:cancelled?'cancelled':'failed',message:cancelled?'已取消':(error as Error).message};
    await save(jobFile(job.id),job);
   });
  }
  switching=false;
 }finally{await rm(jobFile(job.id)+'.cancel',{force:true});await serviceControl('resume').catch(()=>{});}
}

const control=createServer(async(req,res)=>{
 try{
  if(req.headers.authorization!=='Bearer '+secret){res.writeHead(401);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const value=JSON.parse(Buffer.concat(chunks).toString());
  const id=value.job?.id || value.id;
  if(!/^u[1-9][0-9]*$/.test(id))throw new Error('任务号无效');
  if(value.action==='start'){
   await withJob(id,async()=>{
    if(!await exists(jobFile(id)))await save(jobFile(id),{...value.job,state:'preparing',message:'准备更新'});
   });
   const job=await read(jobFile(id));
   if(!running.has(id) && !['completed','failed','cancelled','rolled_back'].includes(job.state)){
    const work=execute(job).finally(()=>running.delete(id));running.set(id,work);
   }
  }else if(value.action==='cancel'){
   await withJob(id,async()=>{
    const job=await read(jobFile(id));
    if(job.state==='cancelled')return;
    if(!['preparing','installing','waiting_idle'].includes(job.state))throw new Error('该任务已开始切换或已结束');
    await save(jobFile(id),{...job,state:'cancelled',message:'已取消'});
   });
  }
  const job=await read(jobFile(id));res.setHeader('Content-Type','application/json');
  if(value.action==='status' && !running.has(id) && !['completed','failed','cancelled','rolled_back'].includes(job.state)) {
    const work=execute(job).finally(()=>running.delete(id));running.set(id,work);
  }
  res.end(JSON.stringify({id:job.id,state:job.state,message:job.message}));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:(error as Error).message}));}
});
await new Promise<void>(resolve=>control.listen(0,'127.0.0.1',resolve));
const controlUrl='http://127.0.0.1:'+(control.address() as {port:number}).port;
await startChild();
for(const name of ['SIGINT','SIGTERM'] as const)process.once(name,()=>{
 stopping=true;shutdown.abort();void stopChild().then(()=>{control.closeAllConnections();control.close();});
});
