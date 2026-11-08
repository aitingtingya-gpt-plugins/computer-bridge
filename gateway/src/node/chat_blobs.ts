import {mkdir,readFile,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import type {ServiceEnv} from '../runtime';

/** Attachment chunks live outside SQLite under the deployment's persistent DATA_DIR. */
export function chatBlobs(directory:string,platform:NodeJS.Platform=process.platform):NonNullable<ServiceEnv['chatBlobs']>{
  const folder=(chat:string,attachment:string)=>{
    if(!/^t[1-9]\d*$/.test(chat)||!/^a[1-9]\d*$/.test(attachment))throw new Error('无效附件编号');
    return join(directory,'chat-attachments',chat,attachment);
  };
  const path=(chat:string,attachment:string,index:number)=>{
    if(!Number.isSafeInteger(index)||index<0)throw new Error('无效分块编号');
    return join(folder(chat,attachment),String(index));
  };
  // Windows does not expose POSIX directory fsync through Node. Use SQLite's
  // supported durable commit instead of silently ignoring directory errors.
  // Open/close per operation also leaves no handle that prevents Windows cleanup.
  if(platform==='win32'){
    const database=join(directory,'chat-attachment-chunks.sqlite3');
    const databaseWork=<T>(write:boolean,work:(db:DatabaseSync)=>T):T|undefined=>{
      if(!write&&!existsSync(database))return undefined;
      const db=new DatabaseSync(database);
      try{
        db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
        if(write)db.exec('CREATE TABLE IF NOT EXISTS chunks(chat TEXT NOT NULL, attachment TEXT NOT NULL, chunk INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(chat,attachment,chunk));');
        return work(db);
      }finally{db.close();}
    };
    return {
      async write(chat,attachment,index,bytes){
        path(chat,attachment,index);await mkdir(directory,{recursive:true});
        databaseWork(true,db=>db.prepare('INSERT OR REPLACE INTO chunks VALUES(?,?,?,?)').run(chat,attachment,index,bytes));
      },
      async read(chat,attachment,index){
        const original=path(chat,attachment,index);
        const row=databaseWork(false,db=>db.prepare('SELECT data FROM chunks WHERE chat=? AND attachment=? AND chunk=?').get(chat,attachment,index)) as {data:Uint8Array}|undefined;
        return row?new Uint8Array(row.data):new Uint8Array(await readFile(original));
      },
      async remove(chat,attachment){
        const original=folder(chat,attachment);
        databaseWork(false,db=>db.prepare('DELETE FROM chunks WHERE chat=? AND attachment=?').run(chat,attachment));
        await rm(original,{recursive:true,force:true});
      },
    };
  }
  return {
    async write(chat,attachment,index,bytes){
      const target=path(chat,attachment,index);await mkdir(folder(chat,attachment),{recursive:true});
      const temporary=target+'.'+crypto.randomUUID()+'.part';
      try{
        const file=await open(temporary,'wx',0o600);
        try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
        await rename(temporary,target);
        // Persist the directory entry before exposing the matching offset in SQLite.
        for(const path of [folder(chat,attachment),join(directory,'chat-attachments',chat),join(directory,'chat-attachments'),directory]){
          const handle=await open(path,'r');
          try{await handle.sync();}finally{await handle.close();}
        }
      }
      finally{await rm(temporary,{force:true});}
    },
    async read(chat,attachment,index){return new Uint8Array(await readFile(path(chat,attachment,index)));},
    async remove(chat,attachment){await rm(folder(chat,attachment),{recursive:true,force:true});},
  };
}
