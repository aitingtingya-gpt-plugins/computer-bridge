import {escape,type Data} from './types';

export function modulePanel(target:string,states:Data[],available:string[],supported:boolean):string {
  const names=[...new Set([...available,...states.map(m=>m.id)])];
  return `<section class="module-management" data-module-target="${escape(target)}"><h3>可选模块</h3>${names.map(name=>{
    const state=states.find(m=>m.id===name);
    const label:Record<string,string>={available:'可用',disabled:'未启用',missing_dependency:'缺少依赖',incompatible:'版本不兼容',not_installed:'未安装'};
    return `<div class="module-row"><div><strong>${escape(name)}</strong><span class="field-note"> ${escape(state?.version || '')} · ${label[state?.state] || '未安装'}</span></div>
      <div class="update-actions">${(state?.installed?['module_update',state.enabled?'module_disable':'module_enable','module_remove']:['module_install']).map(kind=>
        `<button type="button" data-update-target="${escape(target)}" data-module="${escape(name)}" data-update-kind="${kind}" ${supported?'':'disabled'}>${({module_install:'安装',module_update:'更新',module_enable:'启用',module_disable:'停用',module_remove:'卸载'} as Data)[kind]}</button>`).join('')}</div></div>`;
  }).join('') || '<p class="field-note">检查更新后查看可安装模块。</p>'}</section>`;
}

export function deviceUpdates(device:Data,available:string[]):string {
  const supported=device.online && device.capabilities?.includes('updates_v1');
  return `<section class="device-updates"><div class="update-heading"><span>版本 <code data-device-version="${escape(device.id)}">${escape(device.version || '未知')}</code></span>
    <label class="update-select"><input type="checkbox" name="update-device" value="${escape(device.id)}" ${supported?'':'disabled'}>选择更新</label></div>
    ${device.capabilities?.includes('updates_v1')?'':'<p class="field-note">需要先安装更新组件。</p>'}
    ${modulePanel(device.id,device.module_versions || [],available,supported)}</section>`;
}

export function updatesPanel(value:Data,nonce:string):string {
  const source=value.source;
  const server=value.server;
  const available=[...new Set<string>((value.catalogue?.releases || []).flatMap((r:Data)=>r.manifest.artifacts.map((a:Data)=>a.module).filter(Boolean)))];
  return `<section class="updates-panel" data-updates data-csrf="${escape(nonce)}">
    <div class="update-heading"><h2>版本与更新</h2>${server?`<span>中转服务 <code data-server-version>${escape(server.version)}</code></span>`:''}</div>
    ${source?`<form data-update-source class="update-source"><label>GitHub 仓库<input name="repository" value="${escape(source.repository)}" required></label>
      <label>更新渠道<select name="channel"><option value="stable" ${source.channel==='stable'?'selected':''}>正式版</option><option value="preview" ${source.channel==='preview'?'selected':''}>测试版</option></select></label>
      <button>保存来源</button></form>`:''}
    <div class="update-actions"><button type="button" data-update-check>检查更新</button>
      ${server?`<button type="button" data-update-target="server" data-update-kind="core" ${server.update_supported?'':'disabled'}>更新中转服务</button>`:''}
      <button type="button" data-update-selected>更新所选电脑</button></div>
    ${server && !server.update_supported?'<p class="field-note">服务端需要先安装更新执行器。</p>':''}
    <p data-update-message role="status"></p><div data-release-summary></div>
    ${server?modulePanel('server',server.modules,available,server.update_supported):''}
    <div data-update-jobs></div></section>`;
}

