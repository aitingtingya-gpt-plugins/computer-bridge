// The built-in markdown-it rule only balances double tildes. Give each GFM
// delimiter width its own marker in the same delimiter stack as emphasis.
const markers={1:-1,2:-2};
export function gfmStrikethrough(md){
  md.inline.ruler.at('strikethrough',(state,silent)=>{
    if(silent||state.src[state.pos]!=='~')return false;
    const {length,can_open,can_close}=state.scanDelims(state.pos,true);
    const token=state.push('text','',0);
    token.content='~'.repeat(length);
    if(length<=2)state.delimiters.push({
      marker:markers[length],length:0,token:state.tokens.length-1,end:-1,
      open:can_open,close:can_close,
    });
    state.pos+=length;
    return true;
  });
  md.inline.ruler2.at('strikethrough',state=>{
    for(const delimiters of [state.delimiters,...state.tokens_meta.flatMap(meta=>meta?.delimiters?[meta.delimiters]:[])]){
      for(const opener of delimiters){
        if((opener.marker!==markers[1]&&opener.marker!==markers[2])||opener.end<0)continue;
        for(const [suffix,nesting,index] of [['open',1,opener.token],['close',-1,delimiters[opener.end].token]]){
          const token=state.tokens[index];
          Object.assign(token,{type:'s_'+suffix,tag:'del',nesting,markup:token.content,content:''});
        }
      }
    }
  });
}
