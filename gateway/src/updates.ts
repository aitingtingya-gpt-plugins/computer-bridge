import {gt,satisfies} from 'semver';
import type {Store,ServiceEnv} from './runtime';
import type {Data} from './types';
import {Releases,VERSION,compatibility,type Artifact} from './releases';
import {ServerModules} from './modules';

const finished=new Set(['completed','failed','cancelled','rolled_back']);
type DeviceCall=(device:string,method:string,args:Data)=>Promise<Data>;

export class Updates {
  readonly releases:Releases;
  constructor(private store:Store,private env:ServiceEnv,private rpc:DeviceCall,
    private online:(device:string)=>boolean) {
    this.releases=new Releases(store,env.GITHUB_RELEASE_TOKEN);
  }
  async view(force=false):Promise<Data> {
    const catalogue=force?await this.releases.check(true):await this.store.get<Data>('updates:catalogue');
    const jobs=[...(await this.store.list<Data>({prefix:'update-job:'})).values()];
    const devices=[...(await this.store.list<Data>({prefix:'device:'})).values()].map(d=>({
      id:d.id,name:d.display_name || d.name,version:d.version,modules:d.module_versions || [],
      update_supported:this.online(d.id) && !!d.capabilities?.includes('updates_v1')}));
    return {source:await this.releases.settings(),catalogue:catalogue || null,jobs,devices,
      server:{version:VERSION,runtime:this.env.RUNTIME || 'cloudflare',protocol:{min:1,max:1},
        update_supported:!!this.env.updateServer,modules:await new ServerModules(this.store).list()}};
  }
  async enqueue(target:string,kind:string,module?:string,requestedVersion?:string):Promise<Data> {
    const core=kind==='core';
    if(!['core','module_install','module_update','module_enable','module_disable','module_remove'].includes(kind))
      throw new Error('未知更新操作');
    const device=target==='server'?undefined:await this.store.get<Data>('device:'+target);
    if(target!=='server' && (!device || !this.online(target))) throw new Error('请选择在线电脑');
    if(device && !device.capabilities?.includes('updates_v1')) throw new Error('需要先安装更新组件');
    if(target==='server' && !this.env.updateServer) throw new Error('服务端需要先安装更新执行器');
    const peer=device || {version:VERSION,protocol:{min:1,max:1}};
    const peers=device?[{name:'中转服务',protocol:{min:1,max:1}}]:
      [...(await this.store.list<Data>({prefix:'device:'})).values()];
    const targetType=target==='server' ? (this.env.RUNTIME==='node'?'server-node':'server-cloudflare') : 'client';
    const states=target==='server'?await new ServerModules(this.store).list():device!.module_versions || [];
    const current=states.find((m:Data)=>m.id===module && m.installed);
    if(!core && !module)throw new Error('请选择模块');
    const local=['module_enable','module_disable','module_remove'].includes(kind);
    if(local && !current)throw new Error('模块尚未安装');
    const installed=states.filter((m:Data)=>m.installed).map((m:Data)=>m.id);
    const desired=new Set<string>(installed);
    if(kind==='module_install' || kind==='module_update') desired.add(module!);
    if(kind==='module_remove') desired.delete(module!);
    let selected:Data|undefined;
    let artifact:Artifact|undefined;
    let reason='没有适用的发布资源';
    const needsAsset=!local || (targetType==='server-cloudflare' && kind==='module_remove');
    const catalogue=needsAsset?await this.releases.check():{releases:[]};
    for(const release of catalogue.releases) {
      if(requestedVersion && release.version!==requestedVersion) continue;
      const candidates:Artifact[]=release.manifest.artifacts;
      artifact=candidates.find(a=>{
        if(device && !['any',device.system].includes(a.platform)) return false;
        if(core) return a.target===targetType && (targetType!=='server-cloudflare' ||
          JSON.stringify([...a.modules].sort())===JSON.stringify([...desired].sort()));
        if(target==='server' && targetType==='server-cloudflare') return a.target===targetType &&
          JSON.stringify([...a.modules].sort())===JSON.stringify([...desired].sort()) && a.version===VERSION;
        return a.target===(target==='server'?'module-server':'module-client') && a.module===module;
      });
      if(!artifact) continue;
      const requirement=core?null:compatibility(artifact,{...peer,protocol:{min:1,max:1}});
      if(requirement){reason=requirement;artifact=undefined;continue;}
      if(core){
        const next=release.manifest.protocol;
        const incompatible=peers.find(d=>{
          const supported=d.protocol || {min:1,max:1};
          return Math.max(next.min,supported.min)>Math.min(next.max,supported.max);
        });
        if(incompatible){reason='请先更新通信协议不兼容的 '+(incompatible.display_name || incompatible.name);
          artifact=undefined;continue;}
      }
      if(core && !gt(artifact.version,peer.version)){reason='当前已是所选渠道的最新兼容版本';artifact=undefined;continue;}
      if(core){
        const incompatible=states.find((m:Data)=>m.installed && m.requires?.core &&
          !satisfies(artifact!.version,m.requires.core.replaceAll(',',' '),{includePrerelease:true}));
        if(incompatible){reason='请先更新或卸载不兼容的模块：'+incompatible.id;artifact=undefined;continue;}
      }
      if(kind==='module_update' && current && !gt(artifact.version,current.version)){
        reason='模块已是所选渠道的最新兼容版本';artifact=undefined;continue;
      }
      selected=release;break;
    }
    if(needsAsset && (!artifact || !selected)) throw new Error(reason);
    const job=await this.store.transaction(async tx=>{
      const active=await tx.get<string>('update-active:'+target);
      if(active) {
        const existing=await tx.get<Data>('update-job:'+active);
        if(existing && !finished.has(existing.state)) {
          if(existing.kind!==kind || existing.module!==module)throw new Error('该目标正在处理更新任务 '+existing.id);
          return existing;
        }
      }
      const sequence=(await tx.get<number>('update-sequence') || 0)+1;
      const id='u'+sequence;
      const value={id,target,kind,module,version:artifact?.version || current.version,state:'preparing',message:'准备更新',
        created_at:Date.now(),artifact,release:selected?.id,
        enabled:kind==='module_update'?current?.enabled!==false:!['module_disable','module_remove'].includes(kind)};
      await tx.put({'update-sequence':sequence,['update-job:'+id]:value,['update-active:'+target]:id});
      return value;
    });
    await this.start(job);
    return job;
  }
  private async start(job:Data):Promise<void> {
    try {
      if(job.target==='server') {
        const response=await this.env.updateServer!({action:'start',job});
        await this.store.put('update-job:'+job.id,{...job,...response});
      } else {
        const artifact=job.artifact?{...job.artifact,download_url:this.env.PUBLIC_URL+'/device/update-asset/'+job.id}:undefined;
        if(artifact)delete artifact.url;
        const response=await this.rpc(job.target,'bridge.update',{...job,artifact});
        await this.store.put('update-job:'+job.id,{...job,state:response.state,message:response.message || job.message});
      }
    } catch(error) {
      // A lost acknowledgement is not an installation failure. The same job is sent after reconnect.
      const code=(error as Data).code;
      const transient=!code || (error as Error).name==='TimeoutError' ||
        ['connection_interrupted','computer_offline','rpc_timeout','request_pending'].includes(code);
      await this.store.transaction(async tx=>{
        const current=await tx.get<Data>('update-job:'+job.id) || job;
        if(finished.has(current.state)) return;
        await tx.put('update-job:'+job.id,{...current,...(transient?{}:{state:'failed'}),
          message:(transient?'等待设备或更新执行器回执：':'更新未启动：')+(error as Error).message});
      });
    }
  }
  async bootstrap(device:string):Promise<Data>{
    const current=await this.store.get<Data>('device:'+device);
    const catalogue=await this.releases.check();
    const release=catalogue.releases.find((r:Data)=>r.version===VERSION);
    if(!release)throw new Error('当前服务器版本的发布资源尚未就绪');
    const artifacts:Artifact[]=release.manifest.artifacts.filter((a:Artifact)=>a.target==='module-client' && current?.modules?.includes(a.module));
    for(const artifact of artifacts) await this.store.put('bootstrap-asset:'+device+':'+artifact.id,artifact);
    return {artifacts:artifacts.map(a=>({...a,url:undefined,download_url:this.env.PUBLIC_URL+'/device/bootstrap-asset/'+a.id}))};
  }
  async bootstrapAsset(device:string,id:string):Promise<Response>{
    const artifact=await this.store.get<Artifact>('bootstrap-asset:'+device+':'+id);
    if(!artifact)return new Response('Not found',{status:404});
    const response=await this.releases.download(artifact);
    return new Response(response.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
  }
  async connected(device:string):Promise<void> {
    const active=await this.store.get<string>('update-active:'+device);
    const job=active && await this.store.get<Data>('update-job:'+active);
    if(job && !finished.has(job.state)) await this.start(job);
  }
  async report(device:string,states:Data[]):Promise<void> {
    for(const state of states) {
      const job=await this.store.get<Data>('update-job:'+state.id);
      if(!job || job.target!==device) continue;
      await this.store.put('update-job:'+job.id,{...job,state:state.state,message:state.message,changed_at:Date.now()});
    }
  }
  async refreshServer():Promise<void> {
    const active=await this.store.get<string>('update-active:server');
    const job=active && await this.store.get<Data>('update-job:'+active);
    if(job && !finished.has(job.state) && this.env.updateServer) {
      try {
        const status=await this.env.updateServer({action:'status',id:job.id});
        if(status.state==='completed' && job.module)
          await new ServerModules(this.store).enabled(job.module,job.enabled);
        await this.store.put('update-job:'+job.id,{...job,...status});
      } catch(error) {
        await this.store.put('update-job:'+job.id,{...job,message:'等待更新执行器恢复：'+(error as Error).message});
      }
    }
  }
  async cancel(id:string):Promise<Data> {
    const job=await this.store.get<Data>('update-job:'+id);
    if(!job) throw new Error('更新任务不存在');
    if(['switching','verifying'].includes(job.state) || finished.has(job.state)) throw new Error('该任务已切换或已结束');
    return job.target==='server' ? this.env.updateServer!({action:'cancel',id}) : this.rpc(job.target,'bridge.update.cancel',{id});
  }
  async asset(device:string,id:string):Promise<Response> {
    const job=await this.store.get<Data>('update-job:'+id);
    if(!job || job.target!==device) return new Response('Not found',{status:404});
    const response=await this.releases.download(job.artifact);
    return new Response(response.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
  }
}
