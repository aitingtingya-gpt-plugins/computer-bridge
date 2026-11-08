/** Device-wide admission rules for model calls, separate from workspace confinement. */
import {toolSpecs} from './contracts';
import type {Data} from './types';

export const permissionTools=toolSpecs.map(([name])=>name)
  .filter(name=>name!=='computer.list' && name!=='computer.recover');
const tools:ReadonlySet<string>=new Set(permissionTools);
export const hasToolPermission=(name:string)=>tools.has(name);
export type ToolPermission='allow'|'ask'|'deny';
export const toolPermission=(access:Data|undefined,name:string):ToolPermission=>{
  const selected=access?.tool_permissions?.[name] ?? 'allow';
  if(name!=='computer.transfer')return selected;
  // A new transport must never bypass an existing file-tool restriction.
  const files=access?.tool_permissions?.['computer.files'] ?? 'allow';
  return selected==='deny'||files==='deny'?'deny':selected==='ask'||files==='ask'?'ask':'allow';
};
export function toolPermissions(value:unknown):Record<string,ToolPermission> {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('工具权限必须按工具设置');
  const result:Record<string,ToolPermission>={};
  for(const [name,mode] of Object.entries(value)){
    if(!tools.has(name) || !['allow','ask','deny'].includes(mode))throw new Error('未知的工具或权限：'+name);
    if(mode!=='allow')result[name]=mode;
  }
  return result;
}

/** Approval displays identify the operation without copying file contents into the gateway. */
export function toolSummary(method:string,args:Data):string {
  const operation=typeof args.operation==='string'?args.operation:args.action;
  const payload=args.payload??{};
  const fields=[
    operation&&'操作：'+operation,
    args.command&&'命令：'+args.command,
    args.cwd&&'目录：'+args.cwd,
    (args.path||payload.path)&&'路径：'+(args.path||payload.path),
    payload.destination&&'目标：'+payload.destination,
    args.url&&'网址：'+args.url,
    args.module&&'模块：'+args.module,
    args.workspace_id&&'工作区：'+args.workspace_id,
    Array.isArray(args.files)&&'文件：'+args.files.join('、'),
    args.enabled!==undefined&&'设置：'+(args.enabled?'开启':'关闭'),
    method==='computer.transfer'&&args.size!==undefined&&'大小：'+args.size+' bytes',
    method==='computer.transfer'&&args.sha256&&'SHA256：'+args.sha256,
    method==='computer.transfer'&&args.action==='upload_begin'&&'覆盖已有文件：'+(args.overwrite?'是':'否'),
  ].filter(Boolean);
  return [method,...fields].join('\n').slice(0,4096);
}
