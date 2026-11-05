import {escape, type Data} from './types';
import {accountNavigation} from './accounts_ui';

/** Browser chat shares the account session; model subscriptions have a separate lifetime. */
export function chatPage(actor:Data,devices:Data[],selectedDevice='',selectedChat=''):string {
  const initial=JSON.stringify({csrf:actor.nonce,devices:devices.map(device=>({id:device.id,name:device.name,
    system:device.system,online:device.online})),device:selectedDevice,chat:selectedChat}).replaceAll('<','\\u003c');
  return `${accountNavigation(actor)}
    <div id="chat-notice" class="notice error" role="alert" hidden></div>
    <section class="chat-layout" aria-label="双向聊天">
      <aside class="chat-sidebar"><label for="chat-device">电脑</label><select id="chat-device" aria-label="选择电脑"></select>
        <div class="chat-list-heading"><h2>对话</h2><button type="button" id="chat-new">＋ 新建</button></div>
        <form id="chat-resume" class="chat-resume"><input id="chat-id" placeholder="对话 ID，如 t1" aria-label="对话 ID" autocomplete="off"><button type="submit">打开</button></form>
        <div id="chat-list" class="chat-list" aria-label="历史对话"></div>
      </aside>
      <section class="chat-thread" aria-label="聊天内容">
        <header class="chat-thread-header"><div><div id="chat-heading" class="chat-heading">选择或新建对话</div><div id="chat-context" class="muted"></div></div>
          <div class="chat-thread-actions"><button type="button" class="secondary" id="chat-approvals">待审批</button><button type="button" class="secondary" id="chat-host" disabled>获取连接 ID</button><details id="chat-more" hidden><summary aria-label="对话操作">···</summary><div><button type="button" class="text-button" id="chat-rename">修改标题</button><button type="button" class="text-button danger" id="chat-delete">删除对话</button></div></details></div>
        </header>
        <div class="chat-connection"><span id="chat-status" role="status">尚未选择对话</span><span id="chat-refresh" class="muted"></span></div>

        <div id="chat-messages" class="chat-messages" tabindex="0" aria-label="消息记录"><div class="chat-empty">在这里与已连接的 GPT／Dot 继续交流。</div></div>
        <form id="chat-compose" class="chat-compose"><div id="chat-attachments" class="chat-attachments"></div>
          <textarea id="chat-text" rows="3" placeholder="输入消息，支持粘贴图片或拖入文件" aria-label="消息" disabled></textarea>
          <div class="chat-compose-actions"><div><input id="chat-files" type="file" multiple hidden><button id="chat-attach" class="secondary" type="button" disabled>＋ 附件</button><span id="chat-upload-status" class="muted" role="status"></span></div><button id="chat-send" type="submit" disabled>发送 ↑</button></div>
        </form>
      </section>
    </section>
    <dialog id="chat-host-dialog" aria-labelledby="chat-host-heading"><h2 id="chat-host-heading">获取连接 ID</h2><p id="chat-host-device" class="muted"></p><div class="chat-id-copy"><input id="chat-host-id" readonly aria-label="连接 ID"><button type="button" id="chat-id-copy">复制 ID</button></div><ol class="chat-connect-steps"><li>在 Work 或 Dot 中启用 Computer Bridge。</li><li>发送下方说明，让模型恢复对话，再通过宿主的事件任务订阅 <code>chat.message</code>。</li><li>显示“模型已连接”后，即可在这里或终端继续聊天。</li></ol><textarea id="chat-host-text" readonly rows="5" aria-label="模型连接说明"></textarea><p class="field-note">获取 ID 不会建立或切换连接。正在使用的对话不会被接管。普通 Chat 不支持事件唤醒。</p><div class="chat-dialog-actions"><button type="button" class="secondary" id="chat-host-close">关闭</button><button type="button" id="chat-host-copy">复制连接说明</button></div></dialog>
    <dialog id="chat-approval-dialog" aria-labelledby="chat-approval-heading"><h2 id="chat-approval-heading">待审批命令</h2><p id="chat-approval-device" class="muted"></p><div id="chat-approval-list" class="chat-approval-list"></div><section id="chat-approval-detail" hidden><p id="chat-approval-state" role="status"></p><dl><dt>目录</dt><dd id="chat-approval-cwd"></dd><dt>命令</dt><dd><pre id="chat-approval-command" tabindex="0"></pre></dd><dt>理由</dt><dd id="chat-approval-reason"></dd><dt>到期时间</dt><dd id="chat-approval-expiry"></dd></dl><p class="field-note">批准后，本次命令及其子进程、后续输入将以当前登录用户权限在工作区沙盒外运行。</p><div id="chat-approval-decisions" class="chat-dialog-actions"><button type="button" class="secondary" data-decision="cancelled">取消命令</button><button type="button" class="secondary" data-decision="rejected">拒绝</button><button type="button" data-decision="allowed-once">批准本次</button></div></section><p id="chat-approval-notice" role="status"></p><div class="chat-dialog-actions"><button type="button" class="secondary" id="chat-approval-close">关闭</button></div></dialog>
    <dialog id="chat-title-dialog"><form method="dialog"><h2 id="chat-title-heading">新建对话</h2><label>标题<input id="chat-title-input" maxlength="120" autocomplete="off"></label><div class="chat-dialog-actions"><button value="cancel" class="secondary">取消</button><button value="save">保存</button></div></form></dialog>
    <dialog id="chat-delete-dialog"><form method="dialog"><h2>删除对话</h2><p>删除这段对话的消息和附件，电脑上的文件与任务保持不变。</p><div class="chat-dialog-actions"><button value="cancel" class="secondary">取消</button><button value="delete" class="chat-danger">删除</button></div></form></dialog>
    <script type="application/json" id="chat-initial">${initial}</script>${chatScript}`;
}

