import {References} from './references';
import type {Data} from './types';

/** Protocol projection only. The source-specific scripts own all parsing. */
export async function definitionList(refs:References, method:string,result:Data,scope:string):Promise<Data> {
  const prefix=method==='computer.skills'?'k':'g';
  const items=[];
  for(const item of result.items) {
    const id=await refs.assign(prefix,item.key,scope,{source:item.source,locator:item.locator});
    items.push({id,name:item.name,description:item.description,source:item.source});
  }
  return {[method==='computer.skills'?'skills':'agents']:items};
}
