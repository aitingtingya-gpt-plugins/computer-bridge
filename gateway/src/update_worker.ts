/** Independently deployed release executor. Only the private service binding exposes it. */
import {DurableObject} from 'cloudflare:workers';
import type {Data} from './types';

interface UpdateEnv {
  JOBS:DurableObjectNamespace;
  CF_ACCOUNT_ID:string;
  CF_WORKER_NAME:string;
  CF_API_TOKEN:string;
  TARGET_URL:string;
  GITHUB_RELEASE_TOKEN?:string;
  TARGET:{status(drain:boolean):Promise<Data>;resume():Promise<void>};
}

const terminal=new Set(['completed','failed','rolled_back','cancelled']);
class UpdateCancelled extends Error {}
export class ReleaseUpdate extends DurableObject<UpdateEnv> {
  private executing?:Promise<void>;
  async fetch(request:Request):Promise<Response>{
    const value=await request.json<Data>();
    if(value.action==='start'){
      const previous=await this.ctx.storage.get<Data>('job');
      if(!previous)await this.ctx.storage.put('job',{...value.job,state:'preparing',message:'准备 Cloudflare 部署'});
      if(!previous || !terminal.has(previous.state))await this.ctx.storage.setAlarm(Date.now()+100);
    }else if(value.action==='cancel'){
      const cancelled=await this.ctx.storage.transaction(async tx=>{
        const job=await tx.get<Data>('job');
        if(!job || !['preparing','waiting_idle'].includes(job.state))return false;
        await tx.put('job',{...job,state:'cancelled',message:'已取消'});return true;
      });
      if(!cancelled)return Response.json({error:'该任务已开始切换'},{status:400});
      await this.env.TARGET.resume();
    }
    const job=await this.ctx.storage.get<Data>('job');
    return Response.json(job?{id:job.id,state:job.state,message:job.message,observed:job.observed}:{error:'任务不存在'});
  }
  private async api(path:string,init:RequestInit={}):Promise<Data>{
    const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+this.env.CF_API_TOKEN);
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/workers/scripts/${this.env.CF_WORKER_NAME}${path}`,{...init,headers});
    const value=await response.json<Data>();
    if(!response.ok || value.success===false)throw new Error('Cloudflare 部署接口失败：HTTP '+response.status+' '+(value.errors?.[0]?.message || ''));
    return value;
  }
  async alarm():Promise<void>{
    if(this.executing)return this.executing;
    this.executing=this.step();try{await this.executing;}finally{this.executing=undefined;}
  }
  private async step():Promise<void>{
    let job=await this.ctx.storage.get<Data>('job');if(!job || terminal.has(job.state))return;
    const state=async(next:string,message:string,extra:Data={})=>{
      job=await this.ctx.storage.transaction(async tx=>{
        const current=(await tx.get<Data>('job'))!;
        if(current.state==='cancelled')throw new UpdateCancelled();
        const updated={...current,...extra,state:next,message};await tx.put('job',updated);return updated;
      });
    };
    try{
      if(job.state==='preparing'){
        if(['module_enable','module_disable'].includes(job.kind)){
          await state('waiting_idle','等待在途模块操作完成');
        }else{
        const headers:Record<string,string>={'Accept':'application/octet-stream','User-Agent':'Computer-Bridge-Updater'};
        if(this.env.GITHUB_RELEASE_TOKEN)headers.Authorization='Bearer '+this.env.GITHUB_RELEASE_TOKEN;
        const response=await fetch(job.artifact.url,{headers});
        if(!response.ok)throw new Error('GitHub 资源下载失败：HTTP '+response.status);
        const code=await response.arrayBuffer();
        const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',code))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(sha!==job.artifact.sha256 || code.byteLength!==job.artifact.size)throw new Error('Worker 发布资源校验失败');
        const deployment=(await this.api('/deployments')).result.deployments[0];
        if(deployment.versions.length!==1 || deployment.versions[0].percentage!==100)throw new Error('请先结束现有渐进式部署');
        const previous=await this.env.TARGET.status(false);
        const settings=(await this.api('/settings')).result;
        const bindings=settings.bindings.map((binding:Data)=>['secret_text','secret_key'].includes(binding.type)?{name:binding.name,type:'inherit'}:binding);
        const body=new FormData();
        body.set('metadata',JSON.stringify({main_module:'worker.mjs',bindings,keep_bindings:['secret_text','secret_key'],
          compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags,
          annotations:{'workers/message':'Computer Bridge '+job.version+' '+job.id}}));
        body.set('worker.mjs',new File([code],'worker.mjs',{type:'application/javascript+module'}));
        const uploaded=(await this.api('/versions?bindings_inherit=strict',{method:'POST',body})).result;
        await state('waiting_idle','等待在途请求完成',{previous_version:deployment.versions[0].version_id,
          previous_business_version:previous.version,previous_modules:previous.modules.map((m:Data)=>m.id).sort(),new_version:uploaded.id});
        }
      }
      if(job!.state==='waiting_idle'){
        if(!(await this.env.TARGET.status(true)).ready){await this.ctx.storage.setAlarm(Date.now()+1000);return;}
        if(['module_enable','module_disable'].includes(job!.kind)){
          await state('completed','模块设置已交接');await this.env.TARGET.resume();return;
        }
        await state('switching','切换 Worker 部署');
      }
      if(job!.state==='switching'){
        await this.deploy(job!.new_version);
        await state('verifying','核验实际部署与通信',{verify_deadline:Date.now()+90_000});
      }
      if(job!.state==='verifying'){
        const response=await fetch(this.env.TARGET_URL+'/health',{headers:{'Cache-Control':'no-cache'}});
        if(response.ok){
          const health=await response.json<Data>();
          const business=await this.env.TARGET.status(false);
          const deployed=(await this.api('/deployments')).result.deployments[0];
          await state('verifying','核验实际部署与通信',{observed:{entry_version:health.version,
            business_version:business.version,entry_modules:health.modules,business_modules:business.modules,
            deployment:deployed.versions}});
          if(health.version===job!.artifact.version && deployed.versions.some((v:Data)=>v.version_id===job!.new_version && v.percentage===100) &&
            business.version===job!.artifact.version &&
            JSON.stringify((health.modules || []).map((m:Data)=>m.id).sort())===JSON.stringify([...job!.artifact.modules].sort()) &&
            JSON.stringify(business.modules.map((m:Data)=>m.id).sort())===JSON.stringify([...job!.artifact.modules].sort())){
            await state('completed','更新完成，实际版本 '+health.version);await this.env.TARGET.resume();return;
          }
        }
        if(Date.now()>job!.verify_deadline)throw new Error('新部署未能通过通信核验：入口 '+
          job!.observed?.entry_version+'，业务 '+job!.observed?.business_version);
      }
      if(job!.state==='rolling_back'){
        await this.deploy(job!.previous_version);
        await state('rollback_verifying','核验原部署恢复',{verify_deadline:Date.now()+90_000});
      }
      if(job!.state==='rollback_verifying'){
        const response=await fetch(this.env.TARGET_URL+'/health',{headers:{'Cache-Control':'no-cache'}});
        if(response.ok){
          const health=await response.json<Data>(),business=await this.env.TARGET.status(false);
          const deployed=(await this.api('/deployments')).result.deployments[0];
          if(health.version===job!.previous_business_version && business.version===job!.previous_business_version &&
            deployed.versions.some((v:Data)=>v.version_id===job!.previous_version && v.percentage===100) &&
            JSON.stringify((health.modules || []).map((m:Data)=>m.id).sort())===JSON.stringify(job!.previous_modules) &&
            JSON.stringify(business.modules.map((m:Data)=>m.id).sort())===JSON.stringify(job!.previous_modules)){
            await this.env.TARGET.resume();await state('rolled_back',job!.failure+'；已核验原部署恢复');return;
          }
        }
        if(Date.now()>job!.verify_deadline)throw new Error('原部署恢复后的通信核验超时');
      }
      await this.ctx.storage.setAlarm(Date.now()+1000);
    }catch(error){
      const current=await this.ctx.storage.get<Data>('job');
      if(error instanceof UpdateCancelled || current?.state==='cancelled'){await this.env.TARGET.resume();return;}
      if(job!.previous_version && ['switching','verifying'].includes(job!.state)){
        await state('rolling_back','恢复原部署',{failure:(error as Error).message});
        await this.ctx.storage.setAlarm(Date.now()+1000);
      }else{await state('failed',(error as Error).message);await this.env.TARGET.resume();}
    }
  }
  private async deploy(version:string):Promise<void>{
    await this.api('/deployments',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({strategy:'percentage',versions:[{version_id:version,percentage:100}],
        code_update_strategy:{mode:'immediate'}})});
  }
}

export default {async fetch(request:Request,env:UpdateEnv):Promise<Response>{
  const body=await request.clone().json<Data>();const id=body.job?.id || body.id;
  if(!/^u[1-9][0-9]*$/.test(id))return Response.json({error:'任务号无效'},{status:400});
  return env.JOBS.get(env.JOBS.idFromName(id)).fetch(request);
}};