export function chatBindingPage(actor:Data,details:Data,csrf:string,error=''):string {
  const device=details.device || {};
  return `${accountNavigation(actor)}<section class="auth-card">${error?`<p class="notice error" role="alert">${escape(error)}</p>`:''}
    <h2>登录终端聊天</h2><div class="auth-details">电脑：<strong>${escape(device.name || details.device_name || '')}</strong> <code>${escape(device.id || details.device_id || '')}</code><br>账号：${escape(actor.username)} <code>${escape(actor.id)}</code></div>
    <p>登录后，终端可以访问此账号有权管理的全部电脑及对话；使用 /logout 返回本机身份。</p><form method="post"><input type="hidden" name="csrf" value="${escape(csrf)}"><button name="decision" value="approve">登录此账号</button><button name="decision" value="deny" class="secondary">取消</button></form></section>`;
}

export const chatStyles=`
#chat-approval-dialog{width:min(760px,calc(100vw - 40px));max-height:85dvh;overflow:auto}.chat-approval-list{display:grid;gap:8px}.chat-approval-list button{text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.chat-approval-list button[aria-current="true"]{border-color:var(--accent)}#chat-approval-detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px}#chat-approval-detail dt{color:var(--muted)}#chat-approval-detail dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}#chat-approval-command{margin:0;padding:12px;background:#f6f8fa;border:1px solid var(--line);border-radius:8px;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.chat-layout{display:grid;grid-template-columns:265px minmax(0,1fr);border:1px solid var(--line);border-radius:18px;overflow:hidden;background:white;height:min(780px,calc(100dvh - 215px));min-height:460px;box-shadow:0 8px 40px #1d263906}.chat-sidebar{padding:22px 16px;background:#f9fafb;border-right:1px solid var(--line);overflow:auto}.chat-sidebar>label{font-size:12px;color:var(--muted)}.chat-sidebar select{width:100%;font:inherit;color:var(--ink);background:white;border:1px solid #dce1e9;border-radius:9px;padding:11px 10px}.chat-list-heading{display:flex;justify-content:space-between;align-items:center;margin:26px 0 12px}.chat-list-heading h2{font-size:15px}.chat-list-heading button{font-size:12px;padding:6px 9px}.chat-resume{display:flex;gap:6px;margin-bottom:15px}.chat-resume input{padding:8px;font-size:12px}.chat-resume button{padding:6px 10px;font-size:12px;background:#e8eeea;color:var(--accent)}.chat-list{display:flex;flex-direction:column;gap:6px}.chat-list-item{text-align:left;background:transparent;color:var(--ink);font-weight:400;border:1px solid transparent;padding:11px;min-width:0}.chat-list-item:hover{background:#eff3f0}.chat-list-item[aria-current=true]{background:#e9f2ed;border-color:#cfe1d5}.chat-list-item strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-list-item span{font-size:11px;color:var(--muted)}.chat-thread{display:flex;flex-direction:column;min-height:0;min-width:0}.chat-thread-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid var(--line);flex-shrink:0}.chat-heading{font-size:17px;font-weight:700;overflow-wrap:anywhere}.chat-thread-actions{display:flex;gap:12px;align-items:center;flex-shrink:0}.chat-thread-actions>button{font-size:12px;padding:8px 12px}.chat-thread-actions details{position:relative}.chat-thread-actions summary{list-style:none;font-size:21px;line-height:1;padding:8px}.chat-thread-actions details>div{position:absolute;right:0;top:34px;z-index:2;background:white;border:1px solid var(--line);box-shadow:0 8px 24px #1d263914;border-radius:10px;min-width:125px;padding:12px;display:flex;gap:14px;flex-direction:column;align-items:start}.chat-connection{display:flex;align-items:center;justify-content:space-between;padding:10px 24px;background:#fcfdfc;gap:12px;font-size:12px;border-bottom:1px solid var(--line)}#chat-status{color:var(--muted)}#chat-status[data-state=connected],#chat-status[data-state=replied]{color:var(--accent)}#chat-status[data-state=pending],#chat-status[data-state=failed]{color:#9b6d15}.chat-messages{flex:1;overflow:auto;min-height:0;padding:24px;scroll-behavior:smooth}.chat-empty{display:grid;place-items:center;height:100%;min-height:100px;color:var(--muted);text-align:center;font-size:13px}.chat-message{margin:0 0 22px;max-width:94%;overflow-wrap:anywhere}.chat-message[data-role=user]{margin-left:auto}.chat-message-meta{color:var(--muted);font-size:11px;margin:0 2px 5px}.chat-message[data-role=user] .chat-message-meta{text-align:right}.chat-message-body{padding:12px 15px;background:#f4f5f7;border:1px solid #eef0f3;border-radius:13px;white-space:pre-wrap;font-size:14px;line-height:1.8}.chat-message[data-role=user] .chat-message-body{background:#edf5f0;border-color:#e1ede5}.chat-message-files{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.chat-file{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:12px;max-width:100%;background:white}.chat-file img{max-width:min(250px,100%);max-height:200px;border-radius:5px;object-fit:contain}.chat-file-preview{flex-direction:column;align-items:start}.chat-file small{color:var(--muted)}.chat-compose{flex-shrink:0;border-top:1px solid var(--line);padding:15px 24px 19px}.chat-compose textarea{width:100%;resize:vertical;min-height:60px;max-height:220px;padding:10px 0;border:0;background:white;outline:none;color:var(--ink);font:inherit;font-size:14px;line-height:1.7}.chat-compose-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}.chat-compose-actions>div{display:flex;align-items:center;gap:12px}.chat-compose-actions button{padding:8px 14px;font-size:13px}.secondary{background:#f0f3f1;color:var(--accent);border-color:#dce7df}.secondary:hover{background:#e4ece7;color:var(--accent)}button:disabled{opacity:.5;cursor:default}.chat-attachments{display:flex;flex-wrap:wrap;gap:7px}.chat-attachment{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:#f9fafb}.chat-attachment button{font-size:13px;padding:0 4px;background:transparent;color:var(--muted)}.chat-compose.dragging{background:#edf5f0;outline:2px dashed #9abbab;outline-offset:-6px}.chat-load-older{display:block;margin:0 auto 22px;background:transparent;color:var(--accent);font-size:12px;padding:5px 10px}.chat-id-copy{display:flex;gap:10px;align-items:center}.chat-id-copy input{font:700 24px ui-monospace,monospace;min-width:0}.chat-id-copy button{white-space:nowrap}.chat-connect-steps{padding-left:20px;font-size:13px;line-height:1.8;margin:20px 0}.chat-connect-steps li{margin:8px 0}#chat-host-text{width:100%;resize:vertical;padding:10px;font:13px/1.6 ui-monospace,monospace;border:1px solid #cddfd2;border-radius:8px;background:white;color:var(--ink)}#chat-host-dialog .field-note{font-size:12px;line-height:1.7;margin-top:14px}dialog{max-width:440px;width:calc(100% - 36px);border:1px solid var(--line);border-radius:15px;padding:26px;color:var(--ink);box-shadow:0 18px 80px #1d263926}dialog::backdrop{background:#15292155}dialog h2{margin-bottom:20px}dialog label{font-size:13px}dialog p{font-size:14px}.chat-dialog-actions{display:flex;gap:10px;justify-content:end;margin-top:20px}.chat-danger{background:#a64f48}.chat-device-link{display:inline-flex;align-items:center;gap:5px;font-size:12px;border:1px solid #d2e3d8;border-radius:7px;background:#f5faf7;padding:5px 9px;margin:12px 0 0}.chat-device-link:hover{background:#eaf4ef}
@media(max-width:800px){.chat-layout{grid-template-columns:210px minmax(0,1fr)}.chat-thread-header,.chat-compose,.chat-messages{padding:16px}.chat-connection{padding:10px 16px}.chat-thread-header{align-items:start;flex-wrap:wrap}.chat-thread-actions{gap:8px}.chat-thread-header .muted{font-size:11px}}
@media(max-width:600px){.chat-layout{grid-template-columns:1fr;height:auto;min-height:600px}.chat-sidebar{border-right:0;border-bottom:1px solid var(--line);padding:15px}.chat-sidebar>label{display:none}.chat-list-heading{margin:12px 0 9px}.chat-list{flex-direction:row;overflow:auto;max-height:110px}.chat-list-item{min-width:140px;max-width:190px}.chat-resume{margin-bottom:8px}.chat-thread{height:65dvh;min-height:430px}.chat-thread-header{flex-wrap:nowrap}.chat-thread-actions>button{font-size:11px;padding:7px}.chat-heading{font-size:15px}.chat-message{max-width:100%}.chat-refresh{display:none}}
`;

