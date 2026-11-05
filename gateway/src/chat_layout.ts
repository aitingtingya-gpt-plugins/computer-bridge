/** Chat-only viewport layout. Dimensions are local preferences, never conversation state. */
export const chatLayoutStyles=String.raw`
.chat-page{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.chat-page>.topbar{height:44px;flex-shrink:0;padding:0 20px;border:0;background:var(--bg)}
.chat-page .brand{font-size:14px;gap:8px}.chat-page .brand-mark{width:25px;height:25px;border-radius:7px}.chat-page .brand-mark svg{width:18px;height:18px}
.chat-page main{max-width:none;width:100%;flex:1;min-height:0;margin:0;padding:0 12px 12px;display:flex;flex-direction:column}
.chat-page main>h1{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.chat-page .account-navigation{flex-shrink:0;margin:0;padding:5px 8px 10px;border:0;min-height:36px;font-size:12px;gap:12px}
.chat-page .account-navigation>div:last-child{gap:18px}.chat-page .account-navigation .muted{font-size:12px}
.chat-page #chat-notice{flex-shrink:0;margin:0 0 8px;padding:8px 12px}
.chat-layout{--sidebar-width:280px;--compose-height:160px;display:grid;grid-template-columns:var(--sidebar-width) 8px minmax(0,1fr);position:relative;flex:1;min-height:0;min-width:0;overflow:hidden;background:white;border:1px solid var(--line);border-radius:12px}
.chat-sidebar{min-width:0;min-height:0;padding:14px;background:#f8faf9;overflow:auto;overscroll-behavior:contain}
.chat-sidebar-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.chat-sidebar-heading label{font-size:12px;color:var(--muted);margin:0}
.chat-icon-button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:30px;height:30px;padding:0;background:transparent;border:1px solid var(--line);color:var(--accent);font-size:22px;line-height:1;border-radius:7px}.chat-icon-button:hover{background:var(--soft);color:var(--accent)}
.chat-thread{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.chat-thread-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);flex-shrink:0}
.chat-thread-title{display:flex;align-items:center;gap:12px;min-width:0}.chat-thread-title>div{min-width:0}.chat-thread-title .muted{font-size:12px}
.chat-thread-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}.chat-thread-actions>button{font-size:12px;padding:7px 10px;white-space:nowrap}
.chat-connection{display:flex;align-items:center;justify-content:space-between;padding:6px 20px;background:#fcfdfc;gap:12px;font-size:12px;border-bottom:1px solid var(--line);flex-shrink:0}.chat-connection .muted{font-size:11px}
.chat-messages{flex:1;overflow:auto;min-height:0;padding:20px;overscroll-behavior:contain;overflow-anchor:none}
.chat-message{width:fit-content;max-width:94%}.chat-message-body{line-height:1.7}
.chat-compose{height:var(--compose-height);flex:0 0 var(--compose-height);min-height:0;padding:8px 20px 12px;display:flex;flex-direction:column;gap:8px}
.chat-compose textarea{width:100%;flex:1;min-height:30px;height:0;resize:none;padding:4px 0;border:0;background:transparent;outline:none;color:var(--ink);font:inherit;font-size:14px;line-height:1.7}
.chat-compose-actions{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px}.chat-compose-actions>div{display:flex;align-items:center;gap:10px;min-width:0}.chat-compose-actions button{padding:7px 13px;font-size:13px;white-space:nowrap}
.chat-attachments{max-height:35%;overflow:auto;flex-shrink:0}.chat-attachments:empty{display:none}.chat-compose #chat-upload-status{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-resize{position:relative;touch-action:none;user-select:none;flex-shrink:0;background:#fafcfb;outline-offset:-2px}
.chat-resize::after{content:'';position:absolute;background:#dce6e0;border-radius:4px;transition:background .15s}
.chat-resize:hover::after,.chat-resize:focus-visible::after,.chat-resize[data-dragging]::after{background:var(--accent)}
.chat-resize:focus-visible{outline:2px solid #a5cabb}.chat-resize-side{cursor:col-resize;border-inline:1px solid var(--line)}.chat-resize-side::after{width:2px;height:32px;top:calc(50% - 16px);left:2px}
.chat-resize-compose{height:8px;cursor:row-resize;border-block:1px solid var(--line)}.chat-resize-compose::after{height:2px;width:36px;left:calc(50% - 18px);top:2px}
.chat-layout[data-collapsed=true]{grid-template-columns:minmax(0,1fr)}
.chat-layout[data-collapsed=true]>.chat-sidebar,.chat-layout[data-collapsed=true]>.chat-resize-side{display:none}
.chat-layout[data-collapsed=false] #chat-sidebar-open{display:none}
.chat-sidebar-backdrop{position:absolute;inset:0;z-index:3;background:#163b3640;border:0;border-radius:0;padding:0}.chat-sidebar-backdrop:hover{background:#163b3640}
.chat-resume button{white-space:nowrap;flex-shrink:0}.chat-list-heading{margin-top:20px}
@media(max-width:760px){
 .chat-page>.topbar{height:38px;padding:0 12px}.chat-page main{padding:0 6px 6px}.chat-page .account-navigation{padding:3px 4px 8px;gap:5px;align-items:center}.chat-page .account-navigation>div:last-child{gap:12px}.chat-page .account-navigation .muted{display:none}
 .chat-layout,.chat-layout[data-collapsed=false]{grid-template-columns:minmax(0,1fr);border-radius:9px}.chat-layout>.chat-resize-side{display:none}
 .chat-layout>.chat-sidebar{display:none;position:absolute;z-index:4;top:0;bottom:0;left:0;width:min(320px,calc(100% - 48px));box-shadow:8px 0 32px #163b3620}
 .chat-layout[data-drawer=true]>.chat-sidebar{display:block}.chat-layout #chat-sidebar-open{display:inline-flex}
 .chat-thread-header{padding:10px 12px;gap:8px;flex-wrap:wrap}.chat-thread-title{gap:8px;flex:1}.chat-heading{font-size:16px}.chat-thread-actions{gap:6px}.chat-thread-actions>button{padding:6px 8px;font-size:11px}
 .chat-connection{padding:5px 12px}.chat-connection #chat-refresh{display:none}.chat-messages{padding:14px 12px}.chat-message{max-width:100%}.chat-compose{padding:6px 12px 10px}
}
`;

