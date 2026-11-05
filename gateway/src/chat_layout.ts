import {compactMedia} from './mobile_ui';

/** Viewport dimensions are local preferences, never conversation state. */
export const chatLayoutStyles=String.raw`
.management-page{min-height:100dvh;display:flex;flex-direction:column}
.management-page>.topbar{height:44px;flex-shrink:0;padding:0 20px;border:0;background:var(--bg)}
.management-page .brand{font-size:14px;gap:8px}.management-page .brand-mark{width:25px;height:25px;border-radius:7px}.management-page .brand-mark svg{width:18px;height:18px}
.management-page main{max-width:none;width:100%;flex:1;margin:0;padding:0 12px 12px;display:flex;flex-direction:column;min-width:0}
.management-page main>h1{font-size:24px;margin:12px 8px 18px}.management-page main>.auth-card{width:100%;align-self:flex-start;margin:8px 0 0}
.management-page .account-navigation{flex-shrink:0;margin:0;padding:5px 8px 10px;border:0;min-height:36px;font-size:12px;gap:12px}
.management-page .account-navigation>div:last-child{gap:18px}.management-page .account-navigation .muted{font-size:12px}
.chat-page{height:100dvh;overflow:hidden}.chat-page main{min-height:0}
.chat-page main>h1{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);margin:0}
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
@media ${compactMedia}{
 .chat-page{position:fixed;top:var(--chat-visible-top,0px);left:0;right:0;min-height:0;height:var(--chat-visible-height,100dvh)}
 .chat-page[data-keyboard=true]>.topbar,.chat-page[data-keyboard=true] .account-navigation{display:none}
 .chat-page[data-keyboard=true] .chat-compose{padding-block:4px}
 .chat-page #chat-notice{max-height:18dvh;overflow:auto}
 .chat-layout,.chat-layout[data-collapsed=false]{grid-template-columns:minmax(0,1fr);border-radius:9px}.chat-layout>.chat-resize-side{display:none}
 .chat-layout>.chat-sidebar{display:none;position:absolute;z-index:4;top:0;bottom:0;left:0;width:min(320px,calc(100% - 48px));box-shadow:8px 0 32px #163b3620}
 .chat-layout[data-drawer=true]>.chat-sidebar{display:block}.chat-layout #chat-sidebar-open,.chat-layout[data-collapsed=false] #chat-sidebar-open{display:inline-flex}
 .chat-icon-button{width:44px;height:44px}.chat-thread-header{padding:6px 10px;gap:6px;flex-wrap:nowrap}.chat-thread-title{gap:6px;flex:1;overflow:hidden}.chat-heading{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-thread-title .muted{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .chat-thread-actions{gap:4px}.chat-thread-actions>button{padding:6px 8px;font-size:11px}.chat-thread-actions summary{display:flex;align-items:center;justify-content:center}
 .chat-connection{padding:3px 10px;min-height:26px}.chat-connection #chat-refresh{display:none}.chat-messages{padding:12px 10px}.chat-message{max-width:100%}.chat-compose{padding:6px 10px 8px;gap:6px}.chat-compose textarea{line-height:1.5}
 .chat-compose-actions{gap:8px}.chat-compose-actions>div{gap:6px}.chat-compose-actions button{min-height:44px}.chat-compose #chat-upload-status{max-width:100px}
 .chat-attachments{max-height:var(--chat-attachment-height,64px)}
 .chat-resize-compose{height:12px}.chat-resize-compose::after{top:4px}.chat-sidebar-heading label{font-size:14px}.chat-resume button,.chat-list-heading button{min-height:44px}
 .chat-sidebar-backdrop{min-width:0;min-height:0}
}
`;

