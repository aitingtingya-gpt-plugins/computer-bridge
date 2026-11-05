import OAuthProvider, {type OAuthHelpers} from "@cloudflare/workers-oauth-provider";
import {escape, hash, json, opaque, page as renderPage, type Data} from "./types";
import {devicesPage, styles, cardStyles} from "./ui";
import {accountsPage,profilePage,loginFields,accountStyles} from './accounts_ui';
import type {ApplicationEnv} from "./runtime";
import {VERSION} from './releases';
import {installedModules} from './modules';
import {chatPage,chatBindingPage,chatStyles} from './chat_ui';
import {markdownAsset} from './chat_assets';

type AuthEnv = ApplicationEnv & {OAUTH_PROVIDER: OAuthHelpers};
const page = (title: string, body: string, headers?: HeadersInit, pageClass = '') => renderPage(title, body, headers, styles+cardStyles+accountStyles+chatStyles,pageClass);
const expiredCookie='bridge_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';

/** Only verified application identities may become the hub's actor. Never forward a form/JSON actor. */
async function control(env: ApplicationEnv, action: string, body: Data = {}, actor?:Data): Promise<Response> {
  const {actor: _suppliedActor, ...parameters}=body;
  return env.service(new Request("https://internal/internal/" + action, {method: "POST", body: JSON.stringify({
    ...parameters,...(actor?{actor:{id:actor.id,epoch:actor.epoch}}:{})}), headers: {"Content-Type": "application/json"}}));
}
async function signature(env: ApplicationEnv, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BRIDGE_SECRET),
    {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function identity(request: Request, env: ApplicationEnv): Promise<Data | null> {
  const raw = request.headers.get("cookie")?.match(/(?:^|;\s*)bridge_admin=([^;]+)/)?.[1];
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || mac !== await signature(env, payload)) return null;
  const value = JSON.parse(atob(payload));
  if(value.expires_at<=Date.now()) return null;
  const response=await control(env,'accounts-auth',value.id?{id:value.id,epoch:value.epoch}:{legacy:true});
  const {actor}=await response.json<Data>();
  return actor?{...actor,nonce:value.nonce,expires_at:value.expires_at}:null;
}
async function sessionCookie(env: ApplicationEnv,actor:Data): Promise<string> {
  const payload = btoa(JSON.stringify({id:actor.id,epoch:actor.epoch,nonce: opaque(), expires_at: Date.now() + 3600_000}));
  return `bridge_admin=${payload}.${await signature(env, payload)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`;
}
async function login(form: FormData, env: ApplicationEnv): Promise<Data|null> {
  const response=await control(env,'accounts-login',{username:String(form.get('username') || 'admin'),
    password:String(form.get('password') || form.get('key') || '')});
  return (await response.json<Data>()).actor || null;
}
function loginPage(title:string,form:FormData|null,extra=''):Response {
  return page(title,`<section class="auth-card">${form?'<div class="notice error" role="alert">用户名或密码不正确。</div>':''}<form method="post">${loginFields(String(form?.get('username') || 'admin'))}${extra}<button class="full-width">登录 <span aria-hidden="true">→</span></button></form></section>`);
}

