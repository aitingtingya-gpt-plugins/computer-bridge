import type {Data} from './types';
import type {Store} from './runtime';
import {satisfies} from 'semver';
import {VERSION} from './releases';

export interface GatewayModule {
  id:string;
  version:string;
  api:number;
  core:string;
  kinds:Record<string,string>;
  identityFields:string[];
  ownsFile(path:string):boolean;
  confirmation(action:string):{message:string,schema:Data}|undefined;
}

export const installedModules:GatewayModule[]=[];
export function installModules(modules:GatewayModule[]):void {
  installedModules.splice(0,installedModules.length,...modules);
}

export class ServerModules {
  constructor(private storage:Store) {}
  async list():Promise<Data[]> {
    const disabled=await this.storage.get<string[]>('modules:disabled') || [];
    return installedModules.map(module=>({id:module.id,version:module.version,installed:true,
      enabled:!disabled.includes(module.id),requires:{core:module.core},
      state:module.api!==1 || !satisfies(VERSION,module.core,{includePrerelease:true})?'incompatible':disabled.includes(module.id)?'disabled':'available'}));
  }
  async require(name:string):Promise<GatewayModule> {
    const status=(await this.list()).find(m=>m.id===name);
    if(!status || status.state!=='available') throw Object.assign(new Error('中转端模块尚未安装、启用或版本不兼容：'+name),{code:'server_module_unavailable'});
    return installedModules.find(m=>m.id===name)!;
  }
  async enabled(name:string,enabled:boolean):Promise<void> {
    const names=new Set(await this.storage.get<string[]>('modules:disabled') || []);
    if(enabled) names.delete(name);else names.add(name);
    await this.storage.put('modules:disabled',[...names]);
  }
}
