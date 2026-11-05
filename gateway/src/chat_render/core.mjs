import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import hljs from 'highlight.js/lib/common';
import {mathjax} from '@mathjax/src/js/mathjax.js';
import {TeX} from '@mathjax/src/js/input/tex.js';
import {SVG} from '@mathjax/src/js/output/svg.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import {MathJaxTexFont} from '@mathjax/mathjax-tex-font/js/svg.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js';

export const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const packages=['base','ams','newcommand','configmacros','physics','boldsymbol','cancel','mathtools','color','bbox','tagformat'];
const mathCache=new Map();
const md=new MarkdownIt({html:false,breaks:true,highlight(code,language){
  return language&&hljs.getLanguage(language)?hljs.highlight(code,{language,ignoreIllegals:true}).value:escape(code);
}}).enable(['table','strikethrough']);
let ruleId=0;
for(const delimiters of ['dollars','brackets','beg_end']) {
  const rules=texmath.rules[delimiters];
  for(const [kind,entries] of [['inline',rules.inline],['block',rules.block]])for(const rule of entries){
    const name='bridge_math_'+ruleId++,configured={...rule,name};
    if(delimiters==='dollars'&&rule.tag==='$')configured.rex=/\$(?!\s)([^$\n]*?[^\\\s])\$/gy;
    if(delimiters==='beg_end')configured.rex=/(\\begin\{([a-z]+\*?)\}[\s\S]+?\\end\{\2\})/gmy;
    if(kind==='inline')md.inline.ruler.before('escape',name,texmath.inline(configured));
    else md.block.ruler.before('fence',name,texmath.block(configured),{alt:['paragraph','reference','blockquote','list']});
    md.renderer.rules[name]=(tokens,index,options,env)=>{
      const token=tokens[index],display=kind==='block'||!!rule.displayMode;
      const ordinal=env.formulas.length;env.formulas.push({tex:token.content,display,line:(token.map?.[0]??env.line??0)+1});
      return `<${display?'div':'span'} class="cb-equation${display?' cb-display':''}" data-formula="${ordinal}"><span class="cb-math-target">${escape((display?'\\[':'\\(')+token.content+(display?'\\]':'\\)'))}</span><details class="cb-math-source"><summary>LaTeX 原文</summary><pre><code>${escape(token.content)}</code></pre><button type="button" class="cb-copy">复制 LaTeX</button></details></${display?'div':'span'}>`;
    };
  }
}
md.inline.ruler.before('escape','bridge_unclosed_math',(state,silent)=>{
  const rest=state.src.slice(state.pos),pair=[['\\[','\\]'],['\\(','\\)'],['$$','$$']].find(([open])=>rest.startsWith(open));
  if(!pair||rest.indexOf(pair[1],pair[0].length)>=0)return false;
  if(!silent){const token=state.push('bridge_unclosed_math','span',0);token.content=rest;}
  state.pos=state.src.length;return true;
});
md.renderer.rules.bridge_unclosed_math=(tokens,index)=>`<span class="cb-math-error">公式未闭合</span><code>${escape(tokens[index].content)}</code>`;
const inline=md.renderer.rules.inline;
md.renderer.rules.inline=(tokens,index,options,env,self)=>{env.line=tokens[index].map?.[0]??0;return inline?inline(tokens,index,options,env,self):self.renderInline(tokens[index].children,options,env);};
md.renderer.rules.fence=(tokens,index,options)=>{
  const token=tokens[index],language=token.info.trim().split(/\s+/)[0],highlighted=options.highlight(token.content,language)||escape(token.content);
  return `<div class="cb-code"><div class="cb-code-heading"><span>${escape(language||'代码')}</span><button type="button" class="cb-copy">复制代码</button></div><pre><code>${highlighted}</code></pre></div>`;
};
const link=md.renderer.rules.link_open;
md.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return link?link(tokens,index,options,env,self):self.renderToken(tokens,index,options);};

/** A fresh TeX document makes macros, labels and equation numbers message-local. */
export function renderMessage(text,id='message') {
  const env={formulas:[],line:0},html=md.render(text,env),errors=[];
  if(!env.formulas.length)return {html,css:'',formulas:[],errors};
  const reusable=!env.formulas.some(f=>/\\(?:label|ref|eqref|tag|begin)\b/.test(f.tex));
  const key=JSON.stringify(env.formulas.map(({tex,display})=>[tex,display]));
  const cached=reusable&&mathCache.get(key);
  if(cached){let index=0;return {html:html.replace(/<span class="cb-math-target">[\s\S]*?<\/span>/g,()=>'<span class="cb-math-target">'+cached.slots[index++]+'</span>'),css:cached.css,formulas:env.formulas,errors};}
  const tex=new TeX({packages,tags:'ams',maxBuffer:Math.max(5120,text.length*2),
    tagformat:{id:label=>'cb-'+String(id).replace(/[^a-zA-Z0-9_-]/g,'')+'-'+encodeURIComponent(label)},
    formatError(jax,error){errors.push(error.message);return jax.formatError(error);}});
  const output=new SVG({fontData:MathJaxTexFont,fontCache:'none'});
  const document=mathjax.document(html,{InputJax:tex,OutputJax:output});
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
