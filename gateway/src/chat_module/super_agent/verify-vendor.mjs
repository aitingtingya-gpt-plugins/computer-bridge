import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./vendor/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('UPSTREAM.json',root),'utf8'));
let checked=0;
for(const entry of manifest.files){
  const bytes=await readFile(new URL(entry.path,root));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(sha256!==entry.sha256||blob!==entry.git_blob_sha1)throw new Error('Vendored source changed: '+entry.path);
  checked++;
}
console.log(`Verified ${checked} unmodified upstream files at ${manifest.commit}`);
const adaptations=JSON.parse(await readFile(new URL('ADAPTATIONS.json',import.meta.url),'utf8'));
for(const item of adaptations.adaptations){
  let expected=await readFile(new URL(item.source,root),'utf8');
  for(const [before,after] of item.replacements){if(!expected.includes(before))throw new Error('Upstream adaptation target missing: '+item.source);expected=expected.replaceAll(before,after);}
  const actual=await readFile(new URL(item.target,import.meta.url),'utf8');
  if(actual!==expected)throw new Error('Undeclared upstream code change: '+item.target);
}
for(const item of adaptations.extractions){
  let expected='';
  for(const part of item.parts){
    if(part.literal!==undefined){expected+=part.literal;continue;}
    const source=await readFile(new URL(part.source,root),'utf8'),start=source.indexOf(part.start),end=part.end?source.indexOf(part.end,start):source.length;
    if(start<0||end<start)throw new Error('Upstream extraction target missing: '+part.source);
    expected+=source.slice(start,end);
  }
  if(await readFile(new URL(item.target,import.meta.url),'utf8')!==expected)throw new Error('Undeclared upstream extraction change: '+item.target);
}
const generated=await readFile(new URL('upstream-prompt-resources.ts',import.meta.url),'utf8');
for(const entry of manifest.files.filter(item=>item.path.startsWith('prompts/')&&item.path.endsWith('.md'))){
  const body=await readFile(new URL(entry.path,root),'utf8');
  if(!generated.includes(JSON.stringify(body)))throw new Error('Prompt resource differs from upstream: '+entry.path);
}
console.log(`Verified ${adaptations.adaptations.length} IO adaptations and ${adaptations.extractions.length} unchanged extracted modules`);
