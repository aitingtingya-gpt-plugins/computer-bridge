import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url));
const destination=join(here,'third_party/dsh-tools');
const source=resolve(process.env.COMPUTER_BRIDGE_DSH_SOURCE || destination);
const manifestPath=join(here,'DSH_TOOLS.json');
let modules={};
async function scan(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()) await scan(path);
    else if(entry.name==='package.json') {
      const value=JSON.parse(await readFile(path,'utf8'));
      if(value.name?.startsWith('@deepseek-ai/dsh-')) modules[value.name]=relative(source,dirname(path)).replaceAll('\\','/');
    }
  }
}
if(source===destination) modules=JSON.parse(await readFile(manifestPath,'utf8')).modules;
else await scan(join(source,'packages'));
const overrides={
  '@deepseek-ai/dsh-llm':'packages/llm/llm/src/error.ts',
};
const used=new Set();
let commandBuild=false;
const plugin={name:'pinned-dsh-source',setup(b) {
  // tsc inlines Cordis's const enum. Bundle its original source export for esbuild.
  b.onResolve({filter:/^@deepseek-ai\/cordis$/},args=>!commandBuild || args.namespace==='bridge-cordis'
    ? {path:args.path,external:true} : {path:'cordis',namespace:'bridge-cordis'});
  b.onLoad({filter:/.*/,namespace:'bridge-cordis'},()=>({contents:
    `export * from '@deepseek-ai/cordis'; export {FiberState} from ${JSON.stringify(join(here,'node_modules/@deepseek-ai/cordis/src/fiber.ts'))};`,
    loader:'ts',resolveDir:here}));
  b.onResolve({filter:/^\.\/third_party\/dsh-tools\//},args=>({path:join(source,args.path.slice('./third_party/dsh-tools/'.length))}));
  b.onResolve({filter:/^@deepseek-ai\/dsh-/},args=>{
    const parts=args.path.split('/');const name=parts.slice(0,2).join('/');const sub=parts.slice(2).join('/');
    if(name==='@deepseek-ai/dsh-tools' && !sub && !commandBuild)return {path:join(source,'packages/core/tools/src/schema.ts')};
    if(name==='@deepseek-ai/dsh-llm' && args.importer.endsWith('batch.ts'))return {path:join(source,'packages/llm/llm/src/message.ts')};
    if(!sub&&overrides[name])return {path:join(source,overrides[name])};
    const dir=modules[name];if(!dir)throw new Error('Unvendored DSH source dependency: '+args.path);
    const leaf=sub==='runner'?'bin':sub||'index';
    return {path:join(source,dir,'src',leaf.endsWith('.ts')?leaf:leaf+'.ts')};
  });
  b.onLoad({filter:/runner-launch\.ts$/},async args=>{
    const text=await readFile(args.path,'utf8');
    const before="import.meta.resolve('@deepseek-ai/dsh-subprocess-local/runner')";
    if(!text.includes(before))throw new Error('Upstream runner entry changed; review packaging mapping');
    return {contents:text.replace(before,"new URL('./subprocess-runner.mjs', import.meta.url).href"),loader:'ts'};
  });
}};
const entries={
  'command-runtime.mjs':join(here,'command-runtime.ts'),
  'files-runtime.mjs':join(here,'files-runtime.ts'),
  'media-runtime.mjs':join(here,'media-runtime.ts'),
  'subprocess-runner.mjs':join(source,'packages/subprocess/subprocess-local/src/bin.ts'),
};
for(const [out,entry] of Object.entries(entries)) {
  if(!existsSync(entry)) {if(process.env.COMPUTER_BRIDGE_DSH_SOURCE)continue;throw new Error('Missing runtime entry '+entry);}
  commandBuild=out==='command-runtime.mjs';
  const result=await build({entryPoints:[entry],outfile:join(here,out),bundle:true,platform:'node',format:'esm',target:'node24',
    packages:'external',plugins:[plugin],metafile:true,
    banner:{js:'import {createRequire as bridgeCreateRequire} from "node:module"; const require=bridgeCreateRequire(import.meta.url);'}});
  for(const input of Object.keys(result.metafile.inputs)) {
    const path=resolve(input);const rel=relative(source,path).replaceAll('\\','/');
    if(!rel.startsWith('../')&&!rel.startsWith('..\\')&&!rel.includes(':'))used.add(rel);
  }
}
if(source!==destination) {
  const files={};
  for(const rel of [...used].sort()) {
    const input=join(source,rel);const output=join(destination,rel);await mkdir(dirname(output),{recursive:true});await copyFile(input,output);
    files[rel]=createHash('sha256').update(await readFile(input)).digest('hex');
  }
  await copyFile(join(source,'LICENSE'),join(destination,'LICENSE'));
  const selected=Object.fromEntries(Object.entries(modules).filter(([,dir])=>[...used].some(p=>p.startsWith(dir+'/'))));
  await writeFile(manifestPath,JSON.stringify({repository:'https://github.com/deepseek-ai/deepseek-harness',commit:'ce7073d51254c26cd63b22a60835b8f948deb447',license:'MIT',modules:selected,files,build_adaptations:JSON.parse(await readFile(manifestPath,'utf8')).build_adaptations},null,2)+'\n');
}