async function management(request: Request, env: ApplicationEnv): Promise<Response> {
  const url = new URL(request.url);
  const actor = await identity(request, env);
  const form = request.method === "POST" ? await request.formData() : null;
  if(!actor) {
    const logged=form && await login(form,env);
    if(logged) return new Response(null,{status:303,headers:{Location:'/manage?code='+encodeURIComponent(String(form!.get('code') || '')),
      'Set-Cookie':await sessionCookie(env,logged),'Cache-Control':'no-store'}});
    return loginPage('设备管理',form,`<input type="hidden" name="code" value="${escape(url.searchParams.get('code') || '')}">${url.searchParams.get('notice')==='password_changed'?'<p class="notice">密码已更新，请重新登录。</p>':''}`);
  }
  let error = "", errorStatus=400;
  const view:Data={device:url.searchParams.get('device') || '',actor};
  if (form) {
    if (form.get("csrf") !== actor.nonce) return json({error: "invalid_form"}, 403);
    if(form.get('id')) view.device=String(form.get('id'));
    if(['workspace_save','workspace_cancel'].includes(String(form.get('action')))) view.draft={
      id:String(form.get('workspace_id') || ''),name:String(form.get('workspace_name') || ''),
      path:String(form.get('workspace_path') || ''),
      additional:String(form.get('additional') || '').split(/\r?\n/).map(p=>p.trim()).filter(Boolean)};
    let response:Response|undefined;
    const action=String(form.get('action') || '');
    if(action==='logout') return new Response(null,{status:303,headers:{Location:'/manage','Set-Cookie':expiredCookie}});
    if(action==='password') {
      response=await control(env,'accounts-profile',{password:String(form.get('password') || '')},actor);
      if(response.ok) return new Response(null,{status:303,headers:{Location:'/manage?notice=password_changed','Set-Cookie':expiredCookie}});
    } else if(action==='approve') response=await control(env,'approve',{code:String(form.get('code') || '')},actor);
    else if(action==='remove') response=await control(env,'remove',{id:String(form.get('id'))},actor);
    else if(action==='rename') response=await control(env,'rename',{id:String(form.get('id')),name:String(form.get('name') || '')},actor);
    else if(action==='grant' || action==='revoke') {
      if(actor.role!=='admin') return json({error:'admin_required'},403);
      response=await control(env,'accounts-'+action,{id:String(form.get('id')),user_id:String(form.get('user_id'))},actor);
    } else if(action==='lock_mode') response=await control(env,'lock-mode',{id:String(form.get('id')),enabled:form.get('enabled')==='on'},actor);
    else if(['access','workspace_save','workspace_remove'].includes(action)) {
      response=await control(env,'access',{action,id:String(form.get('id')),full_access:form.get('full_access')==='on',
        workspace_id:String(form.get('workspace_id') || ''),name:String(form.get('workspace_name') || ''),
        path:String(form.get('workspace_path') || ''),
        additional:String(form.get('additional') || '').split(/\r?\n/).map(p=>p.trim()).filter(Boolean),
        create_missing:form.get('create_missing')==='on'},actor);
      if(response.ok) {
        const result=await response.clone().json<Data>();
        if(result.confirmation) view.confirmation=result.confirmation;
        if(result.offline) view.notice='workspace_pending';
      }
    } else if(action!=='workspace_cancel') return json({error:'unknown_action'},400);
    if(response && !response.ok) {error=(await response.json<Data>()).error;errorStatus=response.status;}
    if (!error && !view.confirmation && action!=='workspace_cancel') return Response.redirect(
      env.PUBLIC_URL + '/manage?notice=' + encodeURIComponent(view.notice || action)+'&device='+encodeURIComponent(view.device),303);
  }
  view.error=error;
  view.updates=await (await control(env,'update-view',{},actor)).json<Data>();
  if(actor.role==='admin') view.users=(await (await control(env,'accounts-list',{},actor)).json<Data>()).users;
  const list = await (await control(env, "list",{},actor)).json<Data>();
  const response = page("设备管理", devicesPage(list.computers, actor.nonce,
    url.searchParams.get("code") || "", url.searchParams.get("notice") || "", error,view),undefined,'management-page');
  return error ? new Response(response.body, {status:errorStatus, headers: response.headers}) : response;
}