export const updatesScript=`<script>(()=>{
 const panel=document.querySelector('[data-updates]');if(!panel)return;
 const labels={preparing:'准备中',waiting_idle:'等待空闲',installing:'安装中',switching:'切换中',verifying:'验证中',rolling_back:'恢复原版中',rollback_verifying:'核验原版恢复',completed:'已完成',failed:'失败',cancelled:'已取消',rolled_back:'已恢复原版'};
 const message=panel.querySelector('[data-update-message]');let timer,controller,reading=false,expired=false;
 async function request(body){const response=await fetch('/manage/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,csrf:panel.dataset.csrf})});const data=await response.json();if(!response.ok)throw Error(data.error || '操作失败');return data;}
 function show(value){
  const serverVersion=panel.querySelector('[data-server-version]');if(serverVersion && value.server)serverVersion.textContent=value.server.version;
  for(const device of value.devices || []){
   const version=[...document.querySelectorAll('[data-device-version]')].find(e=>e.dataset.deviceVersion===device.id);
   if(version)version.textContent=device.version || '未知';
   const selected=[...document.querySelectorAll('[name=update-device]')].find(e=>e.value===device.id);
   if(selected)selected.disabled=!device.update_supported;
  }
  const summary=panel.querySelector('[data-release-summary]');
  if(value.catalogue){const newest=value.catalogue.releases[0];summary.textContent=newest?'最新发布 '+newest.version+' · '+new Date(newest.published_at).toLocaleString()+'\\n'+newest.notes:'所选渠道暂无发布版本';}
  const jobs=panel.querySelector('[data-update-jobs]');const fragment=document.createDocumentFragment();
  for(const job of value.jobs || []){const row=document.createElement('div');row.className='update-job';const text=document.createElement('span');text.textContent=job.id+' · '+(job.target==='server'?'中转服务':job.target)+' · '+job.version+' · '+(labels[job.state] || job.state)+' · '+job.message;row.append(text);
   if(['preparing','installing','waiting_idle'].includes(job.state)){const cancel=document.createElement('button');cancel.type='button';cancel.dataset.updateCancel=job.id;cancel.textContent='取消';row.append(cancel);}fragment.append(row);}
  jobs.replaceChildren(fragment);
  const available=[...new Set((value.catalogue?.releases || []).flatMap(r=>r.manifest.artifacts.map(a=>a.module).filter(Boolean)))];
  for(const target of [...(value.server?[{...value.server,id:'server'}]:[]),...(value.devices || [])]){
   const section=[...document.querySelectorAll('[data-module-target]')].find(e=>e.dataset.moduleTarget===target.id);if(!section)continue;
   const stamp=JSON.stringify([target.modules,available,target.update_supported]);if(section.dataset.stamp===stamp)continue;section.dataset.stamp=stamp;
   const heading=document.createElement('h3');heading.textContent='可选模块';section.replaceChildren(heading);
   for(const name of new Set([...available,...target.modules.map(m=>m.id)])){
    const state=target.modules.find(m=>m.id===name),row=document.createElement('div');row.className='module-row';
    const text=document.createElement('span');text.textContent=name+' '+(state?.version || '')+' · '+({available:'可用',disabled:'未启用',missing_dependency:'缺少依赖',incompatible:'版本不兼容'}[state?.state] || '未安装');row.append(text);
    const actions=document.createElement('div');actions.className='update-actions';
    for(const kind of state?.installed?['module_update',state.enabled?'module_disable':'module_enable','module_remove']:['module_install']){
     const b=document.createElement('button');b.type='button';b.dataset.updateTarget=target.id;b.dataset.module=name;b.dataset.updateKind=kind;b.disabled=!target.update_supported;
     b.textContent={module_install:'安装',module_update:'更新',module_disable:'停用',module_enable:'启用',module_remove:'卸载'}[kind];actions.append(b);
    }row.append(actions);section.append(row);
   }
  }
 }
 async function refresh(){if(document.hidden || reading || expired)return;reading=true;controller=new AbortController();try{const r=await fetch('/manage/updates',{signal:controller.signal});if(r.ok)show(await r.json());else if(r.status===401){expired=true;clearInterval(timer);message.textContent='登录已过期';}}catch(e){if(e.name!=='AbortError')message.textContent='等待恢复更新状态';}finally{reading=false;}}
 document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;let body;
  if(button.hasAttribute('data-update-check'))body={action:'update-view',force:true};
  else if(button.hasAttribute('data-update-target'))body={action:'update-start',targets:[button.dataset.updateTarget],kind:button.dataset.updateKind,module:button.dataset.module};
  else if(button.hasAttribute('data-update-selected'))body={action:'update-start',targets:[...document.querySelectorAll('[name=update-device]:checked')].map(e=>e.value),kind:'core'};
  else if(button.dataset.updateCancel)body={action:'update-cancel',id:button.dataset.updateCancel};else return;
  event.preventDefault();event.stopPropagation();button.disabled=true;message.textContent='正在处理…';try{const value=await request(body);if(body.action==='update-view')show(value);message.textContent=value.outcomes?value.outcomes.map(r=>r.target+'：'+(r.error || r.job.message)).join('；'):'操作完成';await refresh();}catch(e){message.textContent=e.message;}finally{button.disabled=false;}
 });
 panel.querySelector('[data-update-source]')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.target);try{await request({action:'update-source',repository:form.get('repository'),channel:form.get('channel')});message.textContent='来源已保存';}catch(e){message.textContent=e.message;}});
 function start(){clearInterval(timer);if(!document.hidden && !expired){refresh();timer=setInterval(refresh,5000);}else controller?.abort();}
 document.addEventListener('visibilitychange',start);addEventListener('pagehide',()=>{clearInterval(timer);controller?.abort();});start();
})()</script>`;

export const updateStyles=`.updates-panel{background:white;border:1px solid var(--line);border-radius:15px;padding:24px;margin-bottom:26px}.update-heading{display:flex;justify-content:space-between;gap:14px;align-items:center}.update-source{display:flex;gap:12px;align-items:end;margin:20px 0}.update-source label:first-child{flex:1}.update-source label{font-size:12px;margin:0}.update-source select{font:inherit;padding:12px;border:1px solid var(--line);border-radius:8px;background:white}.update-actions{display:flex;gap:8px;flex-wrap:wrap}.update-actions button{font-size:12px;padding:6px 11px}.update-actions button:disabled{opacity:.45;cursor:default}.update-job{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:12px 0;font-size:13px}.update-job button{padding:4px 10px}.device-updates{border-top:1px solid var(--line);margin-top:18px;padding-top:18px}.update-select{display:flex;align-items:center;font-size:12px;font-weight:400;margin:0}.update-select input{width:auto;margin-right:6px}.module-management h3{font-size:13px;margin:18px 0 8px}.module-row{padding:8px 0}.module-row .update-actions{margin-top:8px}[data-release-summary]{white-space:pre-wrap;font-size:13px;color:var(--muted);max-height:220px;overflow:auto}@media(max-width:700px){.update-source{flex-wrap:wrap}.update-source label:first-child{flex-basis:100%}.update-heading{flex-wrap:wrap}}`;
