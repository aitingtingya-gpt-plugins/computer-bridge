import {escape, type Data} from './types';
import {accountNavigation} from './accounts_ui';
import {connectionPresentationScript} from './connections_ui';
import {chatLayoutStyles,chatLayoutScript} from './chat_layout';
import {markdownPath,markdownCss} from './chat_assets';
import {deviceSettingsMarkup,deviceSettingsStyles,deviceSettingsScript} from './chat_device_settings';

/** Browser chat shares the account session; model subscriptions have a separate lifetime. */
export function chatPage(actor:Data,devices:Data[],selectedDevice='',selectedChat=''):string {
  const initial=JSON.stringify({account_id:actor.id,csrf:actor.nonce,devices:devices.map(device=>({id:device.id,name:device.name,
    system:device.system,online:device.online,connection_state:device.connection_state,latency_ms:device.latency_ms,latency_state:device.latency_state,latency_checked_at:device.latency_checked_at})),device:selectedDevice,chat:selectedChat}).replaceAll('<','\\u003c');
  return `${accountNavigation(actor)}
    <div id="chat-notice" class="notice error" role="alert" hidden></div>
    <section class="chat-layout" aria-label="双向聊天">
      <aside id="chat-sidebar" class="chat-sidebar" aria-label="电脑与对话"><div class="chat-sidebar-heading"><label for="chat-device">电脑与对话</label><button type="button" id="chat-sidebar-close" class="chat-icon-button" aria-label="收起侧栏" title="收起侧栏">‹</button></div><div class="chat-device-row"><select id="chat-device" aria-label="选择电脑"></select><span id="chat-device-latency" class="connection-quality" aria-label="电脑连接延迟" hidden></span></div>
        <div class="chat-list-heading"><h2>对话</h2><button type="button" id="chat-new">＋ 新建</button></div>
        <form id="chat-resume" class="chat-resume"><input id="chat-id" placeholder="对话 ID，如 t1" aria-label="对话 ID" autocomplete="off"><button type="submit">打开</button></form>
        <div id="chat-list" class="chat-list" aria-label="历史对话"></div>
      </aside>
      <div id="chat-sidebar-resize" class="chat-resize chat-resize-side" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls="chat-sidebar" tabindex="0"></div>
      <button id="chat-sidebar-backdrop" class="chat-sidebar-backdrop" aria-label="关闭侧栏" type="button" hidden></button>
      <section class="chat-thread" aria-label="聊天内容">
        <div class="chat-message-pane"><button type="button" id="chat-sidebar-open" class="chat-icon-button" aria-label="电脑与对话" title="电脑与对话" aria-controls="chat-sidebar">☰</button><div id="chat-messages" class="chat-messages" tabindex="0" aria-label="消息记录"><div class="chat-empty">在这里与已连接的 GPT／Dot 继续交流。</div></div></div>
        <div id="chat-compose-resize" class="chat-resize chat-resize-compose" role="separator" aria-label="调整输入区高度" aria-orientation="horizontal" aria-controls="chat-compose" tabindex="0"></div>
        <form id="chat-compose" class="chat-compose"><div id="chat-slash-menu" class="chat-slash-menu" role="listbox" aria-label="聊天命令" hidden></div><div id="chat-quote-preview" class="chat-quote" hidden><span id="chat-quote-text"></span><button id="chat-quote-clear" class="secondary" type="button" aria-label="取消引用">取消引用</button></div><div id="chat-attachments" class="chat-attachments"></div>
          <textarea id="chat-text" rows="3" placeholder="输入消息，支持粘贴图片或拖入文件" aria-label="消息" disabled></textarea>
          <div class="chat-compose-actions"><div><input id="chat-files" type="file" multiple hidden><button id="chat-attach" class="secondary" type="button" disabled>＋ 附件</button><span id="chat-upload-status" class="muted" role="status"></span></div><button id="chat-send" type="submit" disabled>发送 ↑</button></div>
        </form>
      </section>
    </section>
    <dialog id="chat-quote-dialog" aria-labelledby="chat-quote-heading"><h2 id="chat-quote-heading">引用 dot 消息</h2><p class="field-note">选择要引用的消息，或用 /quote m1 指定更早消息。/quote cancel 取消引用。</p><div id="chat-quote-options"></div><button id="chat-quote-close" class="secondary" type="button">取消</button></dialog>
    <dialog id="chat-channel-dialog" aria-labelledby="chat-channel-heading"><h2 id="chat-channel-heading">请手动告知 Dot</h2><p id="chat-channel-device" class="muted"></p><p id="chat-channel-status" class="field-note"></p><div class="chat-id-copy"><input id="chat-channel-id" readonly aria-label="对话 ID"><button type="button" id="chat-channel-id-copy">复制 ID</button></div><div class="chat-id-copy chat-phrase-copy"><input id="chat-channel-phrase" readonly aria-label="建议发送给 Dot 的话术"><button type="button" id="chat-channel-copy">复制话术</button></div><p class="field-note">若 Dot 在提醒显示期间完成接入或暂停，本窗口会自动关闭；否则请处理完后手动关闭。</p><div class="chat-dialog-actions"><button type="button" id="chat-channel-close">关闭</button></div></dialog>
    <dialog id="chat-export-dialog"><h2>导出会话</h2><p id="chat-export-progress" role="status"></p><div class="chat-dialog-actions"><button id="chat-export-cancel" type="button" class="secondary">取消</button></div></dialog>
    <dialog id="chat-title-dialog"><form method="dialog"><h2 id="chat-title-heading">新建对话</h2><label>标题<input id="chat-title-input" maxlength="120" autocomplete="off"></label><div id="chat-create-options"><label>模式<select id="chat-create-mode"><option value="chat">Chat · 连续对话</option><option value="super_agent">Super Agent · 任务协作</option></select></label><p class="field-note">创建后固定模式。Super Agent 需要支持任务工具的 Work / Dot 宿主，不会自行启动隐藏模型。</p><div id="chat-repository-options" hidden><label>仓库（可选）<select id="chat-create-repository"><option value="none">不绑定仓库</option><option value="github">GitHub</option><option value="cnb">腾讯 CNB</option></select></label><label id="chat-repository-field" hidden>仓库 HTTPS 地址<input id="chat-repository-url" type="url" placeholder="https://github.com/owner/repo"></label><p class="field-note">仅 Super Agent 可选绑定仓库，且只是上下文，不自动克隆、登录、推送或订阅。</p></div></div><div class="chat-dialog-actions"><button value="cancel" class="secondary">取消</button><button value="save">保存</button></div></form></dialog>
    <dialog id="chat-delete-dialog"><form method="dialog"><h2>删除对话</h2><p>删除这段对话的消息、附件和聊天内任务记录。电脑文件不受影响；已启动的电脑命令和外部操作不会自动停止或撤销。</p><div class="chat-dialog-actions"><button value="cancel" class="secondary">取消</button><button value="delete" class="chat-danger">删除</button></div></form></dialog>
    ${deviceSettingsMarkup}<script src="${markdownPath}"></script><script type="application/json" id="chat-initial">${initial}</script>${connectionPresentationScript}${chatScript}${chatLayoutScript}`;
}

export function chatBindingPage(actor:Data,details:Data,csrf:string,error=''):string {
  const device=details.device || {};
  return `${accountNavigation(actor)}<section class="auth-card">${error?`<p class="notice error" role="alert">${escape(error)}</p>`:''}
    <h2>登录终端聊天</h2><div class="auth-details">电脑：<strong>${escape(device.name || details.device_name || '')}</strong> <code>${escape(device.id || details.device_id || '')}</code><br>账号：${escape(actor.username)} <code>${escape(actor.id)}</code></div>
    <p>登录后，终端可以访问此账号有权管理的全部电脑及对话；使用 /logout 返回本机身份。</p><form method="post"><input type="hidden" name="csrf" value="${escape(csrf)}"><button name="decision" value="approve">登录此账号</button><button name="decision" value="deny" class="secondary">取消</button></form></section>`;
}