export const chatLayoutScript=String.raw`<script>
(()=>{
 const $=id=>document.getElementById(id),layout=document.querySelector('.chat-layout'),sidebar=$('chat-sidebar'),messages=$('chat-messages'),composer=$('chat-compose');
 const open=$('chat-sidebar-open'),close=$('chat-sidebar-close'),backdrop=$('chat-sidebar-backdrop'),sideHandle=$('chat-sidebar-resize'),composeHandle=$('chat-compose-resize');
 const initial=JSON.parse($('chat-initial').textContent),key='computer-bridge:chat-layout:'+initial.account_id;
 const narrow=matchMedia('(max-width:760px)'),defaults={width:280,height:160,collapsed:false};
 let prefs={...defaults},drawer=false,reading=null,restoring=false,frame=0;
 try{const stored=JSON.parse(localStorage.getItem(key));if(stored){prefs.width=Number(stored.width)||280;prefs.height=Number(stored.height)||160;prefs.collapsed=stored.collapsed===true;}}catch{}
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function save(){try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}}
 function remember(){
  const box=messages.getBoundingClientRect(),node=Array.from(messages.querySelectorAll('.chat-message')).find(n=>n.getBoundingClientRect().bottom>box.top);
  reading={bottom:messages.scrollHeight-messages.scrollTop-messages.clientHeight<4,id:node?.dataset.id,offset:node?node.getBoundingClientRect().top-box.top:0,top:messages.scrollTop};
 }
 function restore(anchor){
  if(!anchor)return;
  if(anchor.bottom)messages.scrollTop=messages.scrollHeight;
  else{const node=Array.from(messages.querySelectorAll('.chat-message')).find(n=>n.dataset.id===anchor.id);messages.scrollTop=node?messages.scrollTop+node.getBoundingClientRect().top-messages.getBoundingClientRect().top-anchor.offset:anchor.top;}
 }
 function apply(){
  const anchor=reading;restoring=true;
  const width=clamp(prefs.width,200,Math.min(480,layout.clientWidth-368));
  layout.style.setProperty('--sidebar-width',width+'px');layout.dataset.collapsed=String(prefs.collapsed);layout.dataset.drawer=String(drawer&&narrow.matches);
  sidebar.inert=narrow.matches?!drawer:prefs.collapsed;sidebar.setAttribute('aria-hidden',String(sidebar.inert));
  backdrop.hidden=!narrow.matches||!drawer;open.setAttribute('aria-expanded',String(!sidebar.inert));
  const thread=document.querySelector('.chat-thread');
  const fixed=thread.querySelector('.chat-thread-header').offsetHeight+thread.querySelector('.chat-connection').offsetHeight+composeHandle.offsetHeight;
  const attached=$('chat-attachments'),style=getComputedStyle(composer),hasAttachments=attached.childElementCount>0;
  const minHeight=Math.ceil(parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+30+composer.querySelector('.chat-compose-actions').offsetHeight+parseFloat(style.gap)*(hasAttachments?2:1)+(hasAttachments?Math.min(attached.scrollHeight,64):0));
  const maxHeight=Math.max(minHeight,Math.min(thread.clientHeight*.6,thread.clientHeight-fixed-120));
  const height=clamp(prefs.height,minHeight,maxHeight);layout.style.setProperty('--compose-height',height+'px');
  for(const [handle,value,min,max] of [[sideHandle,width,200,Math.min(480,layout.clientWidth-368)],[composeHandle,height,minHeight,maxHeight]]){
   handle.setAttribute('aria-valuenow',Math.round(value));handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',Math.round(Math.max(min,max)));
  }
  cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{restore(anchor);restoring=false;remember();});
 }
 messages.addEventListener('scroll',()=>{if(!restoring)remember();},{passive:true});
 function toggle(show){remember();if(narrow.matches)drawer=show;else{prefs.collapsed=!show;save();}apply();if(show&&narrow.matches)close.focus();else if(!show)open.focus();}
 open.addEventListener('click',()=>toggle(true));close.addEventListener('click',()=>toggle(false));backdrop.addEventListener('click',()=>toggle(false));
 sidebar.addEventListener('keydown',event=>{
  if(!narrow.matches||!drawer)return;
  if(event.key==='Escape'){event.preventDefault();toggle(false);}
  if(event.key==='Tab'){const items=Array.from(sidebar.querySelectorAll('button,input,select,a[href]')).filter(n=>!n.disabled&&n.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 });
 sidebar.addEventListener('click',event=>{if(narrow.matches&&event.target.closest('[data-chat-id]'))toggle(false);});
 function resize(handle,field,axis,direction){
  let drag=null;
  function set(value){prefs[field]=clamp(value,Number(handle.getAttribute('aria-valuemin')),Number(handle.getAttribute('aria-valuemax')));apply();}
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();remember();handle.focus();drag={position:event[axis],size:Number(handle.getAttribute('aria-valuenow'))};handle.setPointerCapture(event.pointerId);handle.dataset.dragging='true';});
  handle.addEventListener('pointermove',event=>{if(drag)set(drag.size+(event[axis]-drag.position)*direction);});
  function finish(){if(drag){drag=null;delete handle.dataset.dragging;save();}}
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
  handle.addEventListener('dblclick',()=>{remember();prefs[field]=defaults[field];apply();save();});
  handle.addEventListener('keydown',event=>{const delta=field==='width'?{ArrowLeft:-10,ArrowRight:10}:{ArrowDown:-10,ArrowUp:10};if(event.key in delta){event.preventDefault();remember();set(Number(handle.getAttribute('aria-valuenow'))+delta[event.key]);save();}else if(event.key==='Home'){event.preventDefault();remember();prefs[field]=defaults[field];apply();save();}});
 }
 resize(sideHandle,'width','clientX',1);resize(composeHandle,'height','clientY',-1);
 narrow.addEventListener('change',()=>{drawer=false;apply();});
 const observed=[layout,document.querySelector('.chat-thread-header'),document.querySelector('.chat-connection'),$('chat-attachments')];
 const observer=new ResizeObserver(apply);for(const node of observed)observer.observe(node);
 window.addEventListener('pagehide',()=>{observer.disconnect();cancelAnimationFrame(frame);});
 window.addEventListener('pageshow',event=>{if(event.persisted){for(const node of observed)observer.observe(node);apply();}});
 remember();apply();
})();
</script>`;
