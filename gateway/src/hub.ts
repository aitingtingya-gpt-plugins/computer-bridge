import {CommandApprovals} from './approvals';
import {ServerModules} from "./modules";
import {Updates} from "./updates";
import {VERSION} from './releases';
import {handler} from "./mcp";
import {json, opaque, hash, type Data} from "./types";
import {References, relativeFiles} from "./references";
import {Accounts, type Actor} from "./accounts";
import {Guidance} from './guidance';
import {definitionList} from './definitions';
import {DeviceTransport} from './transport';
import {ConnectionLatency} from './latency';
import {RequestRecords} from './requests';
import type {DeviceSocket, HubContext, ServiceEnv} from "./runtime";

export class ComputerHubCore {
  draining=false;
  readonly approvals:CommandApprovals;
  readonly modules:ServerModules;
  readonly updates:Updates;
  private requests:RequestRecords;
  private transport:DeviceTransport;
  private refs: References;
  readonly accounts: Accounts;
  private mcp: ReturnType<typeof handler>;
  private guidance:Guidance;
  private accessUpdates=new Map<string,Promise<void>>();
  private latency:ConnectionLatency;

  constructor(private ctx: HubContext, private env: ServiceEnv) {
    this.approvals=new CommandApprovals(ctx.storage,(device,method,args)=>
      this.rpc(device,method,args,false,AbortSignal.timeout(30_000)),work=>{if(ctx.waitUntil)ctx.waitUntil(work);else void work;});
    this.transport=new DeviceTransport(ctx,id=>this.requests.received(id));
    this.modules = new ServerModules(ctx.storage);
    this.updates = new Updates(ctx.storage,env,
      (device,method,args)=>this.rpc(device,method,args,false,AbortSignal.timeout(30_000)),
      device=>!!this.transport.socket(device));
    this.refs = new References(ctx.storage);
    this.requests=new RequestRecords(ctx.storage,this.refs);
    this.guidance = new Guidance(ctx.storage);
    this.accounts = new Accounts(ctx.storage, env.BRIDGE_SECRET, ctx.equal);
    this.mcp = handler(this);
    this.latency=new ConnectionLatency(device=>this.transport.socket(device),
      (device,signal)=>this.rpc(device,'bridge.ping',{},false,signal));
  }

  async authorizeDevice(id: string, key: string): Promise<boolean> {
    const device = await this.ctx.storage.get<Data>("device:" + id);
    return !!device && device.key_hash === await hash(key);
  }

