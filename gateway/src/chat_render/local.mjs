import {renderMessage,escape} from './core.mjs';
import {readFileSync} from 'node:fs';
import {stylesheet} from './style.mjs';
const request=JSON.parse(readFileSync(0,'utf8'));
const value=renderMessage(request.text,request.id);
const copy=`document.addEventListener('click',async e=>{const b=e.target.closest('.cb-copy');if(!b)return;const c=b.closest('.cb-code,.cb-math-source').querySelector('code');try{await navigator.clipboard.writeText(c.textContent);b.textContent='已复制'}catch{const r=document.createRange();r.selectNodeContents(c);const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='已选中，请复制'}});`;
process.stdout.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(request.title||'公式完整查看')}</title><style>${stylesheet}\n${value.css}\nbody{margin:24px auto;padding:0 24px;max-width:1100px;color:#1d2939;background:#fff;font:16px/1.8 system-ui}h1{font-size:20px}.chat-message-body{padding:12px 0}</style></head><body><h1>${escape(request.title||'公式完整查看')} · ${escape(request.id)}</h1><article class="chat-message-body">${value.html}</article><script>${copy}</script></body></html>`);