async function accountManagement(request:Request,env:ApplicationEnv):Promise<Response> {
  const actor=await identity(request,env);
  if(!actor) return Response.redirect(env.PUBLIC_URL+'/manage',303);
  if(actor.role!=='admin') return json({error:'admin_required'},403);
  let result:Data|undefined,error='';
  if(request.method==='POST') {
    const form=await request.formData();
    if(form.get('csrf')!==actor.nonce) return json({error:'invalid_form'},403);
    const action=String(form.get('action'));
    let route='accounts-update',body:Data={id:String(form.get('id') || '')};
    if(action==='create') {route='accounts-create';body={username:String(form.get('username') || ''),password:String(form.get('password') || '') || undefined};}
    else if(action==='delete') route='accounts-delete';
    else if(action==='update') body.username=String(form.get('username') || '');
    else if(action==='password') body.password=String(form.get('password') || '');
    else if(action==='enable' || action==='disable') body.enabled=action==='enable';
    else return json({error:'unknown_action'},400);
    const response=await control(env,route,body,actor);
    const value=await response.json<Data>();
    if(response.ok) result=value;else error=value.error;
  }
  const {users}=await (await control(env,'accounts-list',{},actor)).json<Data>();
  const response=page('账号管理',accountsPage(actor,users,actor.nonce,result,error),undefined,'management-page');
  return error?new Response(response.body,{status:400,headers:response.headers}):response;
}

async function profile(request:Request,env:ApplicationEnv):Promise<Response> {
  const logged=await identity(request,env);
  if(!logged) return Response.redirect(env.PUBLIC_URL+'/manage',303);
  let actor:Data=logged;
  let error='',saved=false;
  if(request.method==='POST') {
    const form=await request.formData();
    if(form.get('csrf')!==actor.nonce) return json({error:'invalid_form'},403);
    const password=String(form.get('password') || '');
    const response=await control(env,'accounts-profile',{username:String(form.get('username') || ''),...(password?{password}:{})},actor);
    const value=await response.json<Data>();
    if(!response.ok) error=value.error;
    else if(password) return new Response(null,{status:303,headers:{Location:'/manage?notice=password_changed','Set-Cookie':expiredCookie}});
    else {actor={...actor,...(value.user || value.actor)};saved=true;}
  }
  const response=page('我的账号',profilePage(actor,actor.nonce,error,saved),undefined,'management-page');
  return error?new Response(response.body,{status:400,headers:response.headers}):response;
}

async function commandApproval(request: Request, env: ApplicationEnv): Promise<Response> {
  const url=new URL(request.url);
  const id=url.searchParams.get('id') || '';
  if(!/^approval_[a-f0-9]+$/.test(id)) return json({error:'invalid_approval'},400);
  const actor=await identity(request,env);
  const form=request.method==='POST' ? await request.formData() : null;
  if(!actor) {
    const logged=form && await login(form,env);
    if(logged) return new Response(null,{status:303,headers:{Location:'/manage/command-approval?id='+encodeURIComponent(id),'Set-Cookie':await sessionCookie(env,logged)}});
    return loginPage('命令审批',form);
  }
  let error='',errorStatus=400;
  if(form) {
    if(form.get('csrf')!==actor.nonce) return json({error:'invalid_form'},403);
    const decision=String(form.get('decision') || '');
    if(!['allowed-once','rejected','cancelled'].includes(decision)) return json({error:'invalid_decision'},400);
    const response=await control(env,'command-approval',{id,decision},actor);
    const value=await response.json<Data>();
    if(response.ok) return page('命令审批','<p>决定已提交。请回到原对话继续等待同一任务。</p>');
    error=value.error;errorStatus=response.status;
  }
  const response=await control(env,'command-approval',{id},actor);
  const details=await response.json<Data>();
  if(!response.ok) {
    const denied=page('命令审批',`<p role="alert">${escape(details.error || '电脑暂不可用，请稍后刷新。')}</p>`);
    return new Response(denied.body,{status:response.status,headers:denied.headers});
  }
  const pending=details.state==='pending' && details.expires_at*1000>Date.now();
  const rendered=page('命令审批',`<section class="auth-card">${error?'<p role="alert">'+escape(error)+'</p>':''}
    <p>设备 ${escape(details.device)}</p><p>工作目录 ${escape(details.cwd)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(details.command)}</pre>
    <p>申请理由 ${escape(details.justification || '')}</p><p>本次命令以当前登录用户权限在工作区沙盒外运行，授权包含其子进程及后续交互输入。</p>
    <p>状态 ${escape(details.state)} · 有效期至 ${escape(new Date(details.expires_at*1000).toISOString())}</p>
    ${pending?'<form method="post"><input type="hidden" name="csrf" value="'+escape(actor.nonce)+'"><button name="decision" value="allowed-once">接受</button> <button name="decision" value="rejected">拒绝</button> <button name="decision" value="cancelled">取消</button></form>':''}</section>`);
  return error?new Response(rendered.body,{status:errorStatus,headers:rendered.headers}):rendered;
}

