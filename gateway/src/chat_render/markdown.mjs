import MarkdownIt from 'markdown-it';
import {cjkFriendly} from '@mdit/plugin-cjk-friendly';
import {tasklist} from '@mdit/plugin-tasklist';
import footnote from 'markdown-it-footnote';
import texmath from 'markdown-it-texmath';
import hljs from 'highlight.js/lib/common';
import {gfmStrikethrough} from './strikethrough.mjs';
export const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const md=new MarkdownIt({html:false,breaks:true,linkify:true,highlight(code,language){
  return language&&hljs.getLanguage(language)?hljs.highlight(code,{language,ignoreIllegals:true}).value:escape(code);
}}).use(cjkFriendly).use(gfmStrikethrough).use(footnote).use(tasklist,{disabled:true,label:false});
// Reuse the URL validator for GFM's www form without linking bare filenames.
md.linkify.add('www.',{
  validate(text,offset,self){
    const prefix='www.', authority='//'+text.slice(offset-prefix.length);
    return Math.max(0,self.testSchemaAt(authority,'http:',0)-2-prefix.length);
  },
  normalize(link){link.url='http://'+link.raw;},
});
md.inline.ruler.disable('footnote_inline');
md.renderer.rules.checkbox_input=(tokens,index,options,env,self)=>{
  const token=tokens[index];
  token.attrSet('aria-label',token.attrGet('checked')?'已完成':'未完成');
  return self.renderToken(tokens,index,options);
};

// Keep parser positions through Markdown's indentation, table escaping and CRLF
// normalization. Repeated formulas never locate themselves by substring search.
function normalizeSource(text){
  let source='',point=0;const points=[0];
  for(let index=0;index<text.length;){
    let char=String.fromCodePoint(text.codePointAt(index));index+=char.length;let consumed=1;
    if(char==='\r'){if(text[index]==='\n'){index++;consumed++;}char='\n';}
    if(char==='\0')char='\ufffd';
    source+=char;if(char.length===2)points.push(point);point+=consumed;points.push(point);
  }
  return {source,points};
}
function trimMapped(value,map){
  const start=value.length-value.replace(/^[ \t\r\n]+/,'').length;
  const end=value.replace(/[ \t\r\n]+$/,'').length;
  return {value:value.slice(start,Math.max(start,end)),map:map.slice(start,Math.max(start,end)+1)};
}
function getLinesMap(state,begin,end,indent,keepLastLF){
  let value='';const map=[];
  for(let line=begin;line<end;line++){
    let first=state.bMarks[line],columns=0;const last=state.eMarks[line]+(line+1<end||keepLastLF?1:0);
    while(first<last&&columns<indent){
      const char=state.src.charCodeAt(first);
      if(char===32||char===9)columns+=char===9?4-(columns+state.bsCount[line])%4:1;
      else if(first-state.bMarks[line]<state.tShift[line])columns++;
      else break;
      first++;
    }
    for(let pad=indent;pad<columns;pad++){value+=' ';map.push(first-1);}
    for(let pos=first;pos<last;pos++){value+=state.src[pos];map.push(pos);}
  }
  map.push(end>begin?state.eMarks[end-1]+(keepLastLF?1:0):state.bMarks[begin]);
  return {value,map};
}
function tableCells(state,line){
  let start=state.bMarks[line]+state.tShift[line],end=state.eMarks[line];
  while(start<end&&/[ \t]/.test(state.src[start]))start++;
  while(end>start&&/[ \t]/.test(state.src[end-1]))end--;
  const cells=[];let value='',map=[],escaped=false;
  for(let pos=start;pos<end;pos++){
    const char=state.src[pos];
    if(char==='|'&&!escaped){map.push(pos);cells.push(trimMapped(value,map));value='';map=[];}
    else {if(char==='|'&&escaped){value=value.slice(0,-1);map.pop();}value+=char;map.push(pos);}
    escaped=char==='\\';
  }
  map.push(end);cells.push(trimMapped(value,map));
  if(cells[0]?.value==='')cells.shift();if(cells.at(-1)?.value==='')cells.pop();
  return cells;
}
function environmentMatcher(){
  return {lastIndex:0,exec(source){
    const start=this.lastIndex,opening=/^\\begin\{([A-Za-z][A-Za-z0-9]*\*?)\}/.exec(source.slice(start));
    if(!opening){this.lastIndex=0;return null;}
    let depth=1,position=start+opening[0].length;
    while(position<source.length){
      if(source[position]==='%'){const line=source.indexOf('\n',position);position=line<0?source.length:line+1;continue;}
      if(source[position]!=='\\'){position++;continue;}
      const marker=/^\\(begin|end)\{([A-Za-z][A-Za-z0-9]*\*?)\}/.exec(source.slice(position));
      if(!marker){position+=2;continue;}
      depth+=marker[1]==='begin'?1:-1;position+=marker[0].length;
      if(depth===0){const value=source.slice(start,position);this.lastIndex=position;return [value,value,opening[1]];}
    }
    this.lastIndex=0;return null;
  }};
}
for(const name of ['paragraph','lheading','heading','table']){
  const entry=md.block.ruler.__rules__.find(rule=>rule.name===name),original=entry.fn;
  md.block.ruler.at(name,(state,begin,end,silent)=>{
    if(silent)return original(state,begin,end,silent);
    const first=state.tokens.length,captured=[],getLines=state.getLines;
    const headingStart=name==='heading'?state.bMarks[begin]+state.tShift[begin]:0;
    state.getLines=function(...args){const value=getLines.apply(this,args);captured.push(trimMapped(value,getLinesMap(this,...args).map));return value;};
    let accepted;
    try{accepted=original(state,begin,end,silent);}finally{state.getLines=getLines;}
    if(!accepted)return accepted;
    let cells=[],cell=0;
    for(const token of state.tokens.slice(first)){
      if(token.type==='tr_open'){cells=tableCells(state,token.map[0]);cell=0;}
      if(token.type!=='inline')continue;
      let mapped;
      if(name==='table')mapped=cells[cell++];
      else if(name==='heading'){
        let position=headingStart;while(state.src[position]==='#')position++;while(/[ \t]/.test(state.src[position]||'\0'))position++;
        mapped={value:token.content,map:Array.from({length:token.content.length+1},(_,i)=>position+i)};
      }else mapped=captured.find(part=>part.value===token.content);
      if(mapped&&mapped.value===token.content)token.meta={...token.meta,bridgeSourceMap:mapped.map};
    }
    return accepted;
  },{alt:entry.alt});
}
md.core.ruler.at('inline',state=>{
  for(const token of state.tokens)if(token.type==='inline'){
    state.env.inlineSourceMap=token.meta?.bridgeSourceMap;
    state.md.inline.parse(token.content,state.md,state.env,token.children);
  }
  delete state.env.inlineSourceMap;
});