const chatScript=String.raw`<script>
(()=>{
  const initial=JSON.parse(document.getElementById('chat-initial').textContent);
  const $=id=>document.getElementById(id);
  const notice=$('chat-notice'),deviceSelect=$('chat-device'),list=$('chat-list'),messages=$('chat-messages'),composer=$('chat-compose'),text=$('chat-text');
  let device=initial.device || initial.devices[0]?.id || '',chat=null,before=null,lastDelivery='none',loading=false,sending=false,uploading=false,attachments=[],generation=0,syncCursor=0,syncRun=null,live=null,reconnectTimer=null,retry=0,stopped=false,authExpired=false;
  const seen=new Map(),drafts=new Map(),uploads=new Map();let controller=new AbortController();
  let approvals=[],approval=null,approvalRun=null,approvalBusy=false;const approvalDialog=$('chat-approval-dialog');
  const errors=error=>{notice.textContent=error.message || String(error);notice.hidden=false;};
  const clearError=()=>{notice.hidden=true;notice.textContent='';};
  async function api(action,args={}){const response=await fetch('/chat/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({...args,csrf:initial.csrf}),signal:controller.signal});const value=await response.json();if(!response.ok || value.error){const error=new Error(typeof value.error==='string'?value.error:value.error?.message || '请求未完成');error.status=response.status;if(response.status===401){authExpired=true;closeLive();}throw error;}return value;}
  const displayDate=value=>value?new Date(typeof value==='number' && value<1e12?value*1000:value).toLocaleString():'';
  const bytes=value=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KiB':(value/1048576).toFixed(1)+' MiB';
  const shortDevice=id=>initial.devices.find(d=>d.id===id);
  function controls(){const enabled=!!chat && !sending && !uploading;$('chat-send').disabled=!enabled;$('chat-attach').disabled=!enabled;text.disabled=!chat;$('chat-host').disabled=!chat;$('chat-more').hidden=!chat;$('chat-approvals').disabled=!device;}
  function fileUrl(file){return '/chat/files/'+encodeURIComponent(chat.id)+'/'+encodeURIComponent(file.id);}
  function updateStatus(value){lastDelivery=value.delivery_state || lastDelivery;const connected=(value.connection_state || value.state)==='connected';const state=connected && lastDelivery!=='none'?lastDelivery:value.connection_state || value.state || 'waiting';const labels={waiting:'等待模型连接',connected:'模型已连接',pending:'消息等待送达',delivered:'已送达宿主，等待回复',replied:'模型已回复',failed:'送达失败，消息仍保留',expired:'模型连接已到期',disconnected:'等待模型连接'};$('chat-status').textContent=(labels[state] || state)+(!connected && lastDelivery==='pending'?' · 消息已保存':'');$('chat-status').dataset.state=state;}
  function setChat(value){
    chat=value;const d=shortDevice(chat.device_id);device=chat.device_id;deviceSelect.value=device;
    $('chat-heading').textContent=chat.title || '未命名对话';
    $('chat-context').textContent=chat.id+' · '+(d?.name || chat.device_name || device)+' · '+(d?.system==='Darwin'?'macOS':d?.system || '');
    updateStatus(chat);$('chat-status').title=lastDelivery==='delivered'?'宿主已接收事件，不代表模型已开始生成':'';
    $('chat-host-id').value=chat.id;$('chat-host-device').textContent=(d?.name || chat.device_name || device)+' · '+chat.device_id;
    $('chat-host-text').value='请通过 Computer Bridge 连接对话 '+chat.id+'。先调用 chat.resume 准备连接；随后通过宿主的事件任务订阅该对话的 chat.message，使用返回的连接凭据。订阅成功后读取必要上下文并用 chat.reply 回复，持续保持连接。subscribed:false 表示尚待订阅，不能直接发送回复。已有连接正在使用时不要接管。收到 chat.message 后使用该事件中的 connection 直接回复，不要重新 resume。';
    const selected=list.querySelector('[data-chat-id="'+chat.id+'"]');
    if(selected){selected.querySelector('strong').textContent=chat.title || '未命名对话';selected.querySelector('span').textContent=chat.id+' · '+displayDate(chat.updated_at || chat.created_at);}
    controls();history.replaceState(null,'','/chat?device='+encodeURIComponent(device)+'&id='+encodeURIComponent(chat.id));
  }
  async function refreshList(){if(!device){list.textContent='暂无可用电脑';return;}const current=device;let cursor=0;list.replaceChildren();async function load(){const value=await api('list',{device_id:current,after:cursor,limit:30});if(current!==device)return;list.querySelector('[data-more]')?.remove();for(const item of value.chats || []){const button=document.createElement('button');button.type='button';button.className='chat-list-item';button.dataset.chatId=item.id;button.setAttribute('aria-current',String(item.id===chat?.id));const title=document.createElement('strong');title.textContent=item.title || '未命名对话';const meta=document.createElement('span');meta.textContent=item.id+' · '+displayDate(item.updated_at || item.created_at);button.append(title,meta);button.addEventListener('click',()=>openChat(item.id).catch(errors));list.append(button);}cursor=value.next_cursor;if(cursor!==null && cursor!==undefined){const more=document.createElement('button');more.type='button';more.dataset.more='true';more.className='chat-load-older';more.textContent='更多对话';more.addEventListener('click',()=>{more.disabled=true;load().catch(error=>{more.disabled=false;errors(error);});});list.append(more);}if(!list.childNodes.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='这台电脑还没有对话';list.append(empty);}}await load();}
  function approvalButtons(){for(const button of document.querySelectorAll('[data-decision]'))button.disabled=approvalBusy || approval?.state!=='pending';}
  function renderApprovals(){
    $('chat-approvals').textContent='待审批'+(approvals.length?' · '+approvals.length:'');
    $('chat-approval-device').textContent=(shortDevice(device)?.name || device)+' · '+device;
    const container=$('chat-approval-list');container.replaceChildren();
    if(!approvals.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='这台电脑没有待审批命令';container.append(empty);}
    for(const [index,item] of approvals.entries()){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='待审批命令 '+(index+1)+' · 到期 '+displayDate(item.expires_at);button.setAttribute('aria-current',String(item.id===approval?.id));button.addEventListener('click',()=>showApproval(item.id).catch(approvalError));container.append(button);}
  }
  function approvalError(error){$('chat-approval-notice').textContent=error.message || String(error);}
  function refreshApprovals(){
    if(!device || stopped || authExpired)return Promise.resolve();
    const current=device;if(approvalRun?.device===current){approvalRun.again=true;return approvalRun.promise;}
    const run={device:current,again:true,promise:null};approvalRun=run;
    run.promise=(async()=>{while(run.again && current===device){run.again=false;const value=await api('approvals',{device_id:current});if(current!==device)return;approvals=(value.approvals || []).filter(item=>item.state==='pending');renderApprovals();if(approvalDialog.open && approval && !approvals.some(item=>item.id===approval.id))await showApproval(approval.id);}})().finally(()=>{if(approvalRun===run)approvalRun=null;});return run.promise;
  }
  async function showApproval(id){
    const current=device;const value=await api('approval-details',{id});if(current!==device || !approvalDialog.open)return;
    approval=value;$('chat-approval-detail').hidden=false;$('chat-approval-cwd').textContent=value.cwd;$('chat-approval-command').textContent=value.command;$('chat-approval-reason').textContent=value.justification;$('chat-approval-expiry').textContent=displayDate(value.expires_at);
    $('chat-approval-state').textContent=value.state==='pending'?'等待审批':({'allowed-once':'已批准本次命令',rejected:'已拒绝',cancelled:'已取消命令'}[value.decision] || '审批已结束');approvalButtons();renderApprovals();
  }
  function resetApprovals(){approvals=[];approval=null;$('chat-approval-detail').hidden=true;$('chat-approval-notice').textContent='';approvalDialog.close();renderApprovals();}
  $('chat-approvals').addEventListener('click',async()=>{approval=null;$('chat-approval-detail').hidden=true;$('chat-approval-notice').textContent='';approvalDialog.showModal();try{await refreshApprovals();}catch(error){approvalError(error);}});
  $('chat-approval-close').addEventListener('click',()=>approvalDialog.close());
  for(const button of document.querySelectorAll('[data-decision]'))button.addEventListener('click',async()=>{
    if(approvalBusy || approval?.state!=='pending')return;const id=approval.id,current=device;approvalBusy=true;approvalButtons();$('chat-approval-notice').textContent='正在提交…';
    try{const result=await api('approval-decide',{id,decision:button.dataset.decision,...(chat?{chat_id:chat.id}:{})});if(current!==device)return;$('chat-approval-notice').textContent={'allowed-once':'已批准本次命令',rejected:'已拒绝',cancelled:'已取消命令'}[result.decision] || '审批已处理';await showApproval(id);await refreshApprovals();}catch(error){approvalError(error);}finally{approvalBusy=false;approvalButtons();}
  });
  function renderMessage(item){const key=item.id;let node=seen.get(key);const delivered={pending:'等待送达',delivered:'已送达宿主',replied:'已回复',failed:'送达失败',none:''}[item.delivery] || '';if(node){const status=node.querySelector('[data-delivery]');if(status && status.textContent!==delivered)status.textContent=delivered;return node;}node=document.createElement('article');node.className='chat-message';node.dataset.role=item.role==='assistant'?'assistant':'user';node.dataset.id=key;node.dataset.sequence=String(item.sequence || Number(key.slice(1)));const meta=document.createElement('div');meta.className='chat-message-meta';meta.textContent=(item.role==='assistant'?'GPT／Dot':'你')+' · '+key+' · '+displayDate(item.created_at);const delivery=document.createElement('span');delivery.dataset.delivery='true';delivery.textContent=delivered;delivery.style.marginLeft='8px';meta.append(delivery);node.append(meta);if(item.text){const body=document.createElement('div');body.className='chat-message-body';body.textContent=item.text;node.append(body);}if(item.attachments?.length){const files=document.createElement('div');files.className='chat-message-files';for(const file of item.attachments){const link=document.createElement('a');link.className='chat-file';link.href=fileUrl(file);link.target='_blank';link.rel='noopener';const info=document.createElement('span');info.textContent=file.name+' · '+bytes(file.size);if((file.mime_type || '').startsWith('image/') && ['image/png','image/jpeg','image/gif','image/webp'].includes(file.mime_type)){link.classList.add('chat-file-preview');const image=document.createElement('img');image.loading='lazy';image.src=link.href+'?inline=1';image.alt=file.name;link.append(image);}link.append(info);files.append(link);}node.append(files);}seen.set(key,node);return node;}
  function updateOlder(){messages.querySelector('.chat-load-older')?.remove();if(before){const button=document.createElement('button');button.type='button';button.className='chat-load-older';button.textContent='读取更早消息';button.addEventListener('click',()=>loadOlder().catch(errors));messages.prepend(button);}}
  async function loadOlder(){if(!chat || !before || loading)return;loading=true;const id=chat.id,own=generation,priorHeight=messages.scrollHeight;try{const value=await api('history',{chat_id:id,before,limit:40});if(chat?.id!==id || own!==generation)return;const fragment=document.createDocumentFragment();for(const item of value.messages || [])fragment.append(renderMessage(item));messages.prepend(fragment);before=value.has_older?value.first_cursor:null;updateOlder();messages.scrollTop+=messages.scrollHeight-priorHeight;}finally{loading=false;}}
  function mergeMessages(items){
    let changed=false;const bottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90;
    const existing=Array.from(seen.values()),first=existing.length?Math.min(...existing.map(node=>Number(node.dataset.sequence))):0;
    for(const item of items || []){
      const old=seen.get(item.id),sequence=item.sequence || Number(item.id.slice(1));
      if(!old && first && sequence<first)continue;
      const oldState=old?.querySelector('[data-delivery]')?.textContent;
      const node=renderMessage(item);
      if(old){changed ||= oldState!==node.querySelector('[data-delivery]')?.textContent;continue;}
      messages.querySelector('.chat-empty')?.remove();
      const next=Array.from(messages.querySelectorAll('.chat-message')).find(value=>Number(value.dataset.sequence)>sequence);
      messages.insertBefore(node,next || null);changed=true;
    }
    if(changed && bottom)messages.scrollTop=messages.scrollHeight;
    return changed;
  }
  function markUpdated(items){
    if(items?.length)$('chat-refresh').textContent='更新于 '+new Date().toLocaleTimeString();
  }
  async function openChat(id){
    if(uploading || sending)throw new Error('请等待当前消息或附件发送完成');
    if(chat)drafts.set(chat.id,{text:text.value,attachments:[...attachments],sendKey});
    clearError();const own=++generation;closeLive();$('chat-host-dialog').close();resetApprovals();
    try{
      const value=await api('sync',{chat_id:id,cursor:0});if(own!==generation)return;
      authExpired=false;setChat(value.chat);syncCursor=value.cursor;const draft=drafts.get(id);text.value=draft?.text || '';attachments=draft?.attachments || [];sendKey=draft?.sendKey || null;renderAttachments();
      seen.clear();messages.replaceChildren();for(const item of value.messages || [])messages.append(renderMessage(item));
      before=value.has_older?value.first_cursor:null;updateOlder();
      if(!seen.size){const empty=document.createElement('div');empty.className='chat-empty';empty.textContent='消息会保留在这段对话中。获取连接 ID 并在 GPT／Dot 中完成订阅后即可交流。';messages.append(empty);}
      markUpdated(value.messages);messages.scrollTop=messages.scrollHeight;retry=0;connectLive();await Promise.all([refreshList(),refreshApprovals()]);if(own===generation)text.focus();
    }catch(error){if(own===generation && chat)connectLive();throw error;}
  }
  function requestSync(){
    if(document.hidden || stopped || authExpired || !chat)return Promise.resolve();
    const id=chat.id,own=generation;
    if(syncRun?.generation===own){syncRun.again=true;return syncRun.promise;}
    const run={generation:own,again:true,promise:null};syncRun=run;
    run.promise=(async()=>{
      while(run.again && own===generation && !document.hidden && !stopped && !authExpired){
        run.again=false;const value=await api('sync',{chat_id:id,cursor:syncCursor});
        if(own!==generation)return;
        mergeMessages(value.messages);setChat(value.chat);syncCursor=value.cursor;retry=0;markUpdated(value.messages);
        if(value.more)run.again=true;
      }
    })().catch(error=>{if(own===generation && error.name!=='AbortError'){errors(error);if(!error.status || error.status>=500)live?.close(4000,'Sync unavailable');}}).finally(()=>{if(syncRun===run)syncRun=null;});
    return run.promise;
  }
  function closeLive(){
    clearTimeout(reconnectTimer);reconnectTimer=null;
    if(live){const socket=live;live=null;socket.onclose=null;socket.close(1000,'Chat view inactive');}
  }
  function connectLive(){
    if(document.hidden || stopped || authExpired || !chat || live)return;
    const id=chat.id,own=generation,url=new URL('/chat/live',location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('chat_id',id);
    let opened=false;const socket=new WebSocket(url);live=socket;$('chat-refresh').textContent='连接实时更新…';
    socket.onopen=()=>{if(live!==socket || own!==generation)return;opened=true;$('chat-refresh').textContent='实时更新已连接';};
    socket.onmessage=event=>{
      if(live!==socket || own!==generation)return;let value;try{value=JSON.parse(event.data);}catch{return;}
      if(value.type==='approvals.changed'){void refreshApprovals().catch(approvalError);return;}
      if(value.chat_id!==id)return;
      if(value.type==='chat.ready')void refreshApprovals().catch(approvalError);
      if(value.type==='chat.changed' || value.type==='chat.ready')void requestSync();
    };
    socket.onclose=event=>{
      if(live!==socket || own!==generation)return;live=null;
      if([1008,4401,4403,4404].includes(event.code)){authExpired=true;errors(new Error(event.code===4404?'对话已删除或不可访问':'聊天授权已失效，请重新登录'));return;}
      if(document.hidden || stopped || authExpired)return;
      if(!opened)void requestSync();
      $('chat-refresh').textContent='实时连接已断开，正在重连';
      reconnectTimer=setTimeout(()=>{reconnectTimer=null;connectLive();},Math.min(1000*2**retry++,15000));
    };
    socket.onerror=()=>{};
  }
  function renderAttachments(){const container=$('chat-attachments');container.replaceChildren();attachments.forEach((file,index)=>{const tag=document.createElement('span');tag.className='chat-attachment';const label=document.createElement('span');label.textContent=file.name+' · '+bytes(file.size);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除附件 '+file.name);remove.addEventListener('click',()=>{attachments.splice(index,1);sendKey=null;renderAttachments();});tag.append(label,remove);container.append(tag);});const queue=chat?uploads.get(chat.id) || []:[];for(const job of queue){const tag=document.createElement('span');tag.className='chat-attachment';const label=document.createElement('span');label.textContent=job.file.name+' · '+(uploading?'上传中':'等待重试');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='×';cancel.disabled=uploading;cancel.setAttribute('aria-label','取消上传 '+job.file.name);cancel.addEventListener('click',()=>{queue.splice(queue.indexOf(job),1);renderAttachments();});tag.append(label,cancel);container.append(tag);}if(queue.length && !uploading){const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='重试上传';retry.addEventListener('click',()=>runUploads().catch(errors));container.append(retry);}}
  function base64(buffer){let binary='';const data=new Uint8Array(buffer);for(let index=0;index<data.length;index+=8192)binary+=String.fromCharCode(...data.subarray(index,index+8192));return btoa(binary);}
  async function addFiles(files){if(!chat || uploading || sending)return;const queue=uploads.get(chat.id) || [];for(const file of files)queue.push({file,key:crypto.randomUUID()});uploads.set(chat.id,queue);await runUploads();}
  async function runUploads(){if(!chat || uploading || sending)return;clearError();uploading=true;controls();renderAttachments();const id=chat.id,queue=uploads.get(id) || [];try{while(queue.length){const job=queue[0],file=job.file;$('chat-upload-status').textContent='上传 '+file.name;const upload=await api('upload-start',{chat_id:id,name:file.name || '图片.png',size:file.size,mime_type:file.type || 'application/octet-stream',request_key:job.key});const attachment=upload.attachment;for(let offset=attachment.offset;attachment.state!=='ready' && offset<file.size;){const chunk=await file.slice(offset,offset+upload.chunk_size).arrayBuffer();const written=await api('upload-chunk',{chat_id:id,attachment_id:attachment.id,offset,data:base64(chunk)});offset=written.next_offset;$('chat-upload-status').textContent=file.name+' '+Math.min(100,Math.round(offset/file.size*100))+'%';}const finished=await api('upload-complete',{chat_id:id,attachment_id:attachment.id});if(!attachments.some(a=>a.id===finished.attachment.id))attachments.push(finished.attachment);queue.shift();sendKey=null;renderAttachments();}}finally{uploading=false;$('chat-upload-status').textContent='';$('chat-files').value='';controls();renderAttachments();}}
  let sendKey=null;
  composer.addEventListener('submit',async event=>{
    event.preventDefault();if(!chat || sending || uploading || (!text.value.trim() && !attachments.length))return;
    clearError();sending=true;controls();const id=chat.id,content=text.value,files=attachments.map(a=>a.id);sendKey ||= crypto.randomUUID();
    try{const value=await api('send',{chat_id:id,text:content,attachments:files,request_key:sendKey});
      if(chat?.id!==id)return;mergeMessages([value.message]);setChat(value.chat);markUpdated([value.message]);sendKey=null;text.value='';attachments=[];drafts.delete(id);renderAttachments();
    }catch(error){errors(error);}finally{sending=false;controls();void requestSync();}
  });
  text.addEventListener('input',()=>{sendKey=null;});
  text.addEventListener('keydown',event=>{if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();composer.requestSubmit();}});
  $('chat-attach').addEventListener('click',()=>$('chat-files').click());$('chat-files').addEventListener('change',()=>addFiles(Array.from($('chat-files').files)).catch(errors));
  composer.addEventListener('dragover',event=>{event.preventDefault();composer.classList.add('dragging');});composer.addEventListener('dragleave',()=>composer.classList.remove('dragging'));composer.addEventListener('drop',event=>{event.preventDefault();composer.classList.remove('dragging');addFiles(Array.from(event.dataTransfer.files)).catch(errors);});text.addEventListener('paste',event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();addFiles(files).catch(errors);}});
  deviceSelect.addEventListener('change',()=>{if(uploading || sending){deviceSelect.value=device;return;}if(chat)drafts.set(chat.id,{text:text.value,attachments:[...attachments],sendKey});generation++;closeLive();device=deviceSelect.value;resetApprovals();chat=null;attachments=[];seen.clear();lastDelivery='none';syncCursor=0;before=null;text.value='';renderAttachments();messages.replaceChildren();$('chat-heading').textContent='选择或新建对话';$('chat-context').textContent='';$('chat-status').textContent='尚未选择对话';$('chat-host-dialog').close();controls();history.replaceState(null,'','/chat?device='+encodeURIComponent(device));Promise.all([refreshList(),refreshApprovals()]).catch(errors);});
  $('chat-resume').addEventListener('submit',event=>{event.preventDefault();const id=$('chat-id').value.trim();if(!/^t[1-9][0-9]*$/.test(id)){errors(new Error('请输入对话短 ID，例如 t1'));return;}openChat(id).catch(errors);});
  const titleDialog=$('chat-title-dialog');let titleAction='create';
  $('chat-new').addEventListener('click',()=>{if(!device)return;titleAction='create';$('chat-title-heading').textContent='新建对话';$('chat-title-input').value='';titleDialog.returnValue='';titleDialog.showModal();$('chat-title-input').focus();});
  $('chat-rename').addEventListener('click',()=>{titleAction='rename';$('chat-title-heading').textContent='修改标题';$('chat-title-input').value=chat.title || '';titleDialog.returnValue='';titleDialog.showModal();});
  titleDialog.addEventListener('close',async()=>{if(titleDialog.returnValue!=='save')return;try{const title=$('chat-title-input').value.trim();if(titleAction==='create'){const value=await api('create',{device_id:device,title,request_key:crypto.randomUUID()});await openChat((value.chat || value).id);}else{await api('rename',{chat_id:chat.id,title});await requestSync();await refreshList();}}catch(error){errors(error);}});
  $('chat-delete').addEventListener('click',()=>{$('chat-delete-dialog').returnValue='';$('chat-delete-dialog').showModal();});$('chat-delete-dialog').addEventListener('close',async()=>{if($('chat-delete-dialog').returnValue!=='delete')return;try{await api('delete',{chat_id:chat.id});drafts.delete(chat.id);uploads.delete(chat.id);generation++;closeLive();chat=null;attachments=[];renderAttachments();seen.clear();messages.replaceChildren();$('chat-heading').textContent='选择或新建对话';$('chat-context').textContent='';$('chat-status').textContent='对话已删除';$('chat-host-dialog').close();controls();await refreshList();}catch(error){errors(error);}});
  $('chat-host').addEventListener('click',()=>{if(!chat)return;$('chat-id-copy').textContent='复制 ID';$('chat-host-copy').textContent='复制连接说明';$('chat-host-dialog').showModal();});
  $('chat-host-close').addEventListener('click',()=>$('chat-host-dialog').close());
  async function copy(element,button,label){try{await navigator.clipboard.writeText(element.value);button.textContent='已复制';}catch{element.focus();element.select();errors(new Error('请复制已选中的'+label));}}
  $('chat-id-copy').addEventListener('click',()=>copy($('chat-host-id'),$('chat-id-copy'),'连接 ID'));
  $('chat-host-copy').addEventListener('click',()=>copy($('chat-host-text'),$('chat-host-copy'),'连接说明'));
  for(const item of initial.devices){const option=document.createElement('option');option.value=item.id;option.textContent=item.name+' · '+item.id;deviceSelect.append(option);}deviceSelect.value=device;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)closeLive();else connectLive()});
  window.addEventListener('pagehide',()=>{stopped=true;closeLive();controller.abort();});
  window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;controller=new AbortController();connectLive();}});
  (initial.chat?openChat(initial.chat):Promise.all([refreshList(),refreshApprovals()])).catch(errors);controls();
})();
</script>`;