async function download(request:Request,env:ApplicationEnv):Promise<Response> {
  const url=new URL(request.url);
  const actor=await identity(request,env);
  if(!['GET','HEAD','POST'].includes(request.method)) return json({error:'method_not_allowed'},405);
  if(!actor) {
    const form=request.method==='POST'?await request.formData():null;
    const logged=form && await login(form,env);
    if(logged) return new Response(null,{status:303,headers:{Location:url.pathname+url.search,
      'Set-Cookie':await sessionCookie(env,logged),'Cache-Control':'no-store'}});
    return loginPage('下载文件',form);
  }
  if(request.method==='POST') return Response.redirect(env.PUBLIC_URL+url.pathname+url.search,303);
  const headers=new Headers(request.headers);
  headers.set('x-computer-bridge-account',actor.id);
  headers.set('x-computer-bridge-epoch',String(actor.epoch));
  return env.service(new Request(request,{headers}));
}

const chatActions=new Set(['list','create','get','history','sync','timing','send','rename','delete','upload-start','upload-chunk',
  'upload-complete','attachment','read-attachment','devices','approvals','approval-details','approval-decide']);

/** Native device credentials are supplied in headers, never in a URL or browser cookie. */
function nativeChatCredentials(request:Request):Data|null {
  const device_id=request.headers.get('x-computer-bridge-device');
  if(!device_id)return null;
  const authorization=request.headers.get('authorization');
  return {device_id,device_key:authorization?.startsWith('Bearer ')?authorization.slice(7):''};
}

/** Authenticate human-only live notifications using the same account/device checks as HTTP. */
export async function authorizeChatLive(request:Request,env:ApplicationEnv):Promise<Data|Response> {
  const url=new URL(request.url),chat_id=url.searchParams.get('chat_id') || '';
  if(request.method!=='GET' || !/^t[1-9][0-9]*$/.test(chat_id))return json({error:'invalid_chat'},400);
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(env.PUBLIC_URL).origin)return json({error:'invalid_origin'},403);
  const authorization=request.headers.get('authorization');
  const native=nativeChatCredentials(request);
  if(native) {
    const selected=await control(env,'chat-native-action',{...native,action:'get',parameters:{chat_id}});
    if(!selected.ok)return selected;
    const response=await control(env,'chat-native-auth',native);
    if(!response.ok)return response;
    return {chat_id,principal:(await response.json<Data>()).principal,expires_at:null};
  }
  let actor:Data,expires_at:number|null=null;
  if(authorization?.startsWith('Bearer ')) {
    const credential=authorization.slice(7);
    const selected=await control(env,'chat-credential-action',{credential,action:'get',parameters:{chat_id}});
    if(!selected.ok)return selected;
    const response=await control(env,'chat-credential-auth',{credential});
    if(!response.ok)return response;
    actor=(await response.json<Data>()).actor;
  } else {
    const logged=await identity(request,env);
    if(!logged)return json({error:'login_required'},401);
    actor=logged;expires_at=logged.expires_at;
    const selected=await control(env,'chat-get',{chat_id},actor);
    if(!selected.ok)return selected;
  }
  return {chat_id,principal:{kind:'account',actor:{id:actor.id,epoch:actor.epoch}},expires_at};
}

