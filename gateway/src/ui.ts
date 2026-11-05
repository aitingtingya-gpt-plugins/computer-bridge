import {escape, type Data} from "./types";
import {accessPanel, accessStyles, workspaceFeedbackStyles, workspaceStatus} from './access_ui';
import {connectionBadge,connectionsScript} from './connections_ui';
import {updatesPanel,deviceUpdates,updatesScript,updateStyles} from './updates_ui';
import {accountNavigation,grantPanel} from './accounts_ui';

const monitor = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8m-4-5v5"/></svg>';
const laptop = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="3" width="14" height="13" rx="2"/><path d="m5 16-3 4h20l-3-4M9 20h6"/></svg>';

function lockModePanel(device:Data,nonce:string):string {
  const mode=device.lock_mode;
  const state:Record<string,string>={applied:'系统请求已应用',pending:device.online?'等待应用':'已保存，等待设备上线',
    failed:'应用失败',update_required:'请更新电脑端'};
  return `<section class="access-panel"><form method="post" class="access-toggle">
    <input type="hidden" name="csrf" value="${escape(nonce)}"><input type="hidden" name="id" value="${escape(device.id)}">
    <label><input type="checkbox" name="enabled" value="on" ${mode.enabled?'checked':''}>锁屏模式</label>
    <button class="apply-access" name="action" value="lock_mode">应用</button></form>
    <p class="field-note">${mode.enabled?'开启':'关闭'} · ${state[mode.state]}。开启时屏幕可熄灭，电脑不自动睡眠。</p>
    ${mode.interrupted?'<p class="notice warning">开启期间曾收到系统睡眠通知。最近唤醒：'+escape(mode.last_resume_at || '尚未唤醒')+'。</p>':''}
    ${mode.error?`<p class="notice error">${escape(mode.error)}</p>`:''}
    ${mode.limitation?`<p class="field-note">${escape(mode.limitation)}</p>`:''}</section>`;
}

export function devicesPage(computers: Data[], nonce: string, code: string, notice: string, error = "", view:Data={}): string {
  const administrator=view.actor.role==='admin';
  const online = computers.filter(d => d.online).length;
  const notices: Record<string, string> = {rename: "显示名称已更新，下次工具查询即生效。", approve: "电脑已注册。", remove: administrator?"设备已注销。":"设备已从我的列表移除。", grant:"用户授权已添加。", revoke:"用户授权已撤销。", access:"权限已保存。", workspace_save:"工作区已保存。", workspace_remove:"工作区已移除。",workspace_pending:"电脑离线，已保存，路径待核实。"};
  const updateView=view.updates || {source:{repository:'',channel:'stable'},server:{version:'',modules:[]},jobs:[]};
  const available=[...new Set<string>((updateView.catalogue?.releases || []).flatMap((r:Data)=>r.manifest.artifacts.map((a:Data)=>a.module).filter(Boolean)))];
  const cards = computers.map(d => `<details class="device-card" data-device="${escape(d.id)}"${view.device===d.id?" open":""}><summary>
    <div class="device-top"><span class="device-icon">${d.system === "Windows" ? monitor : laptop}</span>
      ${connectionBadge(d)}</div>
    <h2 class="device-name">${escape(d.name)}</h2><div class="device-meta"><code>${escape(d.id)}</code><span>${escape(d.system === "Darwin" ? "macOS" : d.system || "电脑")}</span></div>
    <a class="chat-device-link" href="/chat?device=${encodeURIComponent(d.id)}" onclick="event.stopPropagation()">打开聊天 ↗</a>
    ${d.access.workspaces.some((w:Data)=>workspaceStatus(w))?'<div class="field-note">工作区有待核实或异常路径</div>':''}
    </summary><div class="device-body"><div class="modules">${d.modules?.length ? d.modules.map((m: string) => `<span class="module-tag">${escape(m === "work-tree" ? "Work Tree" : m)}</span>`).join("") : '<span>文件与终端</span>'}</div>
    <div class="device-actions"><details class="rename"><summary>修改名称</summary><form method="post" class="rename-form">
      <input type="hidden" name="csrf" value="${nonce}"><input type="hidden" name="id" value="${escape(d.id)}">
      <label for="name-${d.id}">显示名称</label><input id="name-${d.id}" name="name" value="${escape(d.name)}" autocomplete="off">
<button name="action" value="rename">保存名称</button></form></details>
      <form method="post"><input type="hidden" name="csrf" value="${nonce}"><input type="hidden" name="id" value="${escape(d.id)}">
      <button class="text-button danger" name="action" value="remove">${administrator?"注销设备":"从我的列表移除"}</button></form></div>
    ${administrator?grantPanel(d,view.users || [],nonce):''}${deviceUpdates(d,available)}${lockModePanel(d,nonce)}${accessPanel(d,nonce,view)}</div></details>`).join("");
  return `
    ${accountNavigation(view.actor)}
    ${error && !computers.some(d=>d.id===view.device) ? `<p class="notice error" role="alert">${escape(error)}</p>` : ''}
    ${notices[notice] ? `<div class="notice" role="status">${notices[notice]}</div>` : ""}
    ${updatesPanel(updateView,nonce)}
    <div class="dashboard"><section class="devices-section" aria-labelledby="devices-title">
      <div class="section-heading"><h2 id="devices-title">已注册设备 <span class="count">${computers.length}</span></h2><span class="muted" data-online-count>${online} 台在线</span></div>
      <div class="device-grid">${cards || `<div class="empty-state">${monitor}<h3>连接第一台电脑</h3><p>在电脑上运行注册命令，再填写配对码。</p></div>`}</div></section>
      <aside class="pair-card"><h2>添加电脑</h2>
      <form method="post"><input type="hidden" name="csrf" value="${nonce}"><label for="pair-code">配对码</label>
      <input id="pair-code" class="pair-code" name="code" required value="${escape(code)}" placeholder="例如 A1B2C3D4" autocomplete="off" spellcheck="false">
      <button class="full-width" name="action" value="approve">注册这台电脑 <span aria-hidden="true">→</span></button></form>
</aside></div>
    <footer class="page-footer"><form method="post"><input type="hidden" name="csrf" value="${nonce}"><button class="text-button" name="action" value="logout">退出管理</button></form></footer>${connectionsScript}${updatesScript}`;
}

