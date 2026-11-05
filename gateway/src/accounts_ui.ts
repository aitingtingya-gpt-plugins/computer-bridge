import {escape, type Data} from './types';

export function accountNavigation(actor:Data):string {
  return `<nav class="account-navigation" aria-label="管理导航"><div class="account-identity"><strong title="${escape(actor.username)}">${escape(actor.username)}</strong> <code>${escape(actor.id)}</code> <span class="muted">${actor.role==='admin'?'管理员':'普通用户'}</span></div><div class="account-links"><a href="/manage">设备</a><a href="/chat">聊天</a><a href="/manage/profile">我的账号</a>${actor.role==='admin'?'<a href="/manage/accounts">账号管理</a>':''}</div></nav>`;
}

export function loginFields(username='admin'):string {
  return `<label for="login-username">用户名</label><input id="login-username" name="username" value="${escape(username)}" required autocomplete="username">
    <label for="login-password">密码</label><input id="login-password" name="password" type="password" required autocomplete="current-password">`;
}

export function grantPanel(device:Data,users:Data[],nonce:string):string {
  const grants:string[]=device.grants || [];
  const ordinary=users.filter(u=>u.role==='user');
  const hidden=`<input type="hidden" name="csrf" value="${escape(nonce)}"><input type="hidden" name="id" value="${escape(device.id)}">`;
  return `<section class="access-panel"><h3>用户授权</h3><div class="grant-list">${ordinary.filter(u=>grants.includes(u.id)).map(u=>`<form method="post" class="grant-row">${hidden}<input type="hidden" name="user_id" value="${escape(u.id)}"><span>${escape(u.username)} <code>${escape(u.id)}</code>${u.enabled?'':' · 已停用'}</span><button name="action" value="revoke" class="text-button danger">撤销授权</button></form>`).join('') || '<p class="field-note">仅管理员管理</p>'}</div>
    ${ordinary.some(u=>!grants.includes(u.id))?`<form method="post" class="grant-form">${hidden}<label>添加用户<select name="user_id">${ordinary.filter(u=>!grants.includes(u.id)).map(u=>`<option value="${escape(u.id)}">${escape(u.username)} · ${escape(u.id)}${u.enabled?'':' · 已停用'}</option>`).join('')}</select></label><button name="action" value="grant">授权</button></form>`:''}</section>`;
}

export function accountsPage(actor:Data,users:Data[],nonce:string,result?:Data,error=''):string {
  const credential=result?.initial_password;
  const hidden=`<input type="hidden" name="csrf" value="${escape(nonce)}">`;
  const packet=credential?`用户名：${result.user.username}\n用户 ID：${result.user.id}\n初始密码：${credential}`:'';
  return `${accountNavigation(actor)}${error?`<p class="notice error" role="alert">${escape(error)}</p>`:''}
    ${credential?`<section class="credential-card notice"><h2>账号已创建</h2><textarea id="initial-credential" readonly rows="3">${escape(packet)}</textarea><button type="button" id="copy-credential">复制账号信息</button><span id="copy-status" role="status"></span></section><script>document.getElementById('copy-credential').addEventListener('click',async()=>{await navigator.clipboard.writeText(document.getElementById('initial-credential').value);document.getElementById('copy-status').textContent='已复制';});</script>`:''}
    ${result && !credential?'<p class="notice" role="status">账号已更新。</p>':''}
    <div class="accounts-layout"><section class="account-list"><h2>普通用户 <span class="count">${users.filter(u=>u.role==='user').length}</span></h2>
    ${users.filter(u=>u.role==='user').map(user=>`<article class="account-card"><div class="section-heading"><h3>${escape(user.username)} <code>${escape(user.id)}</code></h3><span class="status ${user.enabled?'online':'offline'}">${user.enabled?'可用':'已停用'}</span></div>
      <form method="post" class="account-rename">${hidden}<input type="hidden" name="id" value="${escape(user.id)}"><label>用户名<input name="username" value="${escape(user.username)}" required autocomplete="off"></label><button name="action" value="update">保存</button></form>
      <details class="account-password"><summary>重置密码</summary><form method="post">${hidden}<input type="hidden" name="id" value="${escape(user.id)}"><label>新密码<input type="password" name="password" required minlength="6" autocomplete="new-password"></label><button name="action" value="password">重置密码</button></form></details>
      <div class="account-actions"><form method="post">${hidden}<input type="hidden" name="id" value="${escape(user.id)}"><button name="action" value="${user.enabled?'disable':'enable'}" class="secondary">${user.enabled?'停用账号':'恢复账号'}</button></form><form method="post">${hidden}<input type="hidden" name="id" value="${escape(user.id)}"><button name="action" value="delete" class="text-button danger">删除账号</button></form></div></article>`).join('') || '<p class="empty-state">尚未创建普通用户。</p>'}</section>
    <aside class="pair-card"><h2>创建账号</h2><form method="post">${hidden}<label>用户名<input name="username" required autocomplete="off"></label><label>初始密码<input type="password" name="password" minlength="6" autocomplete="new-password" placeholder="留空自动生成"></label><button name="action" value="create" class="full-width">创建账号</button></form></aside></div>`;
}

export function profilePage(actor:Data,nonce:string,error='',saved=false):string {
  return `${accountNavigation(actor)}${error?`<p class="notice error" role="alert">${escape(error)}</p>`:''}${saved?'<p class="notice" role="status">用户名已更新。</p>':''}<section class="auth-card"><form method="post"><input type="hidden" name="csrf" value="${escape(nonce)}"><label>用户 ID</label><p><code>${escape(actor.id)}</code></p><label>用户名<input name="username" value="${escape(actor.username)}" required autocomplete="username"></label><label>新密码<input name="password" type="password" minlength="6" autocomplete="new-password" placeholder="留空保持原密码"></label><p class="field-note">密码至少 6 位。修改密码后，当前登录和已有 GPT／Dot 授权失效，需要重新登录授权。</p><button>保存账号</button></form></section>`;
}

export const accountStyles=`.account-navigation{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:18px 0 28px;padding:12px 0;border-bottom:1px solid var(--line);font-size:13px}.account-navigation>div:last-child{display:flex;gap:18px}.accounts-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:30px;align-items:start}.account-list>h2{margin:0 0 18px}.account-card{background:white;border:1px solid var(--line);border-radius:15px;padding:24px;margin-bottom:18px}.account-card h3{margin:0}.account-rename,.grant-form{display:flex;gap:10px;align-items:end}.account-rename label,.grant-form label{flex:1;margin:0}.account-password{margin-top:18px}.account-password form{display:flex;gap:10px;align-items:end;margin:14px 0}.account-password label{flex:1;margin:0}.account-actions{display:flex;align-items:center;justify-content:space-between;margin-top:18px}.grant-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 0;font-size:12px}.grant-form{font-size:12px}.grant-form select{display:block;width:100%;margin-top:5px;padding:8px;font:inherit;background:white;border:1px solid var(--line);border-radius:8px}.grant-form button{padding:7px 12px}.credential-card textarea{display:block;width:100%;margin:14px 0;padding:12px;border:1px solid #bcd4c5;border-radius:8px;font:inherit;resize:none;background:white}.credential-card #copy-status{margin-left:12px}.auth-card input{margin-bottom:16px}.accounts-layout .pair-card{margin-top:0}.accounts-layout .pair-card label{margin-top:16px}@media(max-width:700px){.accounts-layout{grid-template-columns:1fr}.account-navigation{align-items:start;flex-wrap:wrap}.account-rename,.account-password form{flex-wrap:wrap}}`;
