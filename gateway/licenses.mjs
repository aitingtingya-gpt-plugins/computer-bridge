/** Preserve complete license texts for every npm package included by esbuild. */
import {readFile,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';

export async function dependencyLicenses(metafile,base=process.cwd()) {
  const packages=new Map();
  for(const input of Object.keys(metafile.inputs)) {
    if(!input.includes('node_modules/'))continue;
    let directory=dirname(resolve(base,input));
    while(true) {
      try {
        const metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
        if(metadata.name && metadata.version) {
          packages.set(directory,metadata);break;
        }
      } catch(error) {if(error.code!=='ENOENT')throw error;}
      const parent=dirname(directory);
      if(parent===directory)throw new Error('Package metadata missing for '+input);
      directory=parent;
    }
  }
  const notices=[];
  for(const [directory,metadata] of [...packages].sort((a,b)=>a[1].name.localeCompare(b[1].name))) {
    const files=(await readdir(directory)).filter(name=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort();
    if(!files.length)throw new Error('License text missing for '+metadata.name);
    const texts=await Promise.all(files.map(async name=>name+'\n'+await readFile(join(directory,name),'utf8')));
    notices.push(metadata.name+' '+metadata.version+'\n'+texts.join('\n\n'));
  }
  return notices.join('\n\n--------------------\n\n');
}

export async function appendLicenses(output,metafile,base=process.cwd()) {
  const {appendFile}=await import('node:fs/promises');
  const notices=await dependencyLicenses(metafile,base);
  const own=await readFile(new URL('./LICENSE',import.meta.url),'utf8');
  await appendFile(output,'\n/* Computer Bridge license\n'+own.replaceAll('*/','* /')+'\n'+
    (notices?'\nThird-party licenses\n'+notices.replaceAll('*/','* /'):'')+'\n*/\n');
}
