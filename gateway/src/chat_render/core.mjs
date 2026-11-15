import {SVG} from '@mathjax/src/js/output/svg.js';
import {MathJaxTexFont} from '@mathjax/mathjax-tex-font/js/svg.js';
import {mathjax} from '@mathjax/src/js/mathjax.js';
import {parseMessage,escape} from './markdown.mjs';
import {adaptor,texInput} from './tex.mjs';
export {parseMessage,escape} from './markdown.mjs';
const mathCache=new Map();

export function mathDocument(html,id,errors){
  const tex=texInput(html,id,errors);
  const output=new SVG({fontData:MathJaxTexFont,fontCache:'none'});
  return {document:mathjax.document(html,{InputJax:tex,OutputJax:output}),output};
}

export function renderMessage(text,id='message') {
  const {html,formulas}=parseMessage(text,id),env={formulas},errors=[];
  if(!env.formulas.length)return {html,css:'',formulas:[],errors};
  const reusable=!env.formulas.some(f=>/\\(?:label|ref|eqref|tag|begin)\b/.test(f.tex));
  const key=JSON.stringify(env.formulas.map(({tex,display})=>[tex,display]));
  const cached=reusable&&mathCache.get(key);
  if(cached){let index=0;return {html:html.replace(/<span class="cb-math-target">[\s\S]*?<\/span>/g,()=>'<span class="cb-math-target">'+cached.slots[index++]+'</span>'),css:cached.css,formulas:env.formulas,errors};}
  const {document,output}=mathDocument(html,id,errors);
  document.findMath({elements:['.cb-math-target']});document.render();
  for(const node of adaptor.tags(adaptor.body(document.document),'g'))if(adaptor.getAttribute(node,'data-mml-node')==='merror'){
    let wrapper=node;while(wrapper&&!adaptor.hasAttribute(wrapper,'data-formula'))wrapper=adaptor.parent(wrapper);
    if(wrapper){const index=Number(adaptor.getAttribute(wrapper,'data-formula')),info=env.formulas[index];
      adaptor.append(wrapper,adaptor.node('span',{class:'cb-math-error'},[adaptor.text('公式 '+(index+1)+' · 原文第 '+info.line+' 行：'+(adaptor.getAttribute(node,'data-mjx-error')||'排版错误，请查看原文'))]));}
  }
  const body=adaptor.innerHTML(adaptor.body(document.document));
  const css=adaptor.textContent(output.styleSheet(document));
  if(reusable&&!errors.length){const slots=adaptor.tags(adaptor.body(document.document),'span').filter(node=>adaptor.getAttribute(node,'class')==='cb-math-target').map(node=>adaptor.innerHTML(node));
    if(!slots.some(value=>/\sid=/.test(value))){mathCache.set(key,{slots,css});if(mathCache.size>128)mathCache.delete(mathCache.keys().next().value);}}
  // MathJax's merror retains its full diagnostic and the source details remain intact.
  return {html:body,css,formulas:env.formulas,errors};
}