export const chatLayoutScript=String.raw`<script>
(()=>{
 const $=id=>document.getElementById(id),layout=document.querySelector('.chat-layout'),sidebar=$('chat-sidebar'),messages=$('chat-messages'),composer=$('chat-compose'),thread=document.querySelector('.chat-thread');
 const open=$('chat-sidebar-open'),close=$('chat-sidebar-close'),backdrop=$('chat-sidebar-backdrop'),sideHandle=$('chat-sidebar-resize'),composeHandle=$('chat-compose-resize');
 const initial=JSON.parse($('chat-initial').textContent),key='computer-bridge:chat-layout:'+initial.account_id;
 const narrow=matchMedia(${JSON.stringify(compactMedia)}),viewport=window.visualViewport,defaults={width:280,height:160,mobileHeight:120,collapsed:false};
 let prefs={...defaults},drawer=false,reading=null,restoring=false,applyFrame=0,restoreFrame=0,scrollFrame=0,stopped=false;
 try{const stored=JSON.parse(localStorage.getItem(key));if(stored){prefs.width=Number(stored.width)||280;prefs.height=Number(stored.height)||160;prefs.mobileHeight=Number(stored.mobileHeight)||120;prefs.collapsed=stored.collapsed===true;}}catch{}
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function save(){try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}}
 function remember(){
  const nodes=window.bridgeChatView.nodes(),top=messages.getBoundingClientRect().top;let low=0,high=nodes.length;
  while(low<high){const mid=(low+high)>>1;if(nodes[mid].getBoundingClientRect().bottom<=top)low=mid+1;else high=mid;}
  const node=nodes[low];reading={bottom:messages.scrollHeight-messages.scrollTop-messages.clientHeight<4,id:node?.dataset.id,offset:node?node.getBoundingClientRect().top-top:0,top:messages.scrollTop,generation:window.bridgeChatView.generation()};return reading;
 }
 function restore(anchor){
  if(!anchor||anchor.generation!==window.bridgeChatView.generation())return;
  if(anchor.bottom)messages.scrollTop=messages.scrollHeight;
  else{const node=window.bridgeChatView.byId(anchor.id);messages.scrollTop=node?messages.scrollTop+node.getBoundingClientRect().top-messages.getBoundingClientRect().top-anchor.offset:anchor.top;}
 }
 window.bridgeChatLayout={capture:remember,restore,isCompact:()=>narrow.matches};
 function attr(node,name,value){value=String(value);if(node.getAttribute(name)!==value)node.setAttribute(name,value);}
 function style(name,value){if(layout.style.getPropertyValue(name)!==value)layout.style.setProperty(name,value);}
 function apply(){
  applyFrame=0;if(stopped)return;const anchor=reading;restoring=true;
  if(narrow.matches&&viewport&&Math.abs(viewport.scale-1)>=.01){restoring=false;return;}
  // Read geometry before changing widths/heights. A wrapped header triggers the next observer frame.
  const compact=narrow.matches,editable=document.activeElement?.matches('input,textarea,[contenteditable=true]');
  const visibleHeight=viewport?.height || innerHeight;
  const keyboard=compact&&editable&&(visibleHeight<innerHeight-80||visibleHeight<420);
  const maxWidth=Math.max(200,Math.min(480,layout.clientWidth-368)),width=clamp(prefs.width,200,maxWidth);
  const fixed=thread.querySelector('.chat-thread-header').offsetHeight+thread.querySelector('.chat-connection').offsetHeight+composeHandle.offsetHeight;
  const attached=$('chat-attachments'),computed=getComputedStyle(composer),hasAttachments=attached.childElementCount>0;
  const attachmentHeight=compact?Math.min(64,Math.max(30,(thread.clientHeight-fixed)*.2)):64;
  const minHeight=Math.ceil(parseFloat(computed.paddingTop)+parseFloat(computed.paddingBottom)+30+composer.querySelector('.chat-compose-actions').offsetHeight+parseFloat(computed.gap)*(hasAttachments?2:1)+(hasAttachments?Math.min(attached.scrollHeight,attachmentHeight):0));
  const readingRoom=compact?Math.min(96,Math.max(24,thread.clientHeight-fixed-minHeight)):120;
  const maxHeight=Math.max(minHeight,Math.min(thread.clientHeight*.6,thread.clientHeight-fixed-readingRoom)),height=clamp(compact?prefs.mobileHeight:prefs.height,minHeight,maxHeight);
  if(!viewport||Math.abs(viewport.scale-1)<.01){for(const [name,value] of [['--chat-visible-height',compact?visibleHeight+'px':''],['--chat-visible-top',compact?(viewport?.offsetTop || 0)+'px':'']])if(document.body.style.getPropertyValue(name)!==value)document.body.style.setProperty(name,value);}
  attr(document.body,'data-keyboard',!!keyboard);
  style('--chat-attachment-height',attachmentHeight+'px');
  style('--sidebar-width',width+'px');style('--compose-height',height+'px');attr(layout,'data-collapsed',prefs.collapsed);attr(layout,'data-drawer',drawer&&narrow.matches);
  const inert=narrow.matches?!drawer:prefs.collapsed;if(sidebar.inert!==inert)sidebar.inert=inert;attr(sidebar,'aria-hidden',inert);backdrop.hidden=!narrow.matches||!drawer;attr(open,'aria-expanded',!inert);
  for(const [handle,value,min,max] of [[sideHandle,width,200,maxWidth],[composeHandle,height,minHeight,maxHeight]]){attr(handle,'aria-valuenow',Math.round(value));attr(handle,'aria-valuemin',min);attr(handle,'aria-valuemax',Math.round(max));}
  cancelAnimationFrame(restoreFrame);restoreFrame=requestAnimationFrame(()=>{restoreFrame=0;restore(anchor);restoring=false;remember();});
 }
 function schedule(){if(!stopped&&!applyFrame)applyFrame=requestAnimationFrame(apply);}
 messages.addEventListener('scroll',()=>{if(!restoring&&!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;if(!restoring)remember();});},{passive:true});
 function toggle(show){remember();if(narrow.matches)drawer=show;else{prefs.collapsed=!show;save();}schedule();if(show&&narrow.matches)requestAnimationFrame(()=>close.focus({preventScroll:true}));else if(!show)requestAnimationFrame(()=>open.focus({preventScroll:true}));}
 open.addEventListener('click',()=>toggle(true));close.addEventListener('click',()=>toggle(false));backdrop.addEventListener('click',()=>toggle(false));
 sidebar.addEventListener('keydown',event=>{
  if(!narrow.matches||!drawer)return;
  if(event.key==='Escape'){event.preventDefault();toggle(false);}
  if(event.key==='Tab'){const items=Array.from(sidebar.querySelectorAll('button,input,select,a[href]')).filter(n=>!n.disabled&&n.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 });
 sidebar.addEventListener('click',event=>{if(narrow.matches&&event.target.closest('[data-chat-id]'))toggle(false);});
 function resize(handle,field,axis,direction){
  let drag=null;
  const preference=()=>field==='height'&&narrow.matches?'mobileHeight':field;
  function set(value){prefs[preference()]=clamp(value,Number(handle.getAttribute('aria-valuemin')),Number(handle.getAttribute('aria-valuemax')));schedule();}
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();remember();handle.focus();drag={position:event[axis],size:Number(handle.getAttribute('aria-valuenow'))};handle.setPointerCapture(event.pointerId);handle.dataset.dragging='true';});
  handle.addEventListener('pointermove',event=>{if(drag)set(drag.size+(event[axis]-drag.position)*direction);});
  function finish(){if(drag){drag=null;delete handle.dataset.dragging;save();}}
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
  handle.addEventListener('dblclick',()=>{remember();const name=preference();prefs[name]=defaults[name];schedule();save();});
  handle.addEventListener('keydown',event=>{const delta=field==='width'?{ArrowLeft:-10,ArrowRight:10}:{ArrowDown:-10,ArrowUp:10};if(event.key in delta){event.preventDefault();remember();set(Number(handle.getAttribute('aria-valuenow'))+delta[event.key]);save();}else if(event.key==='Home'){event.preventDefault();remember();const name=preference();prefs[name]=defaults[name];schedule();save();}});
 }
 resize(sideHandle,'width','clientX',1);resize(composeHandle,'height','clientY',-1);
 narrow.addEventListener('change',()=>{drawer=false;schedule();});
 window.addEventListener('bridge-chat-opened',()=>{if(narrow.matches&&drawer)toggle(false);});
 viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
 window.addEventListener('resize',schedule);document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
 const observed=[layout,thread.querySelector('.chat-thread-header'),thread.querySelector('.chat-connection'),$('chat-attachments'),composer.querySelector('.chat-compose-actions')];
 const observer=new ResizeObserver(schedule);for(const node of observed)observer.observe(node);
 window.addEventListener('pagehide',()=>{stopped=true;observer.disconnect();cancelAnimationFrame(applyFrame);cancelAnimationFrame(restoreFrame);cancelAnimationFrame(scrollFrame);applyFrame=restoreFrame=scrollFrame=0;});
 window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;for(const node of observed)observer.observe(node);schedule();}});
 remember();schedule();
})();
</script>`;
