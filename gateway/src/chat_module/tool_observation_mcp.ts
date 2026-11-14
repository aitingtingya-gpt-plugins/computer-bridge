import type {ObservedToolReceipt} from './tool_observation';
/** Preserve the original tool result/error. In particular, recording failure must
 * never become an action failure that invites a duplicate side effect. */
export function withToolObservationReceipt(response:any,receipt:ObservedToolReceipt):any {
  if(!Array.isArray(response?.content))return response; // Do not change inputRequired continuation frames.
  const value={...response,_meta:{...response._meta,bridge_chat_trace:receipt}};
  if(response.content.length===1&&response.content[0].type==='text'){
    try{const decoded=JSON.parse(response.content[0].text);if(decoded&&typeof decoded==='object'&&!Array.isArray(decoded))
      value.content=[{...response.content[0],text:JSON.stringify({...decoded,chat_trace:receipt})}];}catch{/* Preserve non-JSON text exactly. */}
  }
  return value;
}
