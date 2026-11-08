export const deviceSettingsMarkup=`<dialog id="chat-device-settings" aria-labelledby="chat-device-settings-title">
  <h2 id="chat-device-settings-title">电脑设置</h2><p id="chat-device-settings-target" class="muted"></p>
  <p id="chat-device-settings-status" role="status"></p><div id="chat-device-settings-content"></div>
  <div class="chat-dialog-actions"><button type="button" class="secondary" id="chat-device-settings-close">关闭</button></div>
</dialog>`;

export const deviceSettingsStyles=`
#chat-device-settings{max-width:580px;max-height:calc(100dvh - 32px);overflow:auto}
#chat-device-settings form{display:grid;gap:12px;margin:12px 0}
#chat-device-settings label{display:grid;gap:5px}
#chat-device-settings .tool-rule{display:flex;justify-content:space-between;align-items:center;gap:12px}
#chat-device-settings .tool-rule code{overflow-wrap:anywhere}
#chat-device-settings select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:7px}
#chat-device-settings .full-access-setting{display:flex;align-items:center;gap:8px}
#chat-device-settings .full-access-setting input{width:auto}
#chat-device-settings-status{overflow-wrap:anywhere}
@media(max-width:500px){#chat-device-settings .tool-rule{align-items:stretch;flex-direction:column}}
`;

export const deviceSettingsScript=String.raw`
  const settingsDialog=$('chat-device-settings'),settingsContent=$('chat-device-settings-content');
  const settingsStatus=$('chat-device-settings-status');
  let settingsRun=null;
  const modeNames={allow:'直接允许',ask:'使用前确认',deny:'禁止调用'};
  const element=(name,label)=>{const node=document.createElement(name);if(label!==undefined)node.textContent=label;return node;};
  function settingsButton(label,action,primary=false){
    const button=element('button',label);button.type='button';
    if(!primary)button.className='secondary';
    button.addEventListener('click',()=>void action());return button;
  }
  function settingsResult(value){
    return value.access_error ? '配置已保存 · '+value.access_error
      : value.applied_revision===value.access.revision ? '配置已应用' : '已保存 · 等待电脑应用';
  }
  async function showDeviceSettings(kind,target){
    const run={kind,target,view:null,busy:false};settingsRun=run;
    $('chat-device-settings-title').textContent=kind==='permissions'?'权限':'工作区';
    $('chat-device-settings-target').textContent=target;
    settingsContent.replaceChildren();settingsStatus.textContent='正在读取电脑设置…';
    settingsDialog.showModal();
    try{
      const view=await api('device-access',{device_id:target});
      if(settingsRun!==run)return;
      run.view=view;$('chat-device-settings-target').textContent=view.device_name+' · '+view.device_id;
      settingsStatus.textContent=settingsResult(view);renderDeviceSettings(run);
    }catch(error){if(settingsRun===run)settingsStatus.textContent=error.message;}
  }
  async function saveDeviceSettings(run,action,values){
    if(run.busy || settingsRun!==run)return;
    run.busy=true;settingsStatus.textContent='正在保存…';
    try{
      const value=await api('device-access-save',{device_id:run.target,
        expected_revision:run.view.access.revision,action,...values});
      if(settingsRun!==run)return;
      if(value.confirmation){
        const box=element('section');box.className='creation-confirmation';
        box.append(element('strong','创建以下缺失目录？'),element('pre',value.confirmation.missing.join('\n')));
        box.append(settingsButton('取消',()=>{box.remove();settingsStatus.textContent=settingsResult(run.view);}),
          settingsButton('创建并保存',()=>saveDeviceSettings(run,action,{...values,create_missing:true}),true));
        settingsContent.querySelector('.creation-confirmation')?.remove();
        settingsContent.prepend(box);settingsStatus.textContent='等待确认创建目录';return;
      }
      run.view=value;settingsStatus.textContent=settingsResult(value);renderDeviceSettings(run);
    }catch(error){if(settingsRun===run)settingsStatus.textContent=error.message;}
    finally{run.busy=false;}
  }
  function renderDeviceSettings(run){
    settingsContent.replaceChildren();
    if(run.kind==='permissions'){
      const form=element('form'),label=element('label','完全访问'),full=element('input');
      full.type='checkbox';full.checked=run.view.access.full_access;label.prepend(full);label.className='full-access-setting';form.append(label);
      const modes=new Map();
      if(run.view.tool_permissions_supported){
        form.append(element('p','工具权限独立于完全访问。'));
        for(const tool of run.view.tools){
          const row=element('label'),name=element('code',tool),select=element('select');
          row.className='tool-rule';
          for(const [value,title] of Object.entries(modeNames)){
            const option=element('option',title);option.value=value;select.append(option);
          }
          select.value=run.view.access.tool_permissions?.[tool] || 'allow';
          row.append(name,select);modes.set(tool,select);form.append(row);
        }
      }else form.append(element('p','请更新目标电脑以设置工具权限。'));
      const save=element('button','保存权限');save.type='submit';form.append(save);
      form.addEventListener('submit',event=>{
        event.preventDefault();
        void saveDeviceSettings(run,'access',{full_access:full.checked,
          ...(run.view.tool_permissions_supported?{tool_permissions:Object.fromEntries([...modes].map(([tool,select])=>[tool,select.value]))}:{})});
      });settingsContent.append(form);return;
    }
    for(const entry of run.view.access.workspaces){
      const row=element('details');row.className='workspace';
      row.append(element('summary',entry.id+' · '+entry.name+' · '+entry.path));
      for(const check of [entry.validation?.main,...(entry.validation?.additional||[])].filter(Boolean)){
        if(check.state!=='valid')row.append(element('p',check.path+' · '+(check.state==='pending'?'待核验':check.error||'路径异常')));
      }
      row.append(workspaceEditor(run,entry));
      row.append(settingsButton('移除工作区',()=>{
        const prompt=element('p','移除此工作区配置？实际目录会保留。');
        prompt.append(settingsButton('取消',()=>prompt.remove()),
          settingsButton('移除配置',()=>saveDeviceSettings(run,'workspace_remove',{workspace_id:entry.id}),true));
        row.append(prompt);
      }));settingsContent.append(row);
    }
    const add=element('details');add.className='workspace';add.append(element('summary','＋ 添加工作区'),workspaceEditor(run,{}));
    settingsContent.append(add);
  }
  function workspaceEditor(run,entry){
    const form=element('form');
    const field=(label,value,multiline=false)=>{
      const row=element('label',label),input=element(multiline?'textarea':'input');
      input.value=value||'';input.required=!multiline;row.append(input);form.append(row);return input;
    };
    const name=field('名称',entry.name),path=field('主工作区绝对路径',entry.path);
    const additional=field('外部子工作区（每行一个路径）',(entry.additional||[]).join('\n'),true);
    const save=element('button','保存工作区');save.type='submit';form.append(save);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      void saveDeviceSettings(run,'workspace_save',{workspace_id:entry.id||'',name:name.value,path:path.value,
        additional:additional.value.split(/\r?\n/).map(p=>p.trim()).filter(Boolean)});
    });
    return form;
  }
  $('chat-device-settings-close').addEventListener('click',()=>settingsDialog.close());
  settingsDialog.addEventListener('close',()=>{settingsRun=null;text.focus();});
`;