function renderFormula(token,env,display,block){
  const ordinal=env.formulas.length,start=token.meta?.bridgeStart,end=token.meta?.bridgeEnd;
  env.formulas.push({tex:token.content,display,line:start===undefined?(token.map?.[0]??env.line??0)+1:env.source.slice(0,start).split('\n').length,
    start:env.points[start],end:env.points[end]});
  const tag=block?'div':'span';
  return `<${tag} class="cb-equation${display?' cb-display':''}" data-formula="${ordinal}"><span class="cb-math-target">${escape((display?'\\[':'\\(')+token.content+(display?'\\]':'\\)'))}</span><details class="cb-math-source"><summary>LaTeX 原文</summary><pre><code>${escape(token.content)}</code></pre><button type="button" class="cb-copy">复制 LaTeX</button></details></${tag}>`;
}

const mathFence=token=>token.info.trim().split(/\s+/,1)[0]==='math';
const {fn:originalFence,alt:fenceAlt}=md.block.ruler.__rules__.find(rule=>rule.name==='fence');
md.block.ruler.at('fence',(state,begin,end,silent)=>{
  const accepted=originalFence(state,begin,end,silent);
  if(accepted&&!silent) {
    const token=state.tokens.at(-1);
    if(mathFence(token))token.meta={bridgeStart:state.bMarks[begin]+state.tShift[begin],bridgeEnd:state.eMarks[token.map[1]-1]};
  }
  return accepted;
},{alt:fenceAlt});

let ruleId=0;
for(const delimiters of ['dollars','brackets','beg_end']) {
  const rules=texmath.rules[delimiters];
  for(const [kind,entries] of [['inline',rules.inline],['block',rules.block]])for(const rule of entries){
    const name='bridge_math_'+ruleId++,configured={...rule,name};
    if(delimiters==='dollars'&&rule.tag==='$')configured.rex=/\$(?!\s)([^$\n]*?[^\\\s])\$/gy;
    if(delimiters==='beg_end')configured.rex=environmentMatcher();
    if(kind==='inline'){
      const parse=texmath.inline(configured);
      md.inline.ruler.before('escape',name,(state,silent)=>{
        const begin=state.pos,accepted=parse(state,silent);
        if(accepted&&!silent){const map=state.env.inlineSourceMap;state.tokens.at(-1).meta={bridgeStart:map?.[begin],bridgeEnd:map?.[state.pos]};}
        return accepted;
      });
    }else{
      const parse=texmath.block(configured);
      md.block.ruler.before('fence',name,(state,begin,end,silent)=>{
        const start=state.bMarks[begin]+state.tShift[begin],count=state.tokens.length,accepted=parse(state,begin,end,silent);
        if(accepted&&!silent)state.tokens[count].meta={bridgeStart:start,bridgeEnd:configured.rex.lastIndex};
        return accepted;
      },{alt:['paragraph','reference','blockquote','list']});
    }
    md.renderer.rules[name]=(tokens,index,options,env)=>renderFormula(tokens[index],env,kind==='block'||!!rule.displayMode,kind==='block');
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
function renderCode(token,options,language=''){
  const highlighted=options.highlight(token.content,language);
  return `<div class="cb-code"><div class="cb-code-heading"><span>${escape(language||'代码')}</span><button type="button" class="cb-copy">复制代码</button></div><pre><code>${highlighted}</code></pre></div>\n`;
}
md.renderer.rules.fence=(tokens,index,options,env)=>{
  const token=tokens[index];
  return mathFence(token)?renderFormula(token,env,true,true)+'\n':renderCode(token,options,token.info.trim().split(/\s+/,1)[0]);
};
md.renderer.rules.code_block=(tokens,index,options)=>renderCode(tokens[index],options);
const link=md.renderer.rules.link_open;
md.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return link?link(tokens,index,options,env,self):self.renderToken(tokens,index,options);};

export function parseMessage(text,id='message'){
  const docId='cb-'+Array.from(String(id),char=>char.codePointAt(0).toString(16)).join('-');
  const {source,points}=normalizeSource(text),env={formulas:[],line:0,source,points,docId};
  return {html:md.render(source,env),formulas:env.formulas};
}
