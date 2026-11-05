import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {ServiceEnv} from '../runtime';

/** Attachment chunks live outside SQLite under the deployment's persistent DATA_DIR. */
export function chatBlobs(directory:string):NonNullable<ServiceEnv['chatBlobs']>{
  const folder=(chat:string,attachment:string)=>{
    if(!/^t[1-9]\d*$/.test(chat)||!/^a[1-9]\d*$/.test(attachment))throw new Error('无效附件编号');
    return join(directory,'chat-attachments',chat,attachment);
  };
  const path=(chat:string,attachment:string,index:number)=>{
    if(!Number.isSafeInteger(index)||index<0)throw new Error('无效分块编号');
    return join(folder(chat,attachment),String(index));
  };
  return {
    async write(chat,attachment,index,bytes){
      const target=path(chat,attachment,index);await mkdir(folder(chat,attachment),{recursive:true});
      const temporary=target+'.'+crypto.randomUUID()+'.part';
      try{await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,target);}
      finally{await rm(temporary,{force:true});}
    },
    async read(chat,attachment,index){return new Uint8Array(await readFile(path(chat,attachment,index)));},
    async remove(chat,attachment){await rm(folder(chat,attachment),{recursive:true,force:true});},
  };
}