async function chatApi(request:Request,env:ApplicationEnv,action:string):Promise<Response> {
  if(request.method!=='POST') return json({error:'method_not_allowed'},405);
  if(!chatActions.has(action)) return json({error:'unknown_action'},404);
  const supplied=await request.json<Data>();
  const {actor:_,credential:__,chat_credential:___,source:____,csrf:_____,principal:______,device_key:_______,...args}=supplied;
  const authorization=request.headers.get('authorization');
  const native=nativeChatCredentials(request);
  if(native)return control(env,'chat-native-action',{...native,action,parameters:args});
  if(authorization?.startsWith('Bearer ')) return control(env,'chat-credential-action',{
    credential:authorization.slice(7),action,parameters:args});
  const actor=await identity(request,env);
  if(!actor) return json({error:'login_required'},401);
  if(supplied.csrf!==actor.nonce || request.headers.has('origin') && request.headers.get('origin')!==new URL(env.PUBLIC_URL).origin)
    return json({error:'invalid_form'},403);
  return control(env,'chat-'+action,{...args,source:'web'},actor);
}

async function chat(request:Request,env:ApplicationEnv):Promise<Response> {
  const url=new URL(request.url);
  const actor=await identity(request,env);
  const form=request.method==='POST'?await request.formData():null;
  if(!actor) {
    const logged=form && await login(form,env);
    if(logged) return new Response(null,{status:303,headers:{Location:url.pathname+url.search,
      'Set-Cookie':await sessionCookie(env,logged),'Cache-Control':'no-store'}});
    return loginPage(url.pathname==='/chat/connect'?'连接终端聊天':'聊天',form);
  }
  if(url.pathname==='/chat/connect') {
    const code=url.searchParams.get('code') || '';
    if(!code) return json({error:'missing_code'},400);
    if(form) {
      if(form.get('csrf')!==actor.nonce) return json({error:'invalid_form'},403);
      const decision=String(form.get('decision'));
      if(!['approve','deny'].includes(decision))return json({error:'invalid_decision'},400);
      const response=await control(env,'chat-link-'+decision,{code},actor);
      const value=await response.json<Data>();
      if(response.ok) return page('连接终端聊天',`<section class="auth-card"><h2>${decision==='approve'?'已连接':'已取消'}</h2><p>${decision==='approve'?'请回到终端继续聊天。':'终端连接没有获得授权。'}</p><a href="/chat">打开网页聊天 →</a></section>`);
      return page('连接终端聊天',`<p class="notice error" role="alert">${escape(value.error || '连接未完成')}</p>`);
    }
    const response=await control(env,'chat-link-details',{code},actor);
    const value=await response.json<Data>();
    if(!response.ok) return new Response(page('连接终端聊天',`<p class="notice error" role="alert">${escape(value.error || '连接已失效')}</p>`).body,{status:response.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    return page('连接终端聊天',chatBindingPage(actor,value,actor.nonce));
  }
  if(request.method==='POST') return Response.redirect(env.PUBLIC_URL+url.pathname+url.search,303);
  const response=await control(env,'list',{},actor);
  const {computers}=await response.json<Data>();
  return page('聊天',chatPage(actor,computers || [],url.searchParams.get('device') || '',url.searchParams.get('id') || ''),undefined,'management-page chat-page');
}

async function chatDownload(request:Request,env:ApplicationEnv):Promise<Response> {
  if(request.method!=='GET' && request.method!=='HEAD') return json({error:'method_not_allowed'},405);
  const url=new URL(request.url);
  const match=/^\/chat\/files\/(t[1-9][0-9]*)\/(a[1-9][0-9]*)$/.exec(url.pathname);
  if(!match)return json({error:'invalid_attachment'},400);
  const authorization=request.headers.get('authorization');
  const native=nativeChatCredentials(request);
  let response:Response;
  if(native)response=await control(env,'chat-native-download',{...native,chat_id:match[1],attachment_id:match[2]});
  else if(authorization?.startsWith('Bearer ')) response=await control(env,'chat-credential-download',{
    credential:authorization.slice(7),chat_id:match[1],attachment_id:match[2]});
  else {
    const actor=await identity(request,env);
    if(!actor)return Response.redirect(env.PUBLIC_URL+'/chat',303);
    response=await control(env,'chat-download',{chat_id:match[1],attachment_id:match[2]},actor);
  }
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
  if(url.searchParams.get('inline')==='1' && ['image/png','image/jpeg','image/webp','image/gif'].includes(headers.get('Content-Type') || ''))
    headers.set('Content-Disposition','inline');
  if(request.method==='HEAD') await response.body?.cancel();
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
}

async function defaults(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const asset=markdownAsset(url.pathname);if(asset && request.method==='GET')return asset;
  if (url.pathname === "/authorize") {
    const oauth = env.OAUTH_PROVIDER;
    if (request.method === "GET") {
      const auth = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(auth);
      const consent = await oauth.beginConsent(auth);
      const logged = await identity(request, env);
      return page("授权连接", `<section class="auth-card"><div class="auth-details">客户端：<strong>${escape(details.clientName)}</strong><br>
        授权回到：${escape(details.redirectHost)}<br>权限：${details.scope.map(escape).join(", ")} · 当前账号获授权的电脑${logged?'<br>账号：'+escape(logged.username)+' · '+escape(logged.id):''}</div>
        <form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}">${logged?'':loginFields()}
        <input type="hidden" name="scope" value="computer"><button name="decision" value="approve">授权连接</button><button name="decision" value="deny" formnovalidate>取消</button></form></section>`, consent.headers);
    }
    const form = await request.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, {status: 302, headers: denied.headers});
    }
    const actor=await identity(request,env) || await login(form,env);
    if(!actor) return json({error:'invalid_credentials'},403);
    const approved = await oauth.approveConsent(request, handle, {scope: ["computer"]});
    const result = await oauth.completeAuthorization({request: approved.request, userId:actor.id, metadata:{},
      scope:approved.request.scope,props:{account_id:actor.id,account_epoch:actor.epoch}});
    approved.headers.set("Location", result.redirectTo);
    return new Response(null, {status: 302, headers: approved.headers});
  }
  if (url.pathname === "/manage/command-approval") return commandApproval(request,env);
  if (url.pathname === "/manage") return management(request, env);
  if (url.pathname === "/manage/accounts") return accountManagement(request,env);
  if (url.pathname === "/manage/profile") return profile(request,env);
  if(url.pathname==='/chat' || url.pathname==='/chat/connect') return chat(request,env);
  if(url.pathname==='/chat/live') {
    if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return json({error:'websocket_required'},426);
    const identity=await authorizeChatLive(request,env);
    if(identity instanceof Response)return identity;
    const headers=new Headers();
    headers.set('Upgrade','websocket');
    headers.set('x-computer-bridge-chat',JSON.stringify(identity));
    return env.service(new Request('https://internal/chat/live',{headers}));
  }
  if(url.pathname.startsWith('/chat/api/')) return chatApi(request,env,url.pathname.slice('/chat/api/'.length));
  if(url.pathname.startsWith('/chat/files/')) return chatDownload(request,env);
  if(url.pathname==='/chat/device/session' && request.method==='POST') {
    const native=nativeChatCredentials(request);
    if(!native)return json({error:'device_unauthorized',code:'device_unauthorized'},401);
    return control(env,'chat-native-session',native);
  }
  if((url.pathname==='/chat/device/start' || url.pathname==='/chat/device/poll') && request.method==='POST') {
    const body=await request.json<Data>();
    return control(env,url.pathname.endsWith('/start')?'chat-link-start':'chat-link-poll',body);
  }
  if(url.pathname==='/manage/updates') {
    const actor=await identity(request,env);
    if(!actor) return json({error:'login_required'},401);
    if(request.method==='GET') return control(env,'update-view',{},actor);
    const body=await request.json<Data>();
    if(body.csrf!==actor.nonce) return json({error:'invalid_form'},403);
    if(!['update-view','update-source','update-start','update-cancel'].includes(body.action)) return json({error:'unknown_action'},400);
    if(body.action==='update-source' && actor.role!=='admin') return json({error:'admin_required'},403);
    return control(env,body.action,body,actor);
  }
  if (url.pathname === "/manage/connections" && request.method==='GET') {
    const actor=await identity(request,env);
    if(!actor) return json({error:'login_required'},401);
    return control(env,'connections',{device_id:url.searchParams.get('device_id') || undefined,force:url.searchParams.get('force')==='1'},actor);
  }
  if (url.pathname === "/device/pair" && request.method === "POST") return control(env, "pair", await request.json<Data>());
  if (url.pathname.startsWith("/device/pair/") && request.method === "GET") return control(env, "poll", {id: url.pathname.slice("/device/pair/".length)});
  if (url.pathname === "/device/connect") return env.service(request);
  if(url.pathname.startsWith('/device/update-asset/')) return env.service(request);
  if(url.pathname.startsWith('/device/bootstrap')) return env.service(request);
  if (url.pathname.startsWith('/download/')) return download(request,env);
  if (url.pathname === "/health") return json({service: "computer-bridge", version: VERSION,modules:installedModules.map(module=>({id:module.id,version:module.version}))});
  if (url.pathname === "/") return page("Computer Bridge", '<a href="/manage">设备管理</a> · <a href="/chat">聊天</a>');
  return json({error: "not_found"}, 404);
}

