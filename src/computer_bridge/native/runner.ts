// Wire/process glue; kernel confinement is supplied by the unchanged upstream modules.
import {readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {seatbeltProfileArgs} from 'bridge-seatbelt';
import {AclSandbox, AclWriteGrant, workspaceWriteSid, tempWriteSid} from 'bridge-windows';
import {win32} from './third_party/dsh/packages/sandbox/sandbox-windows-acl/src/ffi.ts';

if (process.argv[2]==='html') {
  const {convertHtml}=await import('bridge-html-runtime');
  writeFileSync(process.argv[4],convertHtml(readFileSync(process.argv[3],'utf8')));process.exit(0);
}
if (process.argv[2]==='cleanup') {
  const state=JSON.parse(readFileSync(process.argv[3],'utf8'));
  if(process.platform==='win32') {
    if(existsSync(state.temp)) {
      const temporary=AclWriteGrant.create(tempWriteSid(state.temp));
      try {temporary.add(state.temp);} finally {temporary.dispose();}
    }
  }
  rmSync(state.temp,{recursive:true,force:true});rmSync(process.argv[3]);process.exit(0);
}
if (process.argv[2]==='revoke') {
  const state=JSON.parse(readFileSync(process.argv[3],'utf8')) as {roots:string[];grant_key:string};
  if(process.platform==='win32') {
    const grant=AclWriteGrant.create(workspaceWriteSid(state.grant_key));
    try {for(const root of state.roots) if(existsSync(root)) grant.add(root);} finally {grant.dispose();}
  }
  rmSync(state.grant_key,{recursive:true,force:true});process.exit(0);
}

const policy = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {roots:string[];grant_key:string};
const argv = process.argv.slice(3);
const temp = mkdtempSync(join(tmpdir(),'computer-bridge-'));
const statePath=process.argv[2]+'.grants';
writeFileSync(statePath,JSON.stringify({temp,roots:policy.roots}));
let code = 1;
let grant: AclWriteGrant | undefined;
let sandbox: AclSandbox | undefined;
try {
  if (process.platform === 'darwin') {
    const child = spawn('/usr/bin/sandbox-exec', [
      ...seatbeltProfileArgs({mode:'workspace-write', workspaceRoot:policy.roots[0],
        additionalRoots:policy.roots.slice(1)}), '--', ...argv,
    ], {stdio:'inherit',env:{...process.env,TMPDIR:temp}});
    // The process group receives SIGTERM together. Keep this wrapper alive long enough
    // to finish upstream cleanup instead of abandoning its temporary directory.
    process.on('SIGTERM',()=>{});
    code = await new Promise<number>((resolve,reject) => {
      child.once('error',reject); child.once('exit',(exit,signal) => resolve(exit ?? (signal ? 128 : 1)));
    });
  } else if (process.platform === 'win32') {
    // Reuse DSH's standing ACL grants for an unchanged root set. Revocation is owned
    // by the workspace lifecycle, after affected children have stopped.
    const writeSid = workspaceWriteSid(policy.grant_key);
    const temporarySid = tempWriteSid(temp);
    grant = AclWriteGrant.create(writeSid);
    for (const root of policy.roots) grant.add(root,true);
    const tempGrant = AclWriteGrant.create(temporarySid);
    try {
      tempGrant.add(temp);
      sandbox = new AclSandbox({mode:'workspace-write',writableDirs:policy.roots,tempDir:temp,
        writeSid,tempWriteSid:temporarySid,manageDacls:false});
      await sandbox.init();
      // The pinned DSH runner sets the native environment before its restricted
      // child inherits it. Keep the same private-temp setup in this multi-root adapter.
      const api = await win32();
      for (const name of ['TMP', 'TEMP']) {
        if (api.setEnvironmentVariableW(name, temp) === 0) {
          throw new Error(`SetEnvironmentVariableW ${name} failed (Win32 ${api.getLastError()})`);
        }
      }
      code = (await sandbox.spawn({command:argv[0],args:argv.slice(1),stdio:'inherit'}).wait()).exitCode;
    } finally {sandbox?.dispose();tempGrant.dispose();}
  } else {throw new Error('Sandbox is available on macOS and Windows only');}
} catch (error) {
  console.error('computer-bridge-sandbox:', (error as Error).stack); code=127;
} finally {grant?.dispose();rmSync(temp,{recursive:true,force:true});rmSync(statePath);}
process.exitCode=code;