export const chatStyles=`
.chat-approval{min-width:0;width:min(680px,100%);border:1px solid #cddfd5;border-radius:12px;background:#f8fcfa;padding:14px 16px}.chat-approval summary{font-weight:600;color:var(--accent);overflow-wrap:anywhere}.chat-approval dl{display:grid;grid-template-columns:64px minmax(0,1fr);gap:8px;margin:14px 0;font-size:13px}.chat-approval dt{color:var(--muted)}.chat-approval dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.chat-approval pre{margin:0;padding:10px;background:white;border:1px solid var(--line);border-radius:8px;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace}.chat-approval-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px}.chat-approval-actions button{font-size:12px;padding:7px 10px}.chat-approval-notice{font-size:12px;margin:8px 0 0;color:var(--muted)}.chat-message[data-kind=approval]{max-width:100%;width:min(680px,100%)}
.chat-sidebar select{width:100%;font:inherit;color:var(--ink);background:white;border:1px solid #dce1e9;border-radius:9px;padding:11px 40px 11px 10px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%2353627c' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");background-position:right 14px center;background-repeat:no-repeat}.chat-list-heading{display:flex;justify-content:space-between;align-items:center;margin:26px 0 12px}.chat-list-heading h2{font-size:15px}.chat-list-heading button{font-size:12px;padding:6px 9px}.chat-resume{display:flex;gap:6px;margin-bottom:15px}.chat-resume input{padding:8px;font-size:12px}.chat-resume button{padding:6px 10px;font-size:12px;background:#e8eeea;color:var(--accent)}.chat-list{display:flex;flex-direction:column;gap:6px}.chat-list-item{text-align:left;background:transparent;color:var(--ink);font-weight:400;border:1px solid transparent;padding:11px;min-width:0}.chat-list-item:hover{background:#eff3f0}.chat-list-item[aria-current=true]{background:#e9f2ed;border-color:#cfe1d5}.chat-list-item strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-list-item span{font-size:11px;color:var(--muted)}.chat-empty{display:grid;place-items:center;height:100%;min-height:100px;color:var(--muted);text-align:center;font-size:13px}.chat-message{margin:0 0 22px;max-width:94%;overflow-wrap:anywhere}.chat-message[data-role=user]{margin-left:auto}.chat-message-meta{color:var(--muted);font-size:11px;margin:0 2px 5px}.chat-message[data-role=user] .chat-message-meta{text-align:right}.chat-message-body{padding:12px 15px;background:#f4f5f7;border:1px solid #eef0f3;border-radius:13px;white-space:pre-wrap;font-size:14px;line-height:1.8}.chat-message[data-role=user] .chat-message-body{background:#edf5f0;border-color:#e1ede5}.chat-message-files{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.chat-file{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:12px;max-width:100%;background:white}.chat-file img{max-width:min(250px,100%);max-height:200px;border-radius:5px;object-fit:contain}.chat-file-preview{flex-direction:column;align-items:start}.chat-file small{color:var(--muted)}.secondary{background:#f0f3f1;color:var(--accent);border-color:#dce7df}.secondary:hover{background:#e4ece7;color:var(--accent)}button:disabled{opacity:.5;cursor:default}.chat-attachments{display:flex;flex-wrap:wrap;gap:7px}.chat-attachment{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;font-size:12px;background:#f9fafb}.chat-attachment button{font-size:13px;padding:0 4px;background:transparent;color:var(--muted)}.chat-compose.dragging{background:#edf5f0;outline:2px dashed #9abbab;outline-offset:-6px}.chat-history-note{text-align:center;color:var(--muted);font-size:12px;margin:0 0 12px}.chat-list-more{display:block;margin:0 auto 22px;background:transparent;color:var(--accent);font-size:12px;padding:5px 10px}.chat-id-copy{display:flex;gap:10px;align-items:center}.chat-id-copy input{font:700 20px ui-monospace,monospace;min-width:0}.chat-phrase-copy{margin-top:12px}.chat-phrase-copy input{font:600 14px ui-monospace,monospace}.chat-id-copy button{white-space:nowrap}#chat-channel-status{margin:0 0 14px;white-space:pre-wrap;line-height:1.7}#chat-channel-dialog .field-note{font-size:13px;line-height:1.7;margin-top:14px}dialog{max-width:440px;width:calc(100% - 36px);border:1px solid var(--line);border-radius:15px;padding:26px;color:var(--ink);box-shadow:0 18px 80px #1d263926}dialog::backdrop{background:#15292155}dialog h2{margin-bottom:20px}dialog label{font-size:13px}dialog p{font-size:14px}.chat-dialog-actions{display:flex;gap:10px;justify-content:end;margin-top:20px}.chat-danger{background:#a64f48}.chat-device-link{display:inline-flex;align-items:center;gap:5px;font-size:12px;border:1px solid #d2e3d8;border-radius:7px;background:#f5faf7;padding:5px 9px;margin:12px 0 0}.chat-device-link:hover{background:#eaf4ef}
.chat-compose{position:relative}.chat-slash-menu{position:absolute;left:14px;right:14px;bottom:calc(100% + 8px);z-index:8;max-height:240px;overflow:auto;background:white;border:1px solid var(--line);border-radius:10px;padding:5px;box-shadow:0 8px 30px #1d26391a}.chat-slash-menu button{display:flex;gap:14px;align-items:center;width:100%;min-height:44px;padding:10px 12px;background:transparent;border:0;border-radius:6px;color:var(--ink);text-align:left;font-size:14px;font-weight:400}.chat-slash-menu button[aria-selected=true]{background:#e4eee8}.chat-slash-menu strong{min-width:95px;color:var(--accent)}.chat-slash-menu span{color:var(--muted)}
.chat-quote{display:flex;gap:12px;align-items:center;margin:4px 0;padding:8px 10px;border-left:3px solid var(--accent);background:var(--panel)}.chat-quote[hidden]{display:none}.chat-quote span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.chat-quote-citation{margin:8px 0;padding:8px 12px;border-left:3px solid var(--line);color:var(--muted);white-space:pre-wrap}.chat-quote-citation summary{cursor:pointer}#chat-quote-options{display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow:auto}#chat-quote-options button{text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}
${chatLayoutStyles}
${markdownCss}
${deviceSettingsStyles}
`;

