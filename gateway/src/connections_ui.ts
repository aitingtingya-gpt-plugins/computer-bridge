import {escape,type Data} from './types';

export type ConnectionTone='good'|'warning'|'poor'|'offline';

/** Device RTT quality is separate from the chat/model connection state. */
export function connectionTone(device:Data):ConnectionTone {
  if(device.connection_state==='recovering' || device.connection_state==='degraded')return 'warning';
  if(device.online===false || device.connection_state==='offline')return 'offline';
  if(device.online!==true || device.latency_state!=='ok' || typeof device.latency_ms!=='number' || !Number.isFinite(device.latency_ms))return 'warning';
  return device.latency_ms<200?'good':device.latency_ms<500?'warning':'poor';
}

export function connectionLabel(device:Data):string {
  if(device.connection_state==='recovering') return '恢复中';
  if(device.online===false || device.connection_state==='offline') return '离线';
  if(device.online!==true)return '状态未知';
  if(device.latency_state==='ok' && typeof device.latency_ms==='number' && Number.isFinite(device.latency_ms)) return `在线 · ${device.latency_ms<1?'<1':device.latency_ms} ms`;
  return device.latency_state==='timeout'?'在线 · 探测超时':'在线 · 延迟未测得';
}

export function connectionBadge(device:Data):string {
  return `<span class="connection-controls"><span data-connection="${escape(device.id)}" class="status connection-quality" data-quality="${connectionTone(device)}" data-checked-at="${escape(device.latency_checked_at || '')}"
    title="服务端与电脑的连接往返延迟"><i></i><span>${escape(connectionLabel(device))}</span></span><button type="button" class="measure-connection" data-measure="${escape(device.id)}">测速</button></span>`;
}

export const connectionStyles=`
.connection-quality[data-quality=good]{color:#2d8164}.connection-quality[data-quality=warning]{color:#92600c}.connection-quality[data-quality=poor]{color:#b4473c}.connection-quality[data-quality=offline]{color:#8991a1}
.status.connection-quality[data-quality=good]{background:#edf7f1}.status.connection-quality[data-quality=warning]{background:#fff2da}.status.connection-quality[data-quality=poor]{background:#fff0ed}.status.connection-quality[data-quality=offline]{background:#f2f3f6}
`;

/** Share the same classification and labels with each browser view. */
export const connectionPresentationScript=`<script>
(()=>{
  const tone=${connectionTone.toString()},label=${connectionLabel.toString()};
  function render(node,d){
    if(node.dataset.checkedAt && d.latency_checked_at && node.dataset.checkedAt>d.latency_checked_at)return;
    node.classList.add('connection-quality');node.dataset.quality=tone(d);
    const text=node.querySelector('span') || node;text.textContent=label(d);
    if(d.latency_checked_at)node.dataset.checkedAt=d.latency_checked_at;
    node.title='服务端与电脑的连接往返延迟'+(d.latency_checked_at?' · 最近检测 '+new Date(d.latency_checked_at).toLocaleTimeString():'');
  }
  window.bridgeConnection={tone,label,render};
})();
</script>`;

/** Refresh only connection text. No card replacement, form writes or background-page polling. */
export const connectionsScript=connectionPresentationScript+`<script>
(()=>{
  let timer=null,request=null,stopped=false;const manual=new Map();
  const render=window.bridgeConnection.render;
  function unavailable(text){
    document.querySelectorAll('[data-connection]').forEach(node=>{
      node.dataset.quality='warning';node.querySelector('span').textContent=text;
    });
  }
  document.querySelectorAll('[data-measure]').forEach(button=>button.addEventListener('click',async event=>{
    event.preventDefault();event.stopPropagation();
    const id=button.dataset.measure;if(manual.has(id)||stopped)return;
    const active=new AbortController();manual.set(id,active);button.disabled=true;button.textContent='测速中';
    const node=button.parentElement.querySelector('[data-connection]');
    try{
      const reply=await fetch('/manage/connections?device_id='+encodeURIComponent(id)+'&force=1',
        {signal:active.signal,cache:'no-store'});
      if(!reply.ok)throw new Error(reply.status===401?'登录已过期':'测速失败');
      const data=await reply.json();if(!active.signal.aborted && !document.hidden)render(node,data.computers[0]);
    }catch(error){if(!active.signal.aborted){node.dataset.quality='warning';node.querySelector('span').textContent=error.message;}}
    finally{manual.delete(id);button.disabled=false;button.textContent='测速';}
  }));
  async function update(){
    if(stopped||document.hidden||request)return;
    const active=new AbortController();request=active;
    try{
      const reply=await fetch('/manage/connections',{signal:active.signal,cache:'no-store'});
      if(!reply.ok){
        if(reply.status===401){stop();unavailable('登录已过期');return;}
        throw new Error('Connection status unavailable');
      }
      const data=await reply.json();
      if(stopped||document.hidden||request!==active)return;
      const devices=new Map(data.computers.map(d=>[d.id,d]));
      document.querySelectorAll('[data-connection]').forEach(node=>{
        const d=devices.get(node.dataset.connection);
        if(!d)return;
        if(manual.has(d.id))return;
        render(node,d);
      });
      const count=document.querySelector('[data-online-count]');
      if(count)count.textContent=data.computers.filter(d=>d.online).length+' 台在线';
    }catch(error){
      if(!active.signal.aborted)unavailable('状态更新失败');
    }finally{if(request===active)request=null;}
  }
  function pause(){for(const active of manual.values())active.abort();clearInterval(timer);timer=null;if(request){request.abort();request=null;}}
  function start(){if(stopped||document.hidden)return;update();timer=setInterval(update,5000);}
  function stop(){stopped=true;pause();}
  document.addEventListener('visibilitychange',()=>{pause();if(!document.hidden)start();});
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;start();}});
  start();
})();
</script>`;
