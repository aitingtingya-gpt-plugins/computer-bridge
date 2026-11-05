import {renderMessage} from './core.mjs';
let sheet,timer;const queue=[],cache=new Map();
function show(node,rendered){
  node.innerHTML=rendered.html;
  if(!sheet&&rendered.css){sheet=document.createElement('style');sheet.textContent=rendered.css;document.head.append(sheet);}
}
function work(){
  timer=null;const messages=document.querySelector('#chat-messages');
  const following=messages&&messages.scrollHeight-messages.scrollTop-messages.clientHeight<90,anchor=!following&&window.bridgeChatLayout?.capture(),end=performance.now()+8;
  let count=0;
  while(queue.length&&count++<32&&performance.now()<end){const job=queue.shift();if(!job.node.isConnected)continue;const key=job.id+'\0'+job.text;let rendered=cache.get(key);if(!rendered){rendered=renderMessage(job.text,job.id);cache.set(key,rendered);if(cache.size>256)cache.delete(cache.keys().next().value);}show(job.node,rendered);}
  if(following)messages.scrollTop=messages.scrollHeight;else if(anchor)window.bridgeChatLayout.restore(anchor);
  if(queue.length)timer=setTimeout(work,0);
}
window.bridgeMarkdown={render(node,text,id){node.textContent=text;queue.push({node,text,id});if(timer===undefined||timer===null)timer=setTimeout(work,0);}};
document.addEventListener('click',async event=>{
  const button=event.target.closest?.('.cb-copy');if(!button)return;
  const code=button.closest('.cb-code,.cb-math-source').querySelector('code');
  try{await navigator.clipboard.writeText(code.textContent);button.textContent='已复制';}catch{
    const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(code);selection.removeAllRanges();selection.addRange(range);button.textContent='已选中，请复制';
  }
});