const chatScript=String.raw`<script>
(()=>{
  const initial=JSON.parse(document.getElementById('chat-initial').textContent);
  const $=id=>document.getElementById(id);
  const notice=$('chat-notice'),deviceSelect=$('chat-device'),list=$('chat-list'),messages=$('chat-messages'),composer=$('chat-compose'),text=$('chat-text');
  let device=initial.device || initial.devices[0]?.id || '',chat=null,before=null,sending=false,uploading=false,attachments=[],generation=0,syncCursor=0,syncRun=null,live=null,reconnectTimer=null,retry=0,stopped=false,authExpired=false,manualDisconnect=null;
  const messageData=new Map();let quote=null;const recallMessages=new Map();let recall=null;const historyNote=document.createElement('div');historyNote.className='chat-history-note';historyNote.setAttribute('role','status');
  let historyRun=null,historyFrame=0,historyGeneration=-1,historyBlocked=false,reconcile=null,latencyRun=null,latencyTimer=null,latencyTarget=null;
  const seen=new Map(),drafts=new Map(),uploads=new Map(),uncertain=new Map(),largeBodies=new Map();let controller=new AbortController(),uploadRun=null;
  const approvalStates=new Map(),approvalBusy=new Set();let ordered=[],firstLoaded=0;
  window.bridgeChatView={nodes:()=>ordered,byId:id=>seen.get(id),generation:()=>generation};
  const showNotice=(text,tone='error')=>{notice.className=tone==='info'?'notice':tone==='warning'?'notice warning':'notice error';notice.textContent=text;notice.hidden=false;};
  const errors=error=>{showNotice(error.message || String(error),'error');};
  const clearError=()=>{notice.hidden=true;notice.textContent='';notice.className='notice error';};
  async function api(action,args={},signal=controller.signal){const response=await fetch('/chat/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({...args,csrf:initial.csrf}),signal});const value=await response.json();if(!response.ok || value.error){const error=new Error(typeof value.error==='string'?value.error:value.error?.message || '请求未完成');error.status=response.status;if(response.status===401){authExpired=true;closeLive();}throw error;}return value;}
  const beijingDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const displayDate=value=>value?beijingDate.format(new Date(typeof value==='number' && value<1e12?value*1000:value)):'';
  const bytes=value=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KiB':(value/1048576).toFixed(1)+' MiB';
  const shortDevice=id=>initial.devices.find(d=>d.id===id);
  function controls(){const enabled=!!chat && !sending && !uploading,pending=chat&&uncertain.has(chat.id);$('chat-send').disabled=!enabled;$('chat-send').textContent=pending?'确认发送结果':'发送 ↑';$('chat-attach').disabled=!enabled||pending;text.disabled=!chat&&!device;text.readOnly=!!pending||sending;$('chat-quote-clear').disabled=!!pending||sending||uploading;text.placeholder=chat?'输入消息，支持粘贴图片或拖入文件':'输入 / 查看电脑设置命令';}
  const notificationLabels={waiting:'等待接收方上线',pending:'等待通知',unreachable:'暂不可达',received:'宿主已接收',blocked:'通知配置异常',none:''};
  function messageStatus(item){const notification=notificationLabels[item.notification?.state] || '';return ['已保存',notification].filter(Boolean).join(' · ');}
  function fileUrl(file){return '/chat/files/'+encodeURIComponent(chat.id)+'/'+encodeURIComponent(file.id);}
  function setText(node,value){if(node.textContent!==value)node.textContent=value;}
  const CHANNEL_FALLBACK_MS=Math.max(50,Number(window.bridgeChannelFallbackMs)||60000);
  const CHANNEL_DIAG_TEXT={
    unconfigured:'当前未检测到活跃的 chat.channel 插件订阅',
    edge_challenge:'通道推送被边缘安全拦截（HTTP 403）',
    signature_rejected:'通道签名验证被拒',
    timestamp_rejected:'通道时间戳超出允许窗口',
    subscription_unavailable:'Dot 侧插件订阅已失效或未找到',
    authentication_rejected:'通道认证被拒',
    permission_denied:'通道权限不足',
    rate_limited:'通道请求触发限流',
    callback_address:'回调地址或 DNS 校验未通过',
    timeout:'通道推送请求超时',
    network_error:'通道推送网络异常',
    gone_removed:'原订阅已返回 410 并自动清理',
  };
  function isChannelSatisfied(value,action){
    if(!value)return false;
    return action==='connect'?(value.state==='connected'&&value.subscribed!==false):(value.subscribed===false||value.state==='waiting');
  }
  function describeChannelReason(channelObj,recentDiag){
    const err=channelObj?.last_error||recentDiag;
    if(channelObj?.state==='unconfigured'||channelObj?.active===0||err?.category==='unconfigured')return CHANNEL_DIAG_TEXT.unconfigured;
    if(err){
      const base=CHANNEL_DIAG_TEXT[err.category]||(err.status?'通道推送返回 HTTP '+err.status:'通道推送异常');
      const code=err.status&&err.category!=='timeout'&&err.category!=='network_error'&&err.category!=='callback_address'&&!base.includes(String(err.status))?'（HTTP '+err.status+'）':'';
      const ray=err.cf_ray?' · '+err.cf_ray:'';
      return base+code+ray;
    }
    if(channelObj?.delivered>0)return '通知已送达，Dot 尚未完成执行';
    if(channelObj?.state==='retrying')return '通道通知正在后台自动重试中';
    return 'Dot 尚未完成响应';
  }
  function immediateChannelNotice(chatId,action,channelObj){
    const reason=describeChannelReason(channelObj);
    if(action==='delete'){
      if(channelObj?.delivered>0)return {text:'对话 '+chatId+' 已删除，已通知 Dot 清理连接',tone:'info'};
      if(channelObj?.state==='retrying')return {text:'对话 '+chatId+' 已删除，通知 Dot 清理遇到临时异常（'+reason+'），后台重试中',tone:'warning'};
      if(channelObj?.state==='unconfigured')return {text:'对话 '+chatId+' 已删除，暂未检测到 chat.channel 订阅',tone:'info'};
      return {text:'对话 '+chatId+' 已删除，通知 Dot 清理未送达（'+reason+'）',tone:'warning'};
    }
    const target=action==='connect'?'连接对话 '+chatId:'暂停对话 '+chatId+' 的事件订阅';
    if(channelObj?.delivered>0)return {text:'已通知 Dot '+target,tone:'info'};
    if(channelObj?.state==='retrying')return {text:'通知 Dot '+target+'遇到临时异常（'+reason+'），后台重试中',tone:'warning'};
    if(channelObj?.state==='unconfigured')return {text:'暂未检测到 chat.channel 订阅，请手动告知 Dot',tone:'warning'};
    return {text:'通知 Dot '+target+'未送达（'+reason+'）',tone:'warning'};
  }
  function setChat(value,channelInfo=null){
    const previous=chat,oldDevice=device;chat=value;const d=shortDevice(chat.device_id);device=chat.device_id;if(deviceSelect.value!==device)deviceSelect.value=device;
    const label=d?.name || chat.device_name || device;
    if(oldDevice!==device)startLatency();
    if(previous?.id!==chat.id||previous?.title!==chat.title||previous?.updated_at!==chat.updated_at){const selected=list.querySelector('[data-chat-id="'+chat.id+'"]');if(selected){setText(selected.querySelector('strong'),chat.title || '未命名对话');setText(selected.querySelector('span'),chat.id+' · '+displayDate(chat.updated_at || chat.created_at));}}
    const userDisconnected=manualDisconnect&&manualDisconnect.chat===chat.id&&manualDisconnect.at>Date.now();
    if(previous?.id===chat.id && previous.state==='connected' && chat.state==='waiting' && !userDisconnected && (!channelWatch || channelWatch.chat!==chat.id)){
      showNotice('Dot 连接已断开，可在需要时运行 /connect 或手动前往 Dot 告知：连接对话 '+chat.id,'warning');
    }
    if(chat.state==='connected' && chat.subscribed!==false && manualDisconnect?.chat===chat.id)manualDisconnect=null;
    if(channelWatch?.chat===chat.id){
      if(channelInfo)channelWatch.channel=channelInfo;
      if(isChannelSatisfied(chat,channelWatch.action)){
        const finishedAction=channelWatch.action;
        clearChannelWatch(false);
        showNotice(finishedAction==='connect'?'Dot 已连接对话 '+chat.id:'Dot 已暂停对话 '+chat.id+' 的事件订阅','info');
      }
    }
    if(channelFallback?.chat===chat.id && isChannelSatisfied(chat,channelFallback.action)){
      const finishedAction=channelFallback.action;
      $('chat-channel-dialog').close();channelFallback=null;
      showNotice((finishedAction==='connect'?'Dot 已连接对话 ':'Dot 已暂停订阅对话 ')+chat.id+'，已自动关闭提醒','info');
    }
    controls();const url='/chat?device='+encodeURIComponent(device)+'&id='+encodeURIComponent(chat.id);if(location.pathname+location.search!==url)history.replaceState(null,'',url);
  }
  async function refreshList(){if(!device){list.textContent='暂无可用电脑';return;}const current=device;let cursor=0;list.replaceChildren();async function load(){const value=await api('list',{device_id:current,after:cursor,limit:30});if(current!==device)return;list.querySelector('[data-more]')?.remove();for(const item of value.chats || []){const button=document.createElement('button');button.type='button';button.className='chat-list-item';button.dataset.chatId=item.id;button.setAttribute('aria-current',String(item.id===chat?.id));const title=document.createElement('strong');title.textContent=item.title || '未命名对话';const meta=document.createElement('span');meta.textContent=(item.mode==='super_agent'?'Super Agent':'Chat')+' · '+item.id+' · '+displayDate(item.updated_at || item.created_at);button.append(title,meta);button.addEventListener('click',()=>openChat(item.id).catch(errors));list.append(button);}cursor=value.next_cursor;if(cursor!==null && cursor!==undefined){const more=document.createElement('button');more.type='button';more.dataset.more='true';more.className='chat-list-more';more.textContent='更多对话';more.addEventListener('click',()=>{more.disabled=true;load().catch(error=>{more.disabled=false;errors(error);});});list.append(more);}if(!list.childNodes.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='这台电脑还没有对话';list.append(empty);}}await load();}
  function approvalState(value){
    if(value.state==='invalidated')return '授权已变化';
    if(value.decision)return ({'allowed-once':value.tool?'已批准本次调用':'已批准本次命令',rejected:'已拒绝',cancelled:'已取消'}[value.decision] || '审批已处理')+(value.delivery_pending?' · 等待电脑接收':' · 决定已送达');
    return {pending:'等待审批',expired:'审批已过期',revoked:'授权已撤销',ended:'审批已结束',invalidated:'授权已变化'}[value.state] || '审批已结束';
  }
  function renderApproval(item,node){
    const value=item.approval,previous=approvalStates.get(value.id),signature=JSON.stringify(value);
    if(previous?.signature===signature)return;
    approvalStates.set(value.id,{value,signature,node});node.dataset.kind='approval';
    let details=node.querySelector('.chat-approval');
    if(!details){
      details=document.createElement('details');details.className='chat-approval';
      const summary=document.createElement('summary');summary.dataset.approvalState='';details.append(summary);
      const fields=document.createElement('dl');
      for(const [key,label] of [['device','电脑'],['cwd','目录'],['command',value.tool?'工具调用':'命令'],['justification','理由'],['expires_at','有效期']]){const term=document.createElement('dt'),entry=document.createElement('dd');term.textContent=label;const content=key==='command'?document.createElement('pre'):entry;content.dataset.approvalField=key;if(content!==entry){content.tabIndex=0;entry.append(content);}fields.append(term,entry);}details.append(fields);
      const note=document.createElement('p');note.className='field-note';note.textContent=value.tool?'仅批准这一次工具调用，工作区限制保持不变。':(value.permission_confirmation?'本次同时申请使用命令工具。':'')+'批准后，本次命令及其子进程、后续输入将以当前登录用户权限在工作区沙盒外运行。';details.append(note);
      const actions=document.createElement('div');actions.className='chat-approval-actions';
      for(const [decision,label] of [['cancelled',value.tool?'取消调用':'取消命令'],['rejected','拒绝'],['allowed-once','批准本次']]){const button=document.createElement('button');button.type='button';button.dataset.decision=decision;button.textContent=label;if(decision!=='allowed-once')button.className='secondary';button.addEventListener('click',()=>decideApproval(value.id,decision));actions.append(button);}details.append(actions);
      const notice=document.createElement('p');notice.className='chat-approval-notice';notice.setAttribute('role','status');details.append(notice);node.append(details);
    }
    const pending=value.state==='pending'&&!value.decision;
    if(!previous || previous.value.state==='pending'&&value.state!=='pending' || !previous?.value.decision&&value.decision)details.open=pending;
    details.querySelector('[data-approval-state]').textContent=(value.tool?'工具审批':'命令审批')+' · '+approvalState(value);
    for(const entry of details.querySelectorAll('[data-approval-field]')){const field=entry.dataset.approvalField;entry.textContent=field==='device'?value.device_name+' · '+value.device_id:field==='expires_at'?displayDate(value.expires_at):value[field] || '';}
    details.querySelector('.chat-approval-actions').hidden=!pending;
    for(const button of details.querySelectorAll('[data-decision]'))button.disabled=!pending||approvalBusy.has(value.id);
    if(!pending)details.querySelector('.chat-approval-notice').textContent='';
  }
  async function decideApproval(id,decision){
    const current=approvalStates.get(id),chatId=chat?.id;
    if(!current||!chatId||approvalBusy.has(id)||current.value.state!=='pending'||current.value.decision)return;
    const isCurrent=()=>chat?.id===chatId&&approvalStates.get(id)?.node===current.node;
    approvalBusy.add(id);const card=current.node.querySelector('.chat-approval');for(const button of card.querySelectorAll('[data-decision]'))button.disabled=true;card.querySelector('.chat-approval-notice').textContent='正在提交…';
    try{await api('approval-decide',{id,decision,chat_id:chatId});if(isCurrent())await requestSync();}
    catch(error){if(isCurrent())card.querySelector('.chat-approval-notice').textContent=error.message || String(error);}
    finally{approvalBusy.delete(id);if(isCurrent()){const state=approvalStates.get(id)?.value;for(const button of card.querySelectorAll('[data-decision]'))button.disabled=state?.state!=='pending'||!!state.decision;}}
  }
  function renderMessage(item){messageData.set(item.id,item);if(item.role==='user' && !item.kind && !item.approval_id && item.text)recallMessages.set(item.id,{sequence:item.sequence || Number(item.id.slice(1)),text:item.text});if(item.approval_id)return null;const key=item.id;let node=seen.get(key);const delivered=messageStatus(item);if(node){const status=node.querySelector('[data-delivery]');if(status && status.textContent!==delivered)status.textContent=delivered;if(item.kind==='approval'&&item.approval)renderApproval(item,node);return node;}node=document.createElement('article');node.className='chat-message';node.dataset.role=item.role==='assistant'?'assistant':'user';node.dataset.id=key;node.dataset.sequence=String(item.sequence || Number(key.slice(1)));const meta=document.createElement('div');meta.className='chat-message-meta';meta.textContent=(item.source==='module'?'Super Agent':item.role==='assistant'?'GPT／Dot':item.source_identity?.kind==='account'&&item.source_identity.id===initial.account_id?'你':item.source_identity?.kind==='device'?'电脑端用户':'用户')+' · '+key+' · '+displayDate(item.created_at);const delivery=document.createElement('span');delivery.dataset.delivery='true';delivery.textContent=delivered;delivery.style.marginLeft='8px';meta.append(delivery);node.append(meta);if(item.reply_to){const citation=document.createElement('details'),label=document.createElement('summary'),preview=document.createElement('div'),targetChat=chat.id;citation.className='chat-quote-citation';label.textContent='引用 '+item.reply_to;preview.textContent='展开读取原消息';citation.append(label,preview);citation.addEventListener('toggle',async()=>{if(!citation.open||citation.dataset.loaded||chat?.id!==targetChat)return;try{const original=await findMessage(item.reply_to,targetChat);if(chat?.id!==targetChat)return;preview.textContent=original.text||'（附件消息）';citation.dataset.loaded='true';}catch(error){preview.textContent=error.message||'原消息不可用';}});node.append(citation);}if(item.kind==='approval'&&item.approval)renderApproval(item,node);else if(item.text){const body=document.createElement('div');body.className='chat-message-body';window.bridgeMarkdown.render(body,item.text,item.id);node.append(body);}if(item.attachments?.length){const files=document.createElement('div');files.className='chat-message-files';for(const file of item.attachments){const link=document.createElement('a');link.className='chat-file';link.href=fileUrl(file);link.target='_blank';link.rel='noopener';const info=document.createElement('span');info.textContent=file.name+' · '+bytes(file.size);if((file.mime_type || '').startsWith('image/') && ['image/png','image/jpeg','image/gif','image/webp'].includes(file.mime_type)){link.classList.add('chat-file-preview');const image=document.createElement('img');image.loading='lazy';image.src=link.href+'?inline=1';image.alt=file.name;link.append(image);}link.append(info);files.append(link);}node.append(files);}seen.set(key,node);return node;}
  const maintenanceRows=new Map();
  function mergeMaintenance(items){
    const bottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90,anchor=!bottom&&window.bridgeChatLayout?.capture();
    for(const item of items||[]){
      if(!/^cm[0-9]+$/.test(item.id)||!Number.isSafeInteger(item.anchor_sequence))continue;
      const previous=maintenanceRows.get(item.id);
      if(previous && previous.updated_at>item.updated_at)continue;
      maintenanceRows.set(item.id,item);
    }
    for(const item of maintenanceRows.values()){
      if(firstLoaded&&item.anchor_sequence<firstLoaded)continue;
      let node=messages.querySelector('[data-maintenance-id="'+item.id+'"]');
      if(!node){node=document.createElement('div');node.dataset.maintenanceId=item.id;node.className='chat-maintenance-status';node.style.cssText='margin:12px 0;padding:8px 12px;border-left:3px solid currentColor;font-size:12px;opacity:.85';node.setAttribute('role','status');}
      node.textContent=item.text;node.dataset.state=item.state;
      const next=ordered.find(n=>Number(n.dataset.sequence)>item.anchor_sequence);
      messages.insertBefore(node,next||null);
    }
    if(bottom)messages.scrollTop=messages.scrollHeight;else if(anchor)window.bridgeChatLayout.restore(anchor);
  }
  function clearMessages(){window.bridgeChatLayout?.unwatch();recallMessages.clear();messageData.clear();recall=null;seen.clear();maintenanceRows.clear();approvalStates.clear();ordered=[];firstLoaded=0;messages.replaceChildren();}
  function insertMessages(items,historyPage=false){
    let changed=false;const fragment=document.createDocumentFragment();
    for(const item of items || []){
      const sequence=item.sequence || Number(item.id.slice(1));
      if(!historyPage && firstLoaded && sequence<firstLoaded&&!seen.has(item.id))continue;
      if(!firstLoaded||sequence<firstLoaded)firstLoaded=sequence;
      const old=seen.get(item.id);if(historyPage&&old)continue;
      const oldState=old?.querySelector('[data-delivery]')?.textContent,oldApproval=item.approval&&approvalStates.get(item.approval.id)?.signature;
      const node=renderMessage(item);if(!node)continue;if(!old)window.bridgeChatLayout?.watch(node);
      if(old){changed ||= oldState!==node.querySelector('[data-delivery]')?.textContent||oldApproval!==(item.approval&&approvalStates.get(item.approval.id)?.signature);continue;}
      if(!ordered.length||sequence>Number(ordered.at(-1).dataset.sequence)){ordered.push(node);fragment.append(node);}
      else {if(fragment.childNodes.length)messages.append(fragment);let low=0,high=ordered.length;while(low<high){const middle=(low+high)>>1;if(Number(ordered[middle].dataset.sequence)<sequence)low=middle+1;else high=middle;}messages.insertBefore(node,ordered[low] || null);ordered.splice(low,0,node);}changed=true;
    }
    if(fragment.childNodes.length)messages.append(fragment);
    if(ordered.length)messages.querySelector('.chat-empty')?.remove();
    return changed;
  }
  function historyHint(label){
    if(!label){historyNote.remove();return;}setText(historyNote,label);if(messages.firstChild!==historyNote)messages.prepend(historyNote);
  }
  function cancelHistory(){cancelAnimationFrame(historyFrame);historyFrame=0;if(historyRun){historyRun.abort.abort();historyRun=null;}}
  function scheduleHistory(){if(!historyBlocked && !historyFrame && !historyRun && !stopped && !document.hidden)historyFrame=requestAnimationFrame(()=>{historyFrame=0;if(before && historyGeneration===generation && messages.scrollTop<messages.clientHeight)void loadOlder();});}
  messages.addEventListener('scroll',()=>{if(messages.scrollTop>=messages.clientHeight)historyBlocked=false;scheduleHistory();},{passive:true});
  function retryHistory(){if(historyBlocked){historyBlocked=false;scheduleHistory();}}
  messages.addEventListener('wheel',event=>{if(event.deltaY<0)retryHistory();},{passive:true});messages.addEventListener('touchstart',retryHistory,{passive:true});messages.addEventListener('keydown',event=>{if(['Home','PageUp','ArrowUp'].includes(event.key))retryHistory();});
  async function loadOlder(){
    if(!chat || !before || historyRun || reconcile || historyGeneration!==generation || stopped || document.hidden)return;
    const page={id:chat.id,generation,cursor:syncCursor,before,abort:new AbortController()};historyRun=page;const markerAnchor=window.bridgeChatLayout.capture();historyHint('正在读取更早消息…');window.bridgeChatLayout.restore(markerAnchor);
    try{
      const value=await api('history',{chat_id:page.id,before:page.before,limit:50},page.abort.signal);
      if(historyRun!==page || page.generation!==generation || document.hidden)return;
      // A live update can arrive while history is loading. Keep current nodes and reconcile the newly visible ones.
      const ids=new Set(value.messages.filter(item=>!seen.has(item.id)).map(item=>item.id));
      const anchor=window.bridgeChatLayout.capture();insertMessages(value.messages,true);mergeMaintenance(value.maintenance_statuses);before=value.has_older?value.first_cursor:null;historyHint(before?'':'已到最早消息');window.bridgeChatLayout.restore(anchor);
      if(ids.size){reconcile={generation,cursor:page.cursor,ids};await requestSync();}
      if(historyRun===page){historyRun=null;scheduleHistory();}
    }catch(error){if(historyRun===page && error.name!=='AbortError'){historyBlocked=true;historyHint('更早消息读取失败，再向上滚动可重试');}}
    finally{if(historyRun===page)historyRun=null;}
  }
  function mergeMessages(items){
    const bottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90,anchor=!bottom&&window.bridgeChatLayout?.capture(),changed=insertMessages(items);
    if(changed&&bottom)messages.scrollTop=messages.scrollHeight;else if(changed&&anchor)window.bridgeChatLayout.restore(anchor);return changed;
  }
  async function openChat(id){
    if(uploading || sending)throw new Error('请等待当前消息或附件发送完成');
    if(chat)drafts.set(chat.id,{text:text.value,attachments:[...attachments],sendKey,quote});
    clearError();const own=++generation;cancelHistory();historyGeneration=-1;reconcile=null;closeLive();clearChannelWatch(true);closeSlash();recall=null;$('chat-quote-dialog').close();
    try{
      const value=await api('sync',{chat_id:id,cursor:0});if(own!==generation)return;
      authExpired=false;setChat(value.chat,value.channel);syncCursor=value.cursor;const draft=drafts.get(id);text.value=draft?.text || '';attachments=draft?.attachments || [];sendKey=draft?.sendKey || null;quote=draft?.quote || null;renderQuote();renderAttachments();
      clearMessages();insertMessages(value.messages,true);mergeMaintenance(value.maintenance_statuses);
      before=value.has_older?value.first_cursor:null;historyGeneration=own;historyBlocked=false;historyHint(!before&&value.messages.length?'已到最早消息':'');
      if(!seen.size){const empty=document.createElement('div');empty.className='chat-empty';empty.textContent='消息会保留在这段对话中。Dot 接入对话后即可交流。';messages.append(empty);}
      messages.scrollTop=messages.scrollHeight;scheduleHistory();retry=0;connectLive();await refreshList();if(own===generation){window.dispatchEvent(new Event('bridge-chat-opened'));if(!window.bridgeChatLayout?.isCompact())text.focus();}
    }catch(error){if(own===generation && chat){historyGeneration=own;connectLive();}throw error;}
  }
  function requestSync(){
    if(document.hidden || stopped || authExpired || !chat)return Promise.resolve();
    const id=chat.id,own=generation;
    if(syncRun?.generation===own){syncRun.again=true;return syncRun.promise;}
    const run={generation:own,again:true,promise:null};syncRun=run;
    run.promise=(async()=>{
      while((run.again || reconcile?.generation===own) && own===generation && !document.hidden && !stopped && !authExpired){
        const check=reconcile;
        if(check?.generation===own){
          const value=await api('sync',{chat_id:id,cursor:check.cursor});if(own!==generation || reconcile!==check || document.hidden || stopped)return;
          mergeMessages(value.messages.filter(item=>check.ids.has(item.id)));mergeMaintenance(value.maintenance_statuses);check.cursor=value.cursor;
          if(!value.more){reconcile=null;scheduleHistory();}continue;
        }
        run.again=false;const value=await api('sync',{chat_id:id,cursor:syncCursor});
        if(own!==generation)return;
        mergeMessages(value.messages);mergeMaintenance(value.maintenance_statuses);setChat(value.chat,value.channel);syncCursor=value.cursor;retry=0;
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
    let opened=false;const socket=new WebSocket(url);live=socket;
    socket.onopen=()=>{if(live!==socket || own!==generation)return;opened=true;};
    socket.onmessage=event=>{
      if(live!==socket || own!==generation)return;let value;try{value=JSON.parse(event.data);}catch{return;}
      if(value.type==='approvals.changed'){void requestSync();return;}
      if(value.chat_id!==id)return;
      if(value.type==='chat.ready')retryHistory();if(value.type==='chat.changed' || value.type==='chat.ready')void requestSync();
    };
    socket.onclose=event=>{
      if(live!==socket || own!==generation)return;live=null;
      if([1008,4401,4403,4404].includes(event.code)){authExpired=true;errors(new Error(event.code===4404?'对话已删除或不可访问':'聊天授权已失效，请重新登录'));return;}
      if(document.hidden || stopped || authExpired)return;
      if(!opened)void requestSync();
      reconnectTimer=setTimeout(()=>{reconnectTimer=null;connectLive();},Math.min(1000*2**retry++,15000));
    };
    socket.onerror=()=>{};
  }
  function renderAttachments(){const container=$('chat-attachments');container.replaceChildren();attachments.forEach((file,index)=>{const tag=document.createElement('span');tag.className='chat-attachment';const label=document.createElement('span');label.textContent=file.name+' · '+bytes(file.size);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除附件 '+file.name);remove.addEventListener('click',()=>{attachments.splice(index,1);sendKey=null;renderAttachments();});tag.append(label,remove);container.append(tag);});const queue=chat?uploads.get(chat.id) || []:[];for(const job of queue){const tag=document.createElement('span');tag.className='chat-attachment';const label=document.createElement('span');label.textContent=job.file.name+' · '+(uploading&&job===queue[0]?'上传中':'等待重试');const cancel=document.createElement('button');cancel.type='button';cancel.textContent=uploading&&job===queue[0]?'暂停':'×';cancel.setAttribute('aria-label',(uploading&&job===queue[0]?'暂停上传 ':'取消上传 ')+job.file.name);cancel.addEventListener('click',()=>{if(uploading&&job===queue[0])uploadRun?.abort();else queue.splice(queue.indexOf(job),1);renderAttachments();});tag.append(label,cancel);container.append(tag);}if(queue.length && !uploading){const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='重试上传';retry.addEventListener('click',()=>runUploads().catch(errors));container.append(retry);}}
  async function addFiles(files){if(!chat || uploading || sending)return;const queue=uploads.get(chat.id) || [];for(const file of files)queue.push({file,key:crypto.randomUUID()});uploads.set(chat.id,queue);await runUploads();}
  async function runUploads(allowSending=false){
    if(!chat || uploading || sending&&!allowSending)return;clearError();uploading=true;controls();renderAttachments();
    const id=chat.id,queue=uploads.get(id) || [];uploadRun=new AbortController();
    try{while(queue.length){
      const job=queue[0],file=job.file;$('chat-upload-status').textContent='上传 '+file.name;
      const finished=await window.bridgeChatUploads.upload(job,{chatId:id,csrf:initial.csrf,api:(action,args)=>api(action,args,AbortSignal.any([controller.signal,uploadRun.signal])),signal:AbortSignal.any([controller.signal,uploadRun.signal]),
        progress:(offset,size)=>{$('chat-upload-status').textContent=file.name+' '+(size?Math.min(100,Math.round(offset/size*100)):100)+'%';}});
      job.finished=finished;if(!attachments.some(a=>a.id===finished.id))attachments.push(finished);
      queue.shift();sendKey=null;renderAttachments();
    }}finally{uploadRun=null;uploading=false;$('chat-upload-status').textContent='';$('chat-files').value='';controls();renderAttachments();}
  }
  function renderQuote(){const box=$('chat-quote-preview');box.hidden=!quote;$('chat-quote-text').textContent=quote?'引用 '+quote.id+' · '+(quote.text||'（附件消息）').slice(0,160):'';$('chat-quote-clear').disabled=sending||uploading||!!(chat&&uncertain.has(chat.id));}
  async function findMessage(id,chatId=chat?.id){
    if(!chatId||!/^m[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id.slice(1))))throw new Error('请输入消息 ID，例如 /quote m1');
    const cached=chat?.id===chatId&&messageData.get(id);if(cached)return cached;
    const value=await api('history',{chat_id:chatId,after:Number(id.slice(1))-1,limit:1});const item=value.messages?.find(item=>item.id===id);if(!item)throw new Error('这条消息不存在或当前无权读取');return item;
  }
  function selectQuote(item){if(item.role!=='assistant'||item.approval_id||item.kind==='approval')throw new Error('只能引用当前对话中的 dot 消息');quote={id:item.id,text:item.text||''};sendKey=null;renderQuote();text.focus();}
  async function chooseQuote(parts){
    const id=chat?.id,own=generation;if(!id)return;if(uncertain.has(id))throw new Error('请先确认原消息发送结果');
    if(parts[0]==='cancel'){quote=null;renderQuote();text.focus();return;}
    if(parts.length){const item=await findMessage(parts[0],id);if(chat?.id!==id||generation!==own)return;selectQuote(item);text.value=parts.slice(1).join(' ');return;}
    const choices=[...messageData.values()].filter(item=>item.role==='assistant'&&!item.approval_id&&item.kind!=='approval').sort((a,b)=>b.sequence-a.sequence);
    if(!choices.length)throw new Error('已加载的记录中没有 dot 消息；可用 /quote m1 指定更早消息');
    const options=$('chat-quote-options');options.replaceChildren();for(const item of choices){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=item.id+' · '+(item.text||'（附件消息）').slice(0,180);button.addEventListener('click',()=>{if(chat?.id!==id||generation!==own)return;selectQuote(item);$('chat-quote-dialog').close();});options.append(button);}
    $('chat-quote-dialog').showModal();options.querySelector('button')?.focus();
  }
  $('chat-quote-clear').addEventListener('click',()=>{if(sending||uploading||chat&&uncertain.has(chat.id))return;quote=null;sendKey=null;renderQuote();text.focus();});
  $('chat-quote-close').addEventListener('click',()=>{$('chat-quote-dialog').close();text.focus();});
  let sendKey=null;
  composer.addEventListener('submit',async event=>{
    event.preventDefault();if(isSlashCommand(text.value)){void runSlash(text.value);return;}if(!chat || sending || uploading || (!text.value.trim() && !attachments.length))return;
    clearError();sending=true;controls();const id=chat.id;let body=uncertain.get(id);
    try{
      if(!body){let content=text.value;const stale=largeBodies.get(id);if(stale&&stale.text!==content){if(stale.job.finished)attachments=attachments.filter(item=>item.id!==stale.job.finished.id);uploads.set(id,(uploads.get(id)||[]).filter(job=>job!==stale.job));largeBodies.delete(id);}
        if(new TextEncoder().encode(JSON.stringify({text:content})).length>1500000){
          const cmdMatch=chat.mode==='super_agent'?/^\s*(\/(?:task-new|new)|\/task\s+\S+)\s+([\s\S]+)$/.exec(content):null;
          const uploadText=cmdMatch&&cmdMatch[2].trim()?cmdMatch[2]:content,keptText=cmdMatch&&cmdMatch[2].trim()?cmdMatch[1].replace(/\s+/,' '):'';
          let previous=largeBodies.get(id);
          if(!previous||previous.text!==content){if(previous?.job.finished)attachments=attachments.filter(item=>item.id!==previous.job.finished.id);previous={text:content,job:{file:new File([uploadText],'message-body.md',{type:'text/markdown;charset=utf-8'}),key:crypto.randomUUID()}};largeBodies.set(id,previous);}
          if(!previous.job.finished){const queue=uploads.get(id)||[];if(!queue.includes(previous.job))queue.push(previous.job);uploads.set(id,queue);await runUploads(true);}
          if(!attachments.some(item=>item.id===previous.job.finished.id))attachments.push(previous.job.finished);content=keptText;
        }
        sendKey ||= crypto.randomUUID();body={chat_id:id,text:content,attachments:attachments.map(a=>a.id),...(quote?{reply_to:quote.id}:{}),request_key:sendKey};
      }
      const value=await api('send',body);
      uncertain.delete(id);if(chat?.id!==id)return;if(!seen.has(value.message.id))mergeMessages([value.message]);sendKey=null;text.value='';attachments=[];quote=null;renderQuote();drafts.delete(id);largeBodies.delete(id);renderAttachments();
    }catch(error){if(body&&(!error.status||error.status>=500)){uncertain.set(id,body);errors(new Error('结果待确认。点击“确认发送结果”查询原消息，不会重复发送。'));}else{uncertain.delete(id);errors(error);}}finally{sending=false;controls();void requestSync();}
  });
  text.addEventListener('input',()=>{sendKey=null;recall=null;refreshSlash();});
  text.addEventListener('keydown',event=>{
    if(event.isComposing || event.keyCode===229)return;
    if(!slashMenu.hidden){
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();slashIndex=(slashIndex+(event.key==='ArrowUp'?-1:1)+slashItems.length)%slashItems.length;paintSlash();return;}
      if(event.key==='Escape'){event.preventDefault();closeSlash();return;}
      if(event.key==='Tab'){event.preventDefault();text.value=slashItems[slashIndex].name;closeSlash();return;}
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void runSlash(slashItems[slashIndex].name);return;}
    }
    if(event.key==='Enter'&&!event.shiftKey&&isSlashCommand(text.value)){event.preventDefault();void runSlash(text.value);return;}
    if((event.key==='ArrowUp'||event.key==='ArrowDown') && !event.ctrlKey&&!event.metaKey&&!event.altKey&&!text.readOnly&&!document.querySelector('dialog[open]') && (recall!==null || event.key==='ArrowUp'&&text.value==='')){
      const values=recall || [...recallMessages.values()].sort((a,b)=>a.sequence-b.sequence).map(m=>m.text);
      if(values.length){event.preventDefault();if(recall===null){recall=values;recall.index=values.length;}recall.index=Math.max(0,Math.min(recall.length,recall.index+(event.key==='ArrowUp'?-1:1)));text.value=recall[recall.index] || '';text.setSelectionRange(text.value.length,text.value.length);if(recall.index===recall.length)recall=null;}return;
    }
    if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();composer.requestSubmit();}
  });
  $('chat-attach').addEventListener('click',()=>$('chat-files').click());$('chat-files').addEventListener('change',()=>addFiles(Array.from($('chat-files').files)).catch(errors));
  composer.addEventListener('dragover',event=>{event.preventDefault();composer.classList.add('dragging');});composer.addEventListener('dragleave',()=>composer.classList.remove('dragging'));composer.addEventListener('drop',event=>{event.preventDefault();composer.classList.remove('dragging');addFiles(Array.from(event.dataTransfer.files)).catch(errors);});text.addEventListener('paste',event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();addFiles(files).catch(errors);}});
  deviceSelect.addEventListener('change',()=>{if(uploading || sending){deviceSelect.value=device;return;}if(chat)drafts.set(chat.id,{text:text.value,attachments:[...attachments],sendKey,quote});generation++;historyGeneration=-1;cancelHistory();reconcile=null;closeLive();device=deviceSelect.value;startLatency();approvalStates.clear();chat=null;attachments=[];quote=null;renderQuote();$('chat-quote-dialog').close();clearMessages();syncCursor=0;before=null;text.value='';renderAttachments();messages.replaceChildren();clearChannelWatch(true);controls();history.replaceState(null,'','/chat?device='+encodeURIComponent(device));refreshList().catch(errors);});
  $('chat-resume').addEventListener('submit',event=>{event.preventDefault();const id=$('chat-id').value.trim();if(!/^t[1-9][0-9]*$/.test(id)){errors(new Error('请输入对话短 ID，例如 t1'));return;}openChat(id).catch(errors);});
  const titleDialog=$('chat-title-dialog');let titleAction='create',createAttempt=null,createBusy=false;
  function syncCreateRepository(){const agent=$('chat-create-mode').value==='super_agent';$('chat-repository-options').hidden=!agent;$('chat-repository-field').hidden=!agent||$('chat-create-repository').value==='none';}
  $('chat-create-mode').addEventListener('change',syncCreateRepository);
  $('chat-create-repository').addEventListener('change',syncCreateRepository);
  $('chat-new').addEventListener('click',()=>{
    if(!device||createBusy)return;titleAction='create';$('chat-title-heading').textContent=createAttempt?'确认新建结果':'新建对话';
    $('chat-create-options').hidden=false;$('chat-title-input').value=createAttempt?.title||'';
    $('chat-create-mode').value=createAttempt?.mode||'chat';$('chat-create-repository').value=createAttempt?.repository?.provider||'none';$('chat-repository-url').value=createAttempt?.repository?.url||'';
    syncCreateRepository();
    for(const id of ['chat-title-input','chat-create-mode','chat-create-repository','chat-repository-url'])$(id).disabled=!!createAttempt;
    titleDialog.returnValue='';titleDialog.showModal();(createAttempt?titleDialog.querySelector('[value="save"]'):$('chat-title-input')).focus();
  });
  titleDialog.addEventListener('close',async()=>{
    if(titleDialog.returnValue!=='save'||createBusy)return;
    try{
      const title=$('chat-title-input').value.trim();
      if(titleAction==='create'){
        const mode=$('chat-create-mode').value,provider=$('chat-create-repository').value;
        createAttempt ||= mode==='super_agent'?{device_id:device,title,mode,repository:provider==='none'?null:{provider,url:$('chat-repository-url').value.trim()},request_key:crypto.randomUUID()}:{device_id:device,title,mode,request_key:crypto.randomUUID()};
        createBusy=true;$('chat-new').disabled=true;
        const value=await api('create',createAttempt);createAttempt=null;const created=value.chat||value;await openChat(created.id);
        startChannelWatch(created.id,'connect',value.channel);
      }else{await api('rename',{chat_id:chat.id,title});await requestSync();await refreshList();}
    }catch(error){
      if(titleAction==='create'&&createAttempt){
        if(error.status&&error.status<500)createAttempt=null;
        else error=new Error('新建结果待确认。再次点击“新建”将查询同一请求，不会重复创建。');
      }
      errors(error);
    }finally{createBusy=false;$('chat-new').disabled=false;}
  });
$('chat-delete-dialog').addEventListener('close',async()=>{if($('chat-delete-dialog').returnValue!=='delete')return;const targetId=chat.id;try{const deleted=await api('delete',{chat_id:targetId});drafts.delete(targetId);uploads.delete(targetId);largeBodies.delete(targetId);generation++;historyGeneration=-1;cancelHistory();reconcile=null;closeLive();chat=null;attachments=[];quote=null;renderQuote();$('chat-quote-dialog').close();renderAttachments();clearMessages();clearChannelWatch(true);controls();await refreshList();const noticeInfo=immediateChannelNotice(targetId,'delete',deleted?.channel);showNotice(noticeInfo.text,noticeInfo.tone);}catch(error){errors(error);}});
  let channelWatch=null,channelFallback=null,channelWatchSeq=0,exportRun=null;
  function clearChannelWatch(closeDialog=false){
    if(channelWatch){clearTimeout(channelWatch.timer);channelWatch=null;}
    if(closeDialog&&channelFallback){$('chat-channel-dialog').close();channelFallback=null;}
  }
  function showChannelFallback(action,channelInfo,recentDiag=null){
    if(!chat || isChannelSatisfied(chat,action))return;
    const dialog=$('chat-channel-dialog');
    if(!dialog.open && document.querySelector('dialog[open]')){channelFallback={chat:chat.id,action,channel:channelInfo,diag:recentDiag,deferred:true};return;}
    const d=shortDevice(chat.device_id),label=d?.name || chat.device_name || chat.device_id;
    setText($('chat-channel-heading'),action==='connect'?'请手动告知 Dot 连接对话':'请手动告知 Dot 暂停对话');
    setText($('chat-channel-device'),label+' · '+chat.device_id+' · '+chat.id);
    const reason=describeChannelReason(channelInfo,recentDiag);
    const phrase=action==='connect'?'连接对话 '+chat.id:'暂停对话 '+chat.id;
    setText($('chat-channel-status'),(action==='connect'?'Dot 已超过 1 分钟未自动连接此对话':'Dot 已超过 1 分钟未响应暂停事件订阅')+'（'+reason+'）。\n建议手动前往 Dot 告知它发送或执行：');
    $('chat-channel-id').value=chat.id;
    $('chat-channel-phrase').value=phrase;
    $('chat-channel-id-copy').textContent='复制 ID';
    $('chat-channel-copy').textContent='复制话术';
    channelFallback={chat:chat.id,action};
    if(!dialog.open)dialog.showModal();
  }
  function startChannelWatch(chatId,action,channelInfo=null){
    clearChannelWatch(true);
    if(!chat || chat.id!==chatId)return;
    if(isChannelSatisfied(chat,action)){
      showNotice(action==='connect'?'对话 '+chatId+' 已处于 Dot 连接状态':'对话 '+chatId+' 已暂停事件订阅','info');
      return;
    }
    const immediate=immediateChannelNotice(chatId,action,channelInfo);
    showNotice(immediate.text,immediate.tone);
    const seq=++channelWatchSeq;
    const timer=setTimeout(async()=>{
      if(!channelWatch || channelWatch.seq!==seq || !chat || chat.id!==chatId)return;
      if(!document.hidden && !stopped && !authExpired){try{await requestSync();}catch{}}
      if(!channelWatch || channelWatch.seq!==seq || !chat || chat.id!==chatId)return;
      if(isChannelSatisfied(chat,action)){clearChannelWatch(false);return;}
      let latestChannel=channelWatch.channel,recentDiag=null;
      try{const diag=await api('channel',{chat_id:chatId});latestChannel=diag.command || latestChannel;recentDiag=diag.recent_diagnostics?.at(-1) || null;}catch{}
      if(!channelWatch || channelWatch.seq!==seq || !chat || chat.id!==chatId || isChannelSatisfied(chat,action))return;
      channelWatch=null;
      showChannelFallback(action,latestChannel,recentDiag);
    },CHANNEL_FALLBACK_MS);
    channelWatch={seq,chat:chatId,action,timer,channel:channelInfo};
  }
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{
    if(dialog.id==='chat-channel-dialog'){if(channelFallback&&!channelFallback.deferred)channelFallback=null;return;}
    if(channelFallback?.deferred&&chat?.id===channelFallback.chat&&!isChannelSatisfied(chat,channelFallback.action))showChannelFallback(channelFallback.action,channelFallback.channel,channelFallback.diag);
  });
  ${deviceSettingsScript}
  const slashMenu=$('chat-slash-menu'),slashCommands=[{name:'/quote',description:'引用 dot 消息，/quote cancel 取消引用'},{name:'/permissions',description:'管理这台电脑的权限',device:true},{name:'/workspaces',description:'管理这台电脑的工作区',device:true},{name:'/export',description:'下载完整会话与附件 ZIP'},{name:'/connect',description:'通知 Dot 连接当前对话'},{name:'/disconnect',description:'通知 Dot 暂停当前对话的事件订阅'},{name:'/title',description:'修改当前对话标题'},{name:'/delete',description:'删除当前对话并通知 Dot 清理连接'},{name:'/tasks',description:'Super Agent：任务列表',agent:true},{name:'/task-new',description:'Super Agent：新建任务',agent:true,argument:true},{name:'/task',description:'Super Agent：定向跟进任务',agent:true,argument:true},{name:'/cancel',description:'Super Agent：取消后续工作',agent:true,argument:true},{name:'/retry',description:'Super Agent：明确重试',agent:true,argument:true},{name:'/pause',description:'Super Agent：暂停调度',agent:true},{name:'/task-resume',description:'Super Agent：恢复调度',agent:true}];let slashItems=[],slashIndex=0,slashDismissed=null;
  function closeSlash(){slashMenu.hidden=true;slashDismissed=text.value;text.setAttribute('aria-expanded','false');}
  function paintSlash(){slashMenu.replaceChildren();for(const [i,command] of slashItems.entries()){const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.setAttribute('aria-selected',String(i===slashIndex));const name=document.createElement('strong'),description=document.createElement('span');name.textContent=command.name;description.textContent=command.description;item.append(name,description);item.addEventListener('pointerdown',e=>e.preventDefault());item.addEventListener('click',()=>void runSlash(command.name));slashMenu.append(item);}}
  function refreshSlash(){const prefix=text.value;if(!device || !/^\/[a-z-]*$/i.test(prefix)||text.selectionStart!==prefix.length||prefix===slashDismissed){slashMenu.hidden=true;return;}slashItems=slashCommands.filter(c=>(chat||c.device)&&(!c.agent||chat?.mode==='super_agent')&&c.name.startsWith(prefix.toLowerCase()));slashIndex=0;slashMenu.hidden=!slashItems.length;text.setAttribute('aria-expanded',String(!slashMenu.hidden));paintSlash();}
  function isSlashCommand(value){return slashCommands.some(c=>!c.agent&&(value===c.name||value.startsWith(c.name+' ')));}
  async function runSlash(value){
    const [command,...parts]=value.trim().split(/\s+/),entry=slashCommands.find(c=>c.name===command);if(!entry||!device||(!chat&&!entry.device))return;if(entry.agent){if(chat?.mode!=='super_agent')return;text.value=command+(entry.argument?' ':'');closeSlash();text.focus();if(!entry.argument)composer.requestSubmit();return;}text.value='';recall=null;sendKey=null;closeSlash();
    if(entry.device)await showDeviceSettings(command.slice(1),chat?.device_id||device);
    else if(command==='/quote'){try{await chooseQuote(parts);}catch(error){errors(error);}}
    else if(command==='/connect'){manualDisconnect=null;const targetId=chat.id;try{const result=await api('connect',{chat_id:targetId});if(result.chat&&chat?.id===targetId)setChat(result.chat,result.channel);startChannelWatch(targetId,'connect',result.channel);}catch(error){errors(error);}}
    else if(command==='/disconnect'){const targetId=chat.id;manualDisconnect={chat:targetId,at:Date.now()+CHANNEL_FALLBACK_MS+30000};try{const result=await api('disconnect',{chat_id:targetId});if(result.chat&&chat?.id===targetId)setChat(result.chat,result.channel);startChannelWatch(targetId,'disconnect',result.channel);}catch(error){manualDisconnect=null;errors(error);}}
    else if(command==='/title'){titleAction='rename';$('chat-create-options').hidden=true;$('chat-title-input').disabled=false;$('chat-title-heading').textContent='修改标题';$('chat-title-input').value=parts.join(' ')||chat.title||'';titleDialog.returnValue='';titleDialog.showModal();$('chat-title-input').focus();}
    else if(command==='/delete'){$('chat-delete-dialog').returnValue='';$('chat-delete-dialog').showModal();}
    else if(command==='/export'){
      if(exportRun)return;const target={...chat},abort=new AbortController();exportRun=abort;const dialog=$('chat-export-dialog');$('chat-export-progress').textContent='正在读取完整会话…';dialog.showModal();
      try{const result=await window.bridgeChatExport(api,target,value=>{$('chat-export-progress').textContent=value;},abort.signal);const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=result.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);dialog.close();}
      catch(error){if(error.name!=='AbortError')errors(error);}finally{if(dialog.open)dialog.close();exportRun=null;}
    }
  }
  $('chat-export-cancel').addEventListener('click',()=>{exportRun?.abort();$('chat-export-dialog').close();});$('chat-export-dialog').addEventListener('cancel',()=>exportRun?.abort());
  text.setAttribute('aria-controls','chat-slash-menu');text.setAttribute('aria-autocomplete','list');
  $('chat-channel-close').addEventListener('click',()=>{channelFallback=null;$('chat-channel-dialog').close();});
  async function copy(element,button,label){try{await navigator.clipboard.writeText(element.value);button.textContent='已复制';}catch{element.focus();element.select();errors(new Error('请复制已选中的'+label));}}
  $('chat-channel-id-copy').addEventListener('click',()=>copy($('chat-channel-id'),$('chat-channel-id-copy'),'对话 ID'));
  $('chat-channel-copy').addEventListener('click',()=>copy($('chat-channel-phrase'),$('chat-channel-copy'),'建议话术'));
  for(const item of initial.devices){const option=document.createElement('option');option.value=item.id;option.textContent=item.name+' · '+item.id;deviceSelect.append(option);}deviceSelect.value=device;
  function pauseLatency(){clearTimeout(latencyTimer);latencyTimer=null;latencyRun?.abort();latencyRun=null;}
  function startLatency(){
    pauseLatency();const target=device,badge=$('chat-device-latency');badge.hidden=!target;
    if(latencyTarget!==target){latencyTarget=target;delete badge.dataset.checkedAt;if(target){const known=shortDevice(target);if(typeof known?.online==='boolean')window.bridgeConnection.render(badge,known);else{badge.textContent='测量中';badge.dataset.quality='warning';badge.removeAttribute('title');}}}
    if(!target || stopped || document.hidden || authExpired)return;
    async function refresh(){
      const active=new AbortController();latencyRun=active;
      try{const result=await api('devices',{device_id:target},active.signal);
        if(latencyRun!==active || target!==device || document.hidden)return;
        const current=result.computers[0];if(current)window.bridgeConnection.render(badge,current);else{badge.textContent='不可访问';badge.dataset.quality='offline';delete badge.dataset.checkedAt;}
      }catch(error){if(latencyRun===active && !active.signal.aborted){badge.textContent=error.status===401?'登录已过期':'延迟未测得';badge.dataset.quality='warning';badge.removeAttribute('title');delete badge.dataset.checkedAt;}}
      finally{if(latencyRun===active){latencyRun=null;if(!stopped && !document.hidden && !authExpired)latencyTimer=setTimeout(refresh,5000);}}
    }
    void refresh();
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelHistory();closeLive();pauseLatency();}else{historyBlocked=false;connectLive();void requestSync();startLatency();scheduleHistory();}});
  const reconcileQuietState=()=>{if(!document.hidden && !stopped && !authExpired && chat)void requestSync();};
  let stateReconcileTimer=setInterval(reconcileQuietState,15000);
  window.addEventListener('pagehide',()=>{clearInterval(stateReconcileTimer);clearChannelWatch(false);stopped=true;cancelHistory();pauseLatency();closeLive();controller.abort();});
  window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;controller=new AbortController();stateReconcileTimer=setInterval(reconcileQuietState,15000);connectLive();void requestSync();startLatency();scheduleHistory();}});
  startLatency();
  (initial.chat?openChat(initial.chat):refreshList()).catch(errors);controls();
})();
</script>`;