export const styles = accessStyles + workspaceFeedbackStyles + updateStyles + `
.connection-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.measure-connection{border:1px solid #a6c4ba;background:white;color:#286c59;padding:3px 9px;font-size:12px}.measure-connection:disabled{opacity:.65;cursor:wait}.status.degraded{background:#fff2da;color:#92600c}.notice.warning{background:#fff2da;color:#80570e}:root{color-scheme:light;--bg:#f5f6f8;--card:#fff;--ink:#1d2639;--muted:#758096;--line:#e6e9ef;--accent:#286c59;--hover:#205847;--soft:#eaf4ef}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--accent);text-decoration:none}button,input{font:inherit}button,summary{cursor:pointer}button{border:1px solid transparent;border-radius:9px;background:var(--accent);color:white;padding:10px 17px;font-weight:600;transition:background .15s}button:hover{background:var(--hover)}button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #a5cabb;outline-offset:3px}button[value=deny]{background:#eef0f4;color:var(--ink);margin-left:8px}
input{width:100%;min-width:0;border:1px solid #dce1e9;background:#fff;border-radius:9px;padding:11px 12px;color:var(--ink);outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px #286c5912}label{display:block;font-weight:600;margin:0 0 7px}code{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f0f2f6;padding:3px 7px;border-radius:5px;overflow-wrap:anywhere}
.topbar{height:76px;background:#ffffffd9;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 max(28px,calc((100vw - 1160px)/2));gap:24px}.brand{display:flex;align-items:center;gap:11px;font-size:17px;font-weight:700;letter-spacing:-.4px;color:var(--ink)}.brand-mark{display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:var(--accent);border-radius:9px;color:white}.brand-mark svg{width:21px;height:21px}.topbar .top-label{font-size:12px;color:var(--muted);letter-spacing:1px}
main{max-width:1216px;margin:48px auto;padding:0 28px}h1{font-size:30px;line-height:1.3;letter-spacing:-.8px;margin:0 0 10px;font-weight:700}h2{font-size:18px;line-height:1.4;margin:0}h3{font-size:17px}.subtitle{margin:0 0 34px;color:var(--muted)}.dashboard{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:30px;align-items:start}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px;gap:12px}.section-heading h2{font-size:16px}.count{margin-left:6px;font-size:12px;background:#e7ebf0;color:#647086;border-radius:12px;padding:2px 7px}.muted{color:var(--muted);font-size:13px}.device-grid{align-items:start;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.device-card{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:15px;padding:22px;box-shadow:0 3px 8px #1d263903}.device-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.device-icon{display:flex;align-items:center;justify-content:center;width:45px;height:45px;border:1px solid var(--line);background:#f8f9fb;border-radius:12px;color:#53627c}.device-icon svg{width:25px;height:25px}.status{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:3px 9px;font-size:12px;font-weight:600}.status i{width:6px;height:6px;border-radius:50%;background:currentColor}.online{color:#2d8164;background:#edf7f1}.offline{color:#8991a1;background:#f2f3f6}.device-name{font-size:19px;overflow-wrap:anywhere;min-height:27px;margin-bottom:9px}.device-meta{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px}.device-meta code{color:#5c677b}.modules{color:var(--muted);font-size:12px;margin:22px 0 19px;min-height:21px}.module-tag{background:var(--soft);color:var(--accent);border-radius:5px;padding:3px 7px;margin-right:5px}.device-actions{border-top:1px solid var(--line);padding-top:13px;display:flex;align-items:start;justify-content:space-between;gap:8px}.text-button{border:0;background:transparent;color:#67738a;padding:0;font-size:13px;font-weight:500}.text-button:hover{background:transparent;color:var(--accent)}.danger{color:#a46b6b}.danger:hover{color:#b44848}.rename{font-size:13px;min-width:0;flex:1}.rename summary{list-style:none;color:#52657c}.rename summary::-webkit-details-marker{display:none}.rename summary:hover{color:var(--accent)}.rename-form{padding:16px 0 2px}.rename-form input{font-size:13px}.rename-form button{font-size:12px;padding:7px 11px}.field-note{color:var(--muted);font-size:11px;line-height:1.6}.pair-card{background:white;border:1px solid var(--line);border-radius:15px;padding:25px;margin-top:39px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.6px;color:var(--accent)}.pair-card h2{font-size:21px;margin-top:8px}.pair-card>p{font-size:13px;color:var(--muted);margin:13px 0 23px}.pair-card label{font-size:12px}.pair-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1px}.pair-code::placeholder{font-family:inherit;letter-spacing:0;font-size:12px}.full-width{width:100%;display:flex;justify-content:space-between;align-items:center;margin-top:12px}.pair-note{border-top:1px solid var(--line);margin-top:24px;padding-top:17px;display:flex;gap:8px;align-items:start}.pair-note p{font-size:11px;line-height:1.8;color:var(--muted);margin:0}.note-dot{width:5px;height:5px;flex-shrink:0;border-radius:50%;background:#a4b5aa;margin-top:7px}.page-footer{border-top:1px solid var(--line);margin-top:37px;padding-top:19px;display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#8c94a4}.notice{border:1px solid #d2e6db;background:var(--soft);color:#286c59;border-radius:10px;padding:12px 16px;margin-bottom:25px;font-size:13px}.empty-state{grid-column:1/-1;background:#fff;border:1px dashed #dce1e9;border-radius:15px;text-align:center;padding:55px 20px;color:var(--muted)}.empty-state svg{width:35px;height:35px}.empty-state h3{color:var(--ink);margin:12px 0 0}.empty-state p{font-size:13px}.auth-card{max-width:440px;background:#fff;border:1px solid var(--line);border-radius:15px;padding:28px;margin-top:27px}.auth-card p{color:var(--muted);font-size:13px;margin:0 0 24px}.auth-card button{margin-top:16px}.auth-card input[type=password]{width:100%}.auth-details{margin:24px 0;color:var(--muted);font-size:14px}
.password-settings{border:1px solid var(--line);background:#fff;border-radius:13px;margin-top:28px}.password-settings>summary{display:flex;justify-content:space-between;align-items:center;gap:20px;list-style:none;padding:18px 22px;font-size:14px}.password-settings>summary::-webkit-details-marker{display:none}.settings-hint{display:block;color:var(--muted);font-size:12px;margin-top:3px}.settings-link{color:var(--accent);font-size:13px;white-space:nowrap}.password-content{padding:0 22px 20px;border-top:1px solid var(--line)}.password-content form{padding-top:18px;max-width:610px}.password-content label{font-size:13px}.password-controls{display:flex;gap:10px}.password-controls button{flex-shrink:0}.notice.error{background:#fff2ee;border-color:#f0d4ca;color:#ac5038}.password-content>.notice{margin:16px 0 0}
@media(max-width:1000px){.dashboard{grid-template-columns:minmax(0,1fr) 280px;gap:22px}.device-grid{grid-template-columns:1fr}}@media(max-width:700px){.topbar{height:64px;padding:0 20px}.topbar .top-label{display:none}main{margin:32px auto;padding:0 20px}h1{font-size:26px}.subtitle{font-size:13px;margin-bottom:26px}.dashboard{grid-template-columns:1fr}.device-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.device-card{padding:18px}.pair-card{margin-top:2px}.page-footer{flex-wrap:wrap}.auth-card{padding:22px}}@media(max-width:460px){.device-grid{grid-template-columns:1fr}.device-card{padding:22px}.password-controls{flex-direction:column}}
`;

export const cardStyles=`.device-card>summary{list-style:none;cursor:pointer;position:relative;padding-right:18px}.device-card>summary::-webkit-details-marker{display:none}.device-card>summary::after{content:"⌄";position:absolute;right:0;bottom:0;color:var(--muted);font-size:20px}.device-card[open]>summary::after{transform:rotate(180deg)}.device-card>summary .device-top{margin-bottom:12px}.device-body{margin-top:14px}`;
