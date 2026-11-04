import {escape, type Data} from './types';

export function workspaceStatus(w:Data):string {
  const checks=w.validation;
  if(!checks) return '';
  if(checks.main.state==='pending') return '<span class="workspace-state">待核实</span>';
  if(checks.main.state!=='valid') return '<span class="workspace-state error">主路径异常</span>';
  const bad=checks.additional.filter((p:Data)=>!['valid','pending'].includes(p.state)).length;
  if(bad) return `<span class="workspace-state error">${bad} 个子路径异常</span>`;
  if(checks.additional.some((p:Data)=>p.state==='pending')) return '<span class="workspace-state">待核实</span>';
  return '';
}

export function accessPanel(device: Data, nonce: string, view:Data={}): string {
  const access=device.access;
  const active=view.device===device.id;
  const draft=active ? view.draft : undefined;
  const hidden=`<input type="hidden" name="csrf" value="${escape(nonce)}"><input type="hidden" name="id" value="${escape(device.id)}">`;
  const fields=(w:Data) => `<input type="hidden" name="workspace_id" value="${escape(w.id || '')}">
    <label>名称<input name="workspace_name" value="${escape(w.name || '')}" required></label>
    <label>主工作区路径<input name="workspace_path" value="${escape(w.path || '')}" required></label>
    <label>子工作区路径<textarea name="additional" rows="3" placeholder="每行一个绝对路径">${escape((w.additional || []).join('\n'))}</textarea></label>`;
  const editor=(original:Data={}) => {
    const w=draft && (draft.id || '')===(original.id || '') ? draft : original;
    return `<form method="post" class="workspace-form">${hidden}${fields(w)}<button name="action" value="workspace_save">保存工作区</button></form>`;
  };
  const check=(c:Data|undefined) => c && c.state!=='valid'
    ? `<p class="path-status ${c.state==='pending'?'pending':'error'}"><code>${escape(c.path)}</code> · ${c.state==='pending'?'待核实':escape(c.error || '路径异常')}</p>` : '';
  let confirmation='';
  if(active && view.confirmation) {
    confirmation=`<section class="creation-confirmation" role="alert"><h3>以下目录不存在，是否创建？</h3>
      <ul>${view.confirmation.missing.map((p:string)=>`<li><code>${escape(p)}</code></li>`).join('')}</ul>
      <form method="post" class="workspace-form">${hidden}${fields(draft)}<input type="hidden" name="create_missing" value="on">
      <div class="confirmation-actions"><button name="action" value="workspace_save">创建并保存</button><button class="secondary" name="action" value="workspace_cancel" formnovalidate>取消保存</button></div></form></section>`;
  }
  return `<section class="access-panel"><h3>权限与工作区</h3>
    ${active && view.error?`<p class="notice error" role="alert">${escape(view.error)}</p>`:''}
    ${confirmation}
    <form method="post" class="access-toggle">${hidden}<label><input type="checkbox" name="full_access" value="on" ${access.full_access?'checked':''}>完全访问</label>
    <button class="apply-access" name="action" value="access">应用权限</button></form>
    <p class="field-note">${access.full_access?'完全访问已开启。':'写入范围为所选工作区、子工作区及运行所需的临时目录。'}</p>
    ${device.access_error?`<p class="notice error">${escape(device.access_error)}</p>`:''}
    ${device.access_applied !== access.revision?'<p class="field-note">等待电脑应用配置</p>':''}
    <div class="workspace-list">${access.workspaces.map((w:Data)=>`<details class="workspace"${draft?.id===w.id?' open':''}><summary><strong>${escape(w.name)}</strong> <code>${escape(w.id)}</code>${workspaceStatus(w)}<span>${w.additional.length} 个子工作区</span></summary>
      ${check(w.validation?.main)}${(w.validation?.additional || []).map(check).join('')}
      ${editor(w)}<form method="post">${hidden}<input type="hidden" name="workspace_id" value="${escape(w.id)}"><button class="text-button danger" name="action" value="workspace_remove">移除工作区</button></form></details>`).join('')}</div>
    <details class="workspace"${draft && !draft.id?' open':''}><summary>＋ 添加工作区</summary>${editor()}</details></section>`;
}

export const accessStyles=`.access-panel{border-top:1px solid var(--line);margin-top:20px;padding-top:14px}.access-panel h3{font-size:14px;margin:0 0 12px}.access-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px}.access-toggle label{display:flex;gap:8px;align-items:center;font-size:13px}.access-toggle input{width:auto}.workspace{border:1px solid var(--line);border-radius:9px;margin-top:10px;padding:10px}.workspace summary{cursor:pointer;font-size:12px;overflow-wrap:anywhere}.workspace summary span{display:block;color:var(--muted);margin-top:5px}.workspace-form{display:grid;gap:10px;margin-top:14px}.workspace-form label{display:grid;gap:5px;font-size:12px}.workspace-form input,.workspace-form textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--line);border-radius:7px;padding:9px;font:inherit}.workspace-form textarea{resize:vertical}.workspace-form button{justify-self:start}.workspace-list{max-width:100%}`;

export const workspaceFeedbackStyles=`.apply-access{border:1px solid var(--accent);background:var(--accent);color:white;padding:7px 12px;border-radius:7px}.path-status{font-size:12px;overflow-wrap:anywhere}.path-status.error{color:#ac5038}.path-status.pending{color:var(--muted)}.creation-confirmation{border:1px solid #dcc593;background:#fff9ed;padding:14px;border-radius:9px;margin-bottom:16px}.creation-confirmation h3{margin:0}.confirmation-actions{display:flex;gap:10px;flex-wrap:wrap}.secondary{background:#edf0f4;color:var(--ink)}`;