  async acceptDevice(socket: DeviceSocket, id: string): Promise<void> {
    for (const old of this.ctx.getWebSockets(id)) {
      this.latency.clear(old);
      this.transport.close(old,'connection_replaced');
      old.close(1000, "Connection replaced by the same registered device");
    }
    socket.serializeAttachment({device_id: id,connection_id:opaque(),ready:false});
    this.ctx.acceptWebSocket(socket, [id]);
    const device = await this.ctx.storage.get<Data>("device:" + id);
    await this.ctx.storage.put("device:" + id, {...device, connected_at: Date.now()});
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal/")) {
      try {return await this.control(url.pathname.slice(10), request.method === "POST" ? await request.json<Data>() : {});}
      catch(error) {return json({error:(error as Error).message,code:(error as Data).code || 'computer_error'},
        ['account_unavailable','device_forbidden','admin_required','handle_forbidden'].includes((error as Data).code)?403:400);}
    }
    if(url.pathname.startsWith('/device/update-asset/') || url.pathname.startsWith('/device/bootstrap')) {
      const key=request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
      for(const [_,device] of await this.ctx.storage.list<Data>({prefix:'device:'})) {
        if(device.key_hash===await hash(key)) {
          if(url.pathname==='/device/bootstrap')return json(await this.updates.bootstrap(device.id));
          if(url.pathname.startsWith('/device/bootstrap-asset/'))return this.updates.bootstrapAsset(device.id,url.pathname.slice('/device/bootstrap-asset/'.length));
          return this.updates.asset(device.id,url.pathname.slice('/device/update-asset/'.length));
        }
      }
      return json({error:'device_unauthorized'},401);
    }
    if (url.pathname.startsWith('/download/')) return this.download(url.pathname.slice(10),request.signal,await this.identity(request.headers.get('x-computer-bridge-account') || '',Number(request.headers.get('x-computer-bridge-epoch'))));
    if(this.draining) return json({error:'服务正在切换，请继续使用原请求号恢复'},503);
    return this.mcp.fetch(request);
  }

  private adminOnly(actor:Actor):void {
    if(actor.role!=='admin') throw Object.assign(new Error('需要管理员权限'),{code:'admin_required'});
  }

  async identity(id:string,epoch:number):Promise<Actor> {return this.accounts.require(id,epoch);}

  private async control(action:string,value:Data):Promise<Response> {
    if(action==='pair') return json(await this.pair(value));
    if(action==='poll') return json(await this.poll(value.id));
    if(action==='accounts-login') return json({actor:await this.accounts.login(value.username || 'admin',value.password || '')});
    if(action==='accounts-auth') return json({actor:await this.accounts.authenticate(value)});
    // These routes are invoked only by the private deployment binding / local updater.
    if(action==='busy') return json({busy:this.transport.active,version:VERSION,modules:await this.modules.list()});
    if(action==='drain') return json({ready:this.drain(),version:VERSION,modules:await this.modules.list()});
    if(action==='resume') {this.draining=false;return json({ready:true});}
    const actor=await this.accounts.authenticate(value.actor || {});
    if(!actor) throw Object.assign(new Error('请重新登录'),{code:'account_unavailable'});
    if(action==='accounts-profile') {
      const updated=await this.accounts.update(actor.id,{username:value.username,password:value.password});
      if(updated.epoch!==actor.epoch) await this.approvals.revoke(actor.id);
      return json({actor:updated});
    }
    if(['accounts-list','accounts-create','accounts-update','accounts-delete','accounts-grant','accounts-revoke'].includes(action)) {
      this.adminOnly(actor);
      if(action==='accounts-list') return json({users:await this.accounts.list()});
      if(action==='accounts-create') return json(await this.accounts.create(value.username,value.password));
      if(action==='accounts-update') {
        const previous=(await this.accounts.list()).find(u=>u.id===value.id);
        const updated=await this.accounts.update(value.id,{username:value.username,enabled:value.enabled,password:value.password});
        if(updated.epoch!==previous?.epoch) await this.approvals.revoke(value.id);
        return json({user:updated});
      }
      if(action==='accounts-delete') {
        await this.accounts.delete(value.id);await this.approvals.revoke(value.id);return json({deleted:true});
      }
      const device=await this.refs.raw(value.id);
      if(action==='accounts-grant') await this.accounts.grant(value.user_id,device);
      else {await this.accounts.revoke(value.user_id,device);await this.approvals.revoke(value.user_id,device);}
      return json({saved:true});
    }
    if(action==='list') return json(await this.list(actor));
    if(action==='connections') return json(await this.connections(actor,value.device_id,value.force===true));
    if(action==='approve') return json(await this.approve(value.code,actor));
    if(action==='command-approval') {
      await this.checkApproval(value.id,actor);
      if(value.decision) {
        const outcome=await this.approvals.decide(value.id,value.decision);
        return json(await this.project(outcome.result,outcome.record.projection,actor));
      }
      return json(await this.approvals.details(value.id));
    }
    if(['remove','rename','lock-mode','access'].includes(action)) {
      const device=await this.refs.raw(value.id);await this.accounts.assertAccess(actor,device);
      if(action==='remove') {
        if(actor.role==='admin') return json(await this.remove(value.id));
        await this.accounts.revoke(actor.id,device);await this.approvals.revoke(actor.id,device);return json({removed:true});
      }
      if(action==='rename') return json(await this.rename(value.id,value.name));
      if(action==='lock-mode') return json(await this.lockMode(value.id,value.enabled));
      return json(await this.updateAccess(value));
    }
    if(action==='update-view') {
      if(actor.role==='admin') await this.updates.refreshServer();
      const view=await this.updates.view(value.force===true);
      const allowed=await this.accounts.devices(actor);
      view.devices=view.devices.filter((d:Data)=>!allowed || allowed.has(d.id));
      view.jobs=view.jobs.filter((j:Data)=>!allowed || allowed.has(j.target));
      if(allowed) {delete view.server;delete view.source;}
      for(const device of view.devices) device.id=await this.refs.assign('c',device.id);
      for(const job of view.jobs) if(job.target!=='server') job.target=await this.refs.assign('c',job.target);
      return json(view);
    }
    if(action==='update-source') {
      this.adminOnly(actor);await this.updates.releases.configure(value.repository,value.channel);return json({saved:true});
    }
    if(action==='update-start') {
      const outcomes=await Promise.all((value.targets as string[]).map(async target=>{
        try {
          const raw=target==='server'?target:await this.refs.raw(target);
          if(raw==='server') this.adminOnly(actor);else await this.accounts.assertAccess(actor,raw);
          return {target,job:await this.updates.enqueue(raw,value.kind,value.module,value.version)};
        } catch(error) {return {target,error:(error as Error).message};}
      }));return json({outcomes});
    }
    if(action==='update-cancel') {
      const job=await this.ctx.storage.get<Data>('update-job:'+value.id);
      if(!job) throw new Error('更新任务不存在');
      if(job.target==='server') this.adminOnly(actor);else await this.accounts.assertAccess(actor,job.target);
      return json(await this.updates.cancel(value.id));
    }
    return json({error:'unknown_action'},404);
  }

  private accountScope(actor:Actor,device:string,path:string):string {
    return device+'|'+path+(actor.id==='u1'?'':'|account:'+actor.id);
  }

  private async checkApproval(id:string,actor:Actor):Promise<void> {
    const record=await this.approvals.record(id);
    await this.accounts.assertAccess(actor,record.device);
    if(actor.role!=='admin' && (record.projection.account || 'u1')!==actor.id)
      throw Object.assign(new Error('审批不属于当前账号'),{code:'handle_forbidden'});
  }

  drain():boolean {
    if(this.transport.active) return false;
    this.draining=true;return true;
  }

  async pair(value: Data): Promise<Data> {
    const id = opaque();
    const code = opaque().slice(0, 8).toUpperCase();
    const record = {id, code, device_id: value.device_id, name: value.name, system: value.system,
      status: "pending", expires_at: Math.floor(Date.now() / 1000) + 600};
    await this.ctx.storage.put("pair:" + id, record);
    await this.ctx.storage.put("code:" + code, id);
    await this.ctx.storage.setAlarm(Date.now() + 600_000);
    return {...record, verification_url: this.env.PUBLIC_URL + "/manage?code=" + code};
  }

  async poll(id: string): Promise<Data> {
    const record = await this.ctx.storage.get<Data>("pair:" + id);
    if (!record || record.expires_at < Date.now() / 1000) return {status: "denied"};
    if (record.status === "approved") {
      await this.ctx.storage.delete(["pair:" + id, "code:" + record.code]);
      const device=await this.ctx.storage.get<Data>("device:"+record.device_id);
      return {status: "approved", device_key: record.device_key,access:device?.access};
    }
    return {status: record.status};
  }

  async approve(code: string, actor:Actor): Promise<Data> {
    const result = await this.accounts.approvePair(code, actor);
    return {registered: true, device_id: await this.refs.assign("c", result.device_id), name: result.name};
  }

  async list(actor:Actor): Promise<Data> {
    const records = await this.ctx.storage.list<Data>({prefix: "device:"});
    const allowed=await this.accounts.devices(actor);
    const ordered=[...records.values()].filter(d=>!allowed || allowed.has(d.id)).sort((a,b)=>a.registered_at-b.registered_at || a.id.localeCompare(b.id));
    const computers=await Promise.all(ordered.map(async d=>({
        ...(actor.role==='admin'?{grants:await this.accounts.grants(d.id)}:{}),
        ...await this.connectionStatus(d.id),name: d.display_name ?? d.name,
        system: d.system, version:d.version, modules: d.modules || [],
        protocol:d.protocol || {min:1,max:1},capabilities:d.capabilities || [],module_versions:d.module_versions || [],
        access:d.access || {full_access:true,workspaces:[],revision:0},
        access_applied:d.access_applied ?? 0,access_error:d.access_error || '',lock_mode:this.powerView(d)})));
    return {computers};
  }

  private async connectionStatus(device:string,force=false):Promise<Data> {
    const id=await this.refs.assign('c',device);
    const reading=await this.latency.read(device,force);
    const online=!!this.transport.socket(device);
    const recovering=this.transport.recovering(device);
    return {id,online,connection_state:online?(reading.latency_state==='ok'?'healthy':'degraded'):(recovering?'recovering':'offline'),
      ...(online?reading:{latency_ms:null,latency_state:'offline',latency_checked_at:new Date().toISOString()})};
  }

  async connections(actor:Actor,id?:string,force=false):Promise<Data> {
    if(id) {const device=await this.refs.raw(id);await this.accounts.assertAccess(actor,device);return {computers:[await this.connectionStatus(device,force)]};}
    const records=await this.ctx.storage.list<Data>({prefix:'device:'});
    const allowed=await this.accounts.devices(actor);
    return {computers:await Promise.all([...records.keys()].map(key=>key.slice(7)).filter(id=>!allowed || allowed.has(id)).map(id=>this.connectionStatus(id)))};
  }

  private powerView(record:Data):Data {
    const setting=record.lock_mode || {enabled:true,revision:0};
    const status=record.lock_mode_status;
    const online=this.ctx.getWebSockets(record.id).length>0;
    const matches=status?.revision===setting.revision && status?.enabled===setting.enabled;
    const state=!online?'pending':!status?'update_required':!matches?'pending':status.applied?'applied':'failed';
    return {enabled:setting.enabled,state,applied:state==='applied',
      request_state:status?.request_state || 'unknown',interrupted:status?.interrupted || false,
      last_sleep_at:status?.last_sleep_at || null,last_resume_at:status?.last_resume_at || null,
      checked_at:status?.checked_at || null,
      ...(matches && status.error?{error:status.error}:{}),
      ...(status?.limitation?{limitation:status.limitation}:{})};
  }

  async lockMode(id:string,enabled?:boolean):Promise<Data> {
    const raw=await this.refs.raw(id);
    const record=await this.ctx.storage.transaction(async tx=>{
      const current=await tx.get<Data>('device:'+raw);
      if(!current) throw new Error('电脑不存在');
      const previous=current.lock_mode || {enabled:true,revision:0};
      if(enabled!==undefined) {
        current.lock_mode={enabled,revision:previous.revision+(enabled===previous.enabled?0:1)};
        await tx.put('device:'+raw,current);
      }
      return current;
    });
    if(record.lock_mode_status && this.ctx.getWebSockets(raw).length) {
      await this.syncPower(raw,new AbortController().signal);
    }
    const latest=await this.ctx.storage.get<Data>('device:'+raw);
    return {device_id:id,...this.powerView(latest!)};
  }

  private async powerStatus(raw:string,status:Data):Promise<void> {
    await this.ctx.storage.transaction(async tx=>{
      const current=await tx.get<Data>('device:'+raw);
      if(current && (current.lock_mode_status?.revision ?? -1)<=status.revision)
        await tx.put('device:'+raw,{...current,lock_mode_status:status});
    });
  }

  private async syncPower(raw:string,signal:AbortSignal):Promise<void> {
    const record=await this.ctx.storage.get<Data>('device:'+raw);
    const setting=record?.lock_mode || {enabled:true,revision:0};
    try {
      const status=await this.rpc(raw,'computer.configure_power',{lock_mode:setting},false,signal);
      await this.powerStatus(raw,status);
    } catch(error) {
      await this.powerStatus(raw,{...setting,applied:false,error:(error as Error).message});
    }
  }

  async rename(id: string, name: string): Promise<Data> {
    const raw = await this.refs.raw(id);
    const device = await this.ctx.storage.get<Data>("device:" + raw);
    if (!device) throw new Error("电脑不存在");
    await this.ctx.storage.put("device:" + raw, {...device, display_name: name});
    return {id: await this.refs.assign("c", raw), name};
  }

  async updateAccess(value:Data):Promise<Data> {
    const raw=await this.refs.raw(value.id);
    const previous=this.accessUpdates.get(raw) || Promise.resolve();
    let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    this.accessUpdates.set(raw,pending);
    await previous;
    try {return await this.applyAccess(value,raw);}
    finally {release();if(this.accessUpdates.get(raw)===pending)this.accessUpdates.delete(raw);}
  }

  private async applyAccess(value:Data,raw:string):Promise<Data> {
    const record=await this.ctx.storage.get<Data>('device:'+raw);
    if (!record) throw new Error('电脑不存在');
    const access=structuredClone(record.access || {full_access:true,workspaces:[],revision:0});
    let sequence=record.workspace_sequence || 0;
    if (value.action==='access') access.full_access=value.full_access;
    if (value.action==='workspace_save') {
      if (!value.name?.trim() || !value.path?.trim()) throw new Error('请填写工作区名称和绝对路径');
      const id=value.workspace_id || 'w'+(++sequence);
      const entry={id,name:value.name.trim(),path:value.path.trim(),additional:value.additional};
      access.workspaces=access.workspaces.filter((w:Data)=>w.id!==id);access.workspaces.push(entry);
    } else if (value.action==='workspace_remove') access.workspaces=access.workspaces.filter((w:Data)=>w.id!==value.workspace_id);
    access.revision++;
    let applied=record.access_applied;
    if (this.ctx.getWebSockets(raw).length) {
      if(value.action==='workspace_save') {
        const inspected=await this.rpc(raw,'computer.inspect_workspaces',{access},false,new AbortController().signal);
        Object.assign(access,inspected.access);
        const edited=access.workspaces[access.workspaces.length-1];
        const missing=[edited.validation.main,...edited.validation.additional]
          .filter((p:Data)=>p.state==='missing' && p.creatable).map((p:Data)=>p.path);
        if(missing.length && !value.create_missing) return {saved:false,confirmation:{missing}};
        if(missing.length) {
          const created=await this.rpc(raw,'computer.create_workspace_directories',
            {access:{...access,workspaces:[edited]}},false,new AbortController().signal);
          access.workspaces[access.workspaces.length-1]=created.access.workspaces[0];
        }
      }
      const reply=await this.rpc(raw,'computer.configure',{access},false,new AbortController().signal);
      Object.assign(access,reply.access);applied=reply.revision;
    } else {
      for(const workspace of access.workspaces) workspace.validation={main:{path:workspace.path,state:'pending'},
        additional:workspace.additional.map((path:string)=>({path,state:'pending'}))};
    }
    const latest=await this.ctx.storage.get<Data>('device:'+raw);
    await this.ctx.storage.put('device:'+raw,{...latest,access,workspace_sequence:sequence,access_applied:applied,access_error:''});
    return {saved:true,applied:applied===access.revision,offline:!this.ctx.getWebSockets(raw).length};
  }

  async download(token:string, signal:AbortSignal,actor:Actor):Promise<Response> {
    const entry=await this.ctx.storage.get<Data>('download:'+token);
    if (!entry || entry.expires_at<Date.now()) return json({error:'下载链接已过期，请重新交付文件'},404);
    if (!await this.ctx.storage.get('device:'+entry.device)) return json({error:'电脑已移除'},404);
    const issuer=await this.accounts.authenticate({id:entry.account || 'u1',epoch:entry.account_epoch || 0});
    if(!issuer || !await this.accounts.canAccess(issuer,entry.device)) return json({error:'下载授权已失效'},403);
    if(actor.role!=='admin' && actor.id!==issuer.id) return json({error:'下载链接不属于当前账号'},403);
    if(!await this.accounts.canAccess(actor,entry.device)) return json({error:'无权下载这台电脑的文件'},403);
    let offset=0;
    const stream=new ReadableStream<Uint8Array>({pull:async controller=>{
      try {
        await this.accounts.assertAccess(actor,entry.device);
        await this.accounts.assertAccess(issuer,entry.device);
        const chunk=await this.rpc(entry.device,'computer.download',{session:entry.session,path:entry.path,offset},false,signal);
        if(chunk.end){controller.close();return;}
        const bytes=Uint8Array.from(atob(chunk.data),(c)=>c.charCodeAt(0));offset=chunk.next;controller.enqueue(bytes);
      } catch(error) {controller.error(error);}
    }});
    return new Response(stream,{headers:{'Content-Type':entry.media_type,'Cache-Control':'no-store',
      'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(entry.name)}});
  }

  async remove(id: string): Promise<Data> {
    id = await this.refs.raw(id);
    for (const ws of this.ctx.getWebSockets(id)) ws.close(1000, "Device removed by operator");
    for(const user of await this.accounts.grants(id)) await this.accounts.revoke(user,id);
    await this.ctx.storage.delete("device:" + id);
    const workspaces = await this.ctx.storage.list<Data>({prefix: "workspace:"});
    for (const [key, value] of workspaces) if (value.device_id === id) await this.ctx.storage.delete(key);
    for (const ref of (await this.ctx.storage.list<any>({prefix: "reference:"})).values()) {
      if (ref.raw === id || ref.device === id || ref.scope.startsWith(id + "|")) {
        if (ref.kind === "o") await this.refs.release(ref.id);
        else await this.refs.forget(ref.id);
      }
    }
    return {removed: true};
  }

  async humanTicket(args: Data, actor:Actor): Promise<string> {
    const ticket = opaque();
    await this.ctx.storage.put("human:" + ticket, {fingerprint: await hash(JSON.stringify(args)), account:actor.id, epoch:actor.epoch, expires_at: Date.now() + 600_000});
    await this.ctx.storage.setAlarm(Date.now() + 600_000);
    return ticket;
  }

  async consumeHumanTicket(ticket: string, args: Data, actor:Actor): Promise<void> {
    const record = await this.ctx.storage.get<Data>("human:" + ticket);
    if (!record || (record.account || 'u1')!==actor.id || (record.epoch || 0)!==actor.epoch || record.expires_at < Date.now() || record.fingerprint !== await hash(JSON.stringify(args))) {
      throw new Error("人类表单不属于这次调用或已过期");
    }
    await this.ctx.storage.delete("human:" + ticket);
  }

  private async contextRaw(id:string,actor:Actor):Promise<string> {
    const ref=await this.refs.get(id);
    if(!ref || ref.kind!=='v' || (ref.account || 'u1')!==actor.id)
      throw Object.assign(new Error('上下文不属于当前账号'),{code:'handle_forbidden'});
    return ref.raw;
  }

  async invoke(method: string, args: Data, confirmed: boolean, signal: AbortSignal, caller: string, actor:Actor): Promise<any> {
    if (method === "computer.list") return this.list(actor);
    if (method === "computer.recover") return this.recover(args,signal,actor);
    if (method === "computer.lock_mode") {await this.accounts.assertAccess(actor,await this.refs.raw(args.device_id));return this.lockMode(args.device_id,args.enabled);}
    if(method === "computer.module_call" || method === "computer.module_tools") await this.modules.require(args.module);
    args = {...args};
    const legacyWorkspace = typeof args.session === "string" && args.session.startsWith("workspace_");
    const selectedFile = method === "computer.files" ? args.payload?.file_ref : undefined;
    let device: string;
    let scope = "";
    let root = "";
    let context=args.context ? await this.contextRaw(args.context,actor) : '';
    if (method === "computer.open" || method === 'computer.workspaces') device = args.device_id = await this.refs.raw(args.device_id);
    else {
      args.session = await this.refs.raw(args.session);
      const workspace = await this.ctx.storage.get<Data>("workspace:" + args.session);
      if (!workspace) throw new Error("请先通过 computer.open 选择电脑与目录");
      if((workspace.account || 'u1')!==actor.id) throw Object.assign(new Error('会话不属于当前账号'),{code:'handle_forbidden'});
      device = workspace.device_id;
      root = workspace.path;
      scope = this.accountScope(actor,device,workspace.path);
      context=workspace.context || context;
      // Translate identity fields only. File text, commands and scientific prose remain original.
      for (const field of ["operation", "research_session"]) {
        if (args[field]) args[field] = await this.refs.raw(args[field], scope);
      }
      if (method === "computer.module_call" || method === "computer.module_tools") {
        args.payload = await this.refs.input(args.payload || {}, scope);
      }
      if (method === "computer.files" && args.payload?.file_ref) {
        const {file_ref, ...payload} = args.payload;
        args.payload = {...payload, path: await this.refs.raw(file_ref, scope)};
      }
      if (method === "computer.image" && args.file_ref) {
        args.path = await this.refs.raw(args.file_ref, scope);
        delete args.file_ref;
      }
    }
    await this.accounts.assertAccess(actor,device);
    const settings=await this.ctx.storage.get<Data>('device:'+device);
    if(settings?.protocol && (settings.protocol.min>1 || settings.protocol.max<1))
      throw Object.assign(new Error('该电脑的通信协议不兼容，请先更新服务端或电脑端'),{code:'protocol_incompatible'});
    const access=settings?.access || {full_access:true,workspaces:[],revision:0};
    if(settings?.access_applied!==access.revision) args._access=access;
    if(!context) context=await this.ctx.storage.transaction(async tx=>{
      const workspace=args.session ? await tx.get<Data>('workspace:'+args.session) : undefined;
      if(workspace?.context) return workspace.context as string;
      const identity=opaque();
      if(workspace) await tx.put('workspace:'+args.session,{...workspace,context:identity});
      return identity;
    });
    if(method==='computer.exec' && args.sandbox_permissions) {
      if(!access.full_access && !settings?.capabilities?.includes('command_approval_v1'))
        throw Object.assign(new Error('请先升级电脑端以支持命令审批'),{code:'approval_update_required'});
      if(!access.full_access && !caller) throw new Error('缺少已认证的命令调用方');
      args._caller=caller;
    }
    if(method!=='computer.image') args._guidance_stamps=await this.guidance.seen(context,device);
    if((method==='computer.skills' || method==='computer.agents') && args.id) {
      const reference=await this.refs.get(args.id);
      if(!reference || reference.scope!==scope) throw new Error('定义不属于所选电脑和工作目录');
      args._definition={source:reference.source,locator:reference.locator};
    }
    const projection={method,device,scope,root,context,selectedFile,legacyWorkspace,account:actor.id,account_epoch:actor.epoch,args:{
      session:args.session,operation:args.operation,action:args.action,consume:args.consume,
      payload:{operation:args.payload?.operation,consume:args.payload?.consume}}};
    const record=await this.requests.begin(device,method,args,projection);
    const info=await this.ctx.storage.get<Data>('device:'+device);
    let completed=false;
    try {
      const result=await this.rpc(device,method,args,confirmed,signal,info?.request_protocol===1?record:undefined);
      completed=true;
      await this.requests.complete(record.id,false);
      const projected=await this.project(result,{...record.projection,request_id:record.id},actor);
      const socket=this.transport.socket(device);
      if(socket) void this.send(socket,{type:'receipt_ack',request_id:record.id}).catch(()=>{});
      return projected;
    } catch(error) {
      completed ||= (error as Data).receipt_state==='completed';
      if(!completed && (error as Data).device_response && info?.request_protocol===1) {
        // Older clients have no completion envelope. Confirm their durable receipt;
        // an application error and a transport failure are different facts.
        try {
          const receipt=await this.rpc(device,'bridge.recover',{request_id:record.id,seconds:0},false,AbortSignal.timeout(5000));
          completed=receipt.state==='completed';
        } catch { /* No durable confirmation: preserve the recoverable pending record. */ }
      }
      if(completed) await this.requests.complete(record.id,false);
      throw Object.assign(error as Error,{request_id:record.short,device_id:await this.refs.assign('c',device),
        ...(completed?{request_state:'completed'}:{}),
        request_key:record.short,
        recover:{tool:'computer.recover',arguments:{device_id:await this.refs.assign('c',device),request_id:record.short}}});
    }
  }

  private async recover(args:Data,signal:AbortSignal,actor:Actor):Promise<Data> {
    const deadline=Date.now()+((args.seconds || 0)>0?args.seconds*1000:5000);
    const device=await this.refs.raw(args.device_id);
    await this.accounts.assertAccess(actor,device);
    if(!await this.ctx.storage.get('device:'+device)) throw new Error('电脑不存在');
    if(!args.request_id) return {requests:await this.requests.list(device,actor.id)};
    const record=await this.requests.get(args.request_id,device,actor.id);
    let reply:Data;
    try {reply=await this.rpc(device,'bridge.recover',{request_id:record.id,seconds:args.seconds || 0},false,signal,undefined,deadline);}
    catch(error) {
      if(['request_unknown','request_expired'].includes((error as Data).code))
        return {request_id:record.short,state:(error as Data).code==='request_unknown'?'unknown':'expired',
          request_key:record.short,message:(error as Error).message};
      if(['request_pending','connection_interrupted','computer_offline'].includes((error as Data).code)) {
        const latest=await this.requests.get(record.short,device,actor.id);
        return {request_id:record.short,state:latest.state==='completed'?'completed_unclaimed':latest.received_at?'received':'delivery_unconfirmed',
          request_key:record.short,recover:{tool:'computer.recover',arguments:{device_id:args.device_id,request_id:record.short}},
          message:'本次等待已结束；未重做原操作，请继续恢复原请求'};
      }
      if((error as Data).code==='request_missing') return {request_id:record.short,state:'not_received',request_key:record.short,
        message:'电脑尚未收到此请求。重试原调用时携带此 request_key，参数保持不变。'};
      throw error;
    }
    if(reply.state!=='completed') return {request_id:record.short,state:reply.state,
      ...(reply.operation?{operation:await this.refs.assign('o',reply.operation,record.projection.scope)}:{})};
    await this.requests.complete(record.id,false);
    if(reply.response.error) {
      await this.requests.complete(record.id,true);
      const socket=this.transport.socket(device);
      if(socket) void this.send(socket,{type:'receipt_ack',request_id:record.id}).catch(()=>{});
      throw Object.assign(new Error(reply.response.error.message),{code:reply.response.error.code,
        request_id:record.short,request_key:record.short,device_id:args.device_id,request_state:'completed',
        recover:{tool:'computer.recover',arguments:{device_id:args.device_id,request_id:record.short}}});
    }
    const result=await this.project(reply.response.result,{...record.projection,request_id:record.id},actor);
    await this.requests.complete(record.id,true);
    const socket=this.transport.socket(device);
    if(socket) void this.send(socket,{type:'receipt_ack',request_id:record.id}).catch(()=>{});
    return {request_id:record.short,state:'completed',result};
  }

  async approvalResult(id:string,decision:string,caller:string,actor:Actor):Promise<any> {
    await this.checkApproval(id,actor);
    const outcome=await this.approvals.decide(id,decision,caller);
    return this.project(outcome.result,outcome.record.projection,actor);
  }

  private async project(result:Data,projection:Data,actor:Actor):Promise<any> {
    if(!await this.accounts.canAccess(actor,projection.device)) {
      if(result.state==='awaiting_approval' && result.approval) {
        await this.approvals.register(result.approval,projection);
        await this.approvals.revoke(projection.account || 'u1',projection.device);
      }
      throw Object.assign(new Error('账号或设备授权已失效'),{code:'device_forbidden'});
    }
    if(result.state==='awaiting_approval' && result.operation) {
      // A durable exec receipt names its original operation; recover its current state.
      result=await this.rpc(projection.device,'computer.wait',
        {session:projection.args.session,operation:result.operation,seconds:0},false,AbortSignal.timeout(5000));
      if(result.state==='awaiting_approval') {
        const approval=await this.approvals.register(result.approval,projection);
        result={...result,approval:{id:approval.id,expires_at:approval.expires_at,
          url:this.env.PUBLIC_URL+'/manage/command-approval?id='+encodeURIComponent(approval.id)}};
      }
    }
    const {method,device,scope,root,context,selectedFile,legacyWorkspace,args}=projection;
    const instructions=await this.guidance.deliver(context,device,result);
    const selection=await this.refs.assign('v',context,'',{account:projection.account || 'u1'});
    const computerId=instructions.length ? await this.refs.assign('c',device) : '';
    const decorate=(value:Data)=>({...value,
      ...(['computer.open','computer.workspaces'].includes(method)?{context:selection}:{}),
      ...(instructions.length?{instructions:instructions.map(d=>({...d,device_id:computerId}))}:{})});
    if(method==='computer.workspaces') return decorate(result);
    if(method==='computer.modules') return decorate({...result,server_modules:await this.modules.list()});
    if(method==='computer.skills' || method==='computer.agents') {
      if(args.operation==='list') return decorate(await definitionList(this.refs,method,result,scope));
      delete result.protocol;
      return decorate(result);
    }
    if(method==='computer.present') {
      const files=[];
      for(const file of result.files) {
        const token=opaque();
        await this.ctx.storage.put('download:'+token,{...file,device,session:args.session,account:projection.account || 'u1',account_epoch:actor.epoch,expires_at:Date.now()+3600_000});
        files.push({name:file.name,size:file.size,media_type:file.media_type,url:this.env.PUBLIC_URL+'/download/'+token});
      }
      await this.ctx.storage.setAlarm(Date.now()+3600_000);
      return decorate({files});
    }
    if (method === "computer.open") {
      await this.ctx.storage.put("workspace:" + result.session, {device_id: device, path: result.path,context,account:projection.account || 'u1'});
      result.session = await this.refs.assign("s", result.session, "", {device, path: result.path});
      const d = await this.ctx.storage.get<Data>("device:" + device);
      result.computer = {id: await this.refs.assign("c", device), name: d?.display_name ?? d?.name,
        system: result.computer.system, version:result.computer.version, user: result.computer.user, shell: result.computer.shell,
        modules: result.computer.modules};
      return decorate(result);
    }
    const rawOperation = method === 'computer.exec' ? result.operation :
      args.operation && ['computer.wait','computer.input','computer.stop','computer.release'].includes(method) ? args.operation :
      method === "computer.module_call" ? args.payload?.operation : undefined;
    const owner = rawOperation ? await this.refs.assign("o", rawOperation, scope) : undefined;
    const visible = method === "computer.files" ? relativeFiles(result, root) : result;
    if (selectedFile) delete visible.path;
    const projected = await this.refs.output(visible, scope, "", owner);
    if (['computer.exec','computer.wait'].includes(method) && projected.result) {
      const session = await this.refs.assign('s',args.session);
      for (const stream of ['stdout','stderr']) {
        const output=projected.result;
        if (output[stream] && output[stream+'_complete'] === false) {
          output[stream+'_read']={tool:'computer.files',arguments:{session,operation:'read',payload:{
            file_ref:output[stream],offset:output[stream+'_next_offset'],length:16384,version:output[stream+'_version'],
            ...(output[stream+'_binary']?{binary:true}:{})}}};
        }
      }
    }
    if (selectedFile) {
      delete projected.path;
      projected.file_ref = selectedFile;
    }
    if (legacyWorkspace && method !== "computer.image") {
      const workspace = await this.ctx.storage.get<Data>("workspace:" + args.session);
      projected.workspace = await this.refs.assign("s", args.session, "", {device, path: workspace!.path});
    }
    if (method === "computer.release" || method === "computer.module_call" && args.action === "release") {
      if (owner) await this.refs.release(owner);
    } else if (method === "computer.module_call" && args.action === "wait" && result.state !== "running" && args.payload.consume !== false ||
               method === "computer.wait" && result.state !== "running" && args.consume === true) {
      if (owner) await this.refs.release(owner);
    }
    return method==='computer.image' ? projected : decorate(projected);
  }

  async rpc(device:string,method:string,params:Data,confirmed:boolean,signal:AbortSignal,receipt?:Data,
    deadline?:number):Promise<any> {
    return this.transport.rpc(device,method,params,confirmed,signal,receipt,deadline);
  }
  private async send(ws:DeviceSocket,value:Data):Promise<void> {
    this.transport.control(ws,value);
  }

  async webSocketMessage(ws: DeviceSocket, message: string | ArrayBuffer): Promise<void> {
    const value=await this.transport.message(ws,typeof message==='string'?message:new TextDecoder().decode(message));
    if(!value) return;
    const device=(ws.deserializeAttachment() as Data).device_id;
    if (value.type === "hello") {
      const {lock_mode:status,...info}=value.info;
      const record=await this.ctx.storage.transaction(async tx=>{
        const current=await tx.get<Data>('device:'+device);
        if(current) await tx.put('device:'+device,{...current,...info,id:device,key_hash:current.key_hash,
          access:current.access,access_applied:info.access_revision,last_seen:Date.now(),lock_mode_status:status});
        return current;
      });
      if(status) void this.syncPower(device,new AbortController().signal);
      this.transport.ready(ws,info);
      void this.approvals.flush(device);
      if(info.capabilities?.includes('updates_v1')) void this.updates.connected(device);
      if(record?.access) {
        void this.rpc(device,'computer.configure',{access:record.access},false,new AbortController().signal)
          .then(async reply=>{const latest=await this.ctx.storage.get<Data>('device:'+device);
            if(latest?.access.revision===reply.revision) await this.ctx.storage.put('device:'+device,{...latest,access:reply.access,access_applied:reply.revision,access_error:''});})
          .catch(async error=>{const latest=await this.ctx.storage.get<Data>('device:'+device);
            if(latest) await this.ctx.storage.put('device:'+device,{...latest,access_error:error.message});});
      }
    } else if (value.type === 'update_status') {
      await this.updates.report(device,value.jobs);
    } else if (value.type === "power_status") {
      await this.powerStatus(device,value.status);
    } else if (value.type === "human") {
      // Human approval is obtained by the MCP handler before forwarding this action.
      await this.send(ws, {type: "human_response", id: value.id, accepted: false});
    }
  }

  async webSocketClose(ws: DeviceSocket, code: number, reason: string): Promise<void> {
    this.latency.clear(ws);
    this.transport.close(ws);
  }
  async webSocketError(ws: DeviceSocket): Promise<void> {await this.webSocketClose(ws, 1011, "Device transport error");}

  async alarm(): Promise<void> {
    await this.approvals.expire();
    for (const prefix of ["pair:", "human:", "download:"]) {
      for (const [key, value] of await this.ctx.storage.list<Data>({prefix})) {
        const now = prefix === "pair:" ? Date.now() / 1000 : Date.now();
        if (value.expires_at < now) {
          await this.ctx.storage.delete(key);
          if (value.code) await this.ctx.storage.delete("code:" + value.code);
        }
      }
    }
  }
}
