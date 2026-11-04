import {compare,valid,satisfies} from 'semver';
import type {Store} from './runtime';
import type {Data} from './types';

export const VERSION='0.2.0';
export const DEFAULT_REPOSITORY='aitingtingya-gpt-plugins/computer-bridge';
export interface Artifact {
  id:string;
  target:'client'|'server-node'|'server-cloudflare'|'module-client'|'module-server'|'updater';
  version:string;
  file:string;
  sha256:string;
  size:number;
  platform:string;
  modules:string[];
  module?:string;
  requires:{protocol:number;core?:string;module_api?:number};
  dependencies?:string[];
  url?:string;
}
export interface Manifest {format:1;version:string;protocol:{min:number;max:number};artifacts:Artifact[]}

export function manifest(value:unknown):Manifest {
  const data=value as Manifest;
  if(data?.format!==1 || !valid(data.version) || !Array.isArray(data.artifacts)) throw new Error('发布清单格式不正确');
  for(const a of data.artifacts) {
    if(!valid(a.version) || !/^[a-f0-9]{64}$/.test(a.sha256) || !a.file || !a.requires?.protocol)
      throw new Error('发布资源信息不完整');
  }
  return data;
}

export function compatibility(artifact:Artifact,peer:Data):string|null {
  const protocol=peer.protocol || {min:1,max:1};
  if(artifact.requires.protocol<protocol.min || artifact.requires.protocol>protocol.max)
    return '通信协议不兼容，需要先更新另一端';
  if(artifact.requires.core && !satisfies(peer.version,artifact.requires.core,{includePrerelease:true}))
    return '需要先更新核心到 '+artifact.requires.core;
  if(artifact.requires.module_api && artifact.requires.module_api!==1) return '模块接口版本不兼容';
  return null;
}

export class Releases {
  private pending?:Promise<Data>;
  constructor(private store:Store,private token?:string) {}
  async settings():Promise<Data> {
    return await this.store.get<Data>('updates:source') || {repository:DEFAULT_REPOSITORY,channel:'stable'};
  }
  async configure(repository:string,channel:string):Promise<void> {
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('请填写 GitHub 的组织/仓库名');
    if(!['stable','preview'].includes(channel)) throw new Error('未知更新渠道');
    await this.store.put('updates:source',{repository,channel});
    await this.store.delete('updates:catalogue');
  }
  private headers(binary=false):Headers {
    const headers=new Headers({'Accept':binary?'application/octet-stream':'application/vnd.github+json',
      'User-Agent':'Computer-Bridge-Updater','X-GitHub-Api-Version':'2022-11-28'});
    if(this.token) headers.set('Authorization','Bearer '+this.token);
    return headers;
  }
  async download(artifact:Artifact):Promise<Response> {
    const response=await fetch(artifact.url!,{headers:this.headers(true),redirect:'follow'});
    if(!response.ok) throw new Error('GitHub 下载失败：HTTP '+response.status);
    return response;
  }
  async check(force=false):Promise<Data> {
    if(this.pending) return this.pending;
    const cached=await this.store.get<Data>('updates:catalogue');
    if(!force && cached && Date.now()-cached.checked_at<900_000) return cached;
    this.pending=this.load();
    try {return await this.pending;}finally {this.pending=undefined;}
  }
  private async load():Promise<Data> {
    const settings=await this.settings();
    let page=1;
    const candidates:Data[]=[];
    while(true) {
      const response=await fetch(`https://api.github.com/repos/${settings.repository}/releases?per_page=100&page=${page}`,{headers:this.headers()});
      if(!response.ok) throw new Error('GitHub 发布查询失败：HTTP '+response.status);
      const rows=await response.json<Data[]>();
      candidates.push(...rows.filter(r=>!r.draft && (settings.channel==='preview' || !r.prerelease) && valid(r.tag_name.replace(/^v/,''))));
      if(rows.length<100) break;
      page++;
    }
    candidates.sort((a,b)=>compare(b.tag_name.replace(/^v/,''),a.tag_name.replace(/^v/,'')));
    const releases=[];
    for(const release of candidates) {
      const asset=release.assets.find((a:Data)=>a.name==='release-manifest.json');
      if(!asset) continue;
      const response=await fetch(asset.url,{headers:this.headers(true),redirect:'follow'});
      if(!response.ok) throw new Error('发布清单下载失败：HTTP '+response.status);
      const data=manifest(await response.json());
      if(data.version!==release.tag_name.replace(/^v/,'')) throw new Error('发布标签与清单版本不同');
      for(const artifact of data.artifacts) {
        const remote=release.assets.find((a:Data)=>a.name===artifact.file);
        if(!remote || remote.size!==artifact.size) throw new Error('发布资源缺失或大小不符：'+artifact.file);
        artifact.url=remote.url;
      }
      releases.push({id:release.id,version:data.version,notes:release.body || '',published_at:release.published_at,
        url:release.html_url,prerelease:release.prerelease,manifest:data});
    }
    const catalogue={...settings,checked_at:Date.now(),releases};
    await this.store.put('updates:catalogue',catalogue);
    return catalogue;
  }
}
