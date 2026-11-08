import {JsonMmlVisitor} from '@mathjax/src/js/core/MmlTree/JsonMmlVisitor.js';
import {parseMessage} from './markdown.mjs';
import {semanticDocument} from './tex.mjs';

const visitor=new JsonMmlVisitor();

function formulaErrors(tree){
  const errors=[];
  const visit=node=>{
    if(node.kind==='merror'){
      const text=n=>n.text??(n.childNodes||[]).map(text).join('');
      errors.push(node.attributes?.['data-mjx-error']||node.properties?.message||text(node));
    }
    for(const child of node.childNodes||[])visit(child);
  };
  visit(tree);return errors;
}

/** Compile one complete message, sharing macros and references only within it. */
export function compileMessage(text,id='message'){
  const parsed=parseMessage(text),errors=[];
  if(!parsed.formulas.length)return {id,formulas:[],errors};
  const document=semanticDocument(parsed.html,id,errors);
  document.findMath({elements:['.cb-math-target']});document.compile();
  const roots=[...document.math].map(math=>visitor.visitTree(math.root));
  const formulas=parsed.formulas.map((formula,index)=>{
    const tree=roots[index],messages=formulaErrors(tree);
    return {...formula,tree,error:messages.length?messages.join('; '):null};
  });
  return {id,formulas,errors};
}