export async function serveApplication(request: Request, env: ApplicationEnv, ctx: ExecutionContext): Promise<Response> {
  const provider = new OAuthProvider<ApplicationEnv>({apiRoute: "/mcp", apiHandler: {async fetch(req: Request, bindings: ApplicationEnv, context: any) {
    if(!context.auth?.clientId || !context.auth?.userId) return json({error:'auth_context_missing'},403);
    const legacy=context.props?.group==='shared' && context.auth.userId==='shared';
    if(!legacy && context.props?.account_id!==context.auth.userId) return json({error:'account_missing'},403);
    const authenticated=await control(bindings,'accounts-auth',legacy?{legacy:true}:{id:context.auth.userId,epoch:context.props.account_epoch});
    const {actor}=await authenticated.json<Data>();
    if(!actor) return json({error:'account_access_expired'},401);
    const headers=new Headers(req.headers);
    headers.set('x-computer-bridge-account',actor.id);
    headers.set('x-computer-bridge-epoch',String(actor.epoch));
    // Keep legacy caller fingerprints stable for existing operation/approval receipts.
    headers.set('x-computer-bridge-caller',await hash(JSON.stringify({client:context.auth.clientId,user:context.auth.userId,audience:context.auth.audience})));
    return bindings.service(new Request(req,{headers}));
  }},defaultHandler:{fetch:(req,bindings)=>defaults(req,bindings as AuthEnv)},authorizeEndpoint:'/authorize',tokenEndpoint:'/token',
    clientRegistrationEndpoint:'/register',scopesSupported:['computer'],requiredScopes:['computer'],
    resourceMetadata:{resource:env.PUBLIC_URL+'/mcp',authorization_servers:[env.PUBLIC_URL]},accessTokenTTL:3600,refreshTokenTTL:30*86400});
  try{return await provider.fetch(request,env,ctx);}
  catch(error){console.error('gateway',(error as Error).name,(error as Error).message);return json({error:(error as Error).message},400);}
}
