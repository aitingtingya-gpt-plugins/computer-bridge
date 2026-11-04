// Integration signatures for the pinned upstream exports. Their implementations are
// bundled from UPSTREAM.json; this file supplies no replacement runtime behavior.
declare module 'bridge-seatbelt' {
  export function seatbeltProfileArgs(policy:{mode:'workspace-write';workspaceRoot:string;additionalRoots:string[]}):string[];
}
declare module 'bridge-windows' {
  export class AclWriteGrant {
    static create(sid:string):AclWriteGrant;
    add(path:string,standing?:boolean):void;
    dispose():void;
  }
  export class AclSandbox {
    constructor(options:{mode:'workspace-write';writableDirs:string[];tempDir:string;writeSid:string;tempWriteSid:string;manageDacls:boolean});
    init():Promise<void>;
    spawn(options:{command:string;args:string[];stdio:'inherit'}):{pid:number;wait():Promise<{exitCode:number}>};
    dispose():void;
  }
  export function workspaceWriteSid(path:string):string;
  export function tempWriteSid(path:string):string;
}
declare module 'bridge-roots' {
  export function writableRoots(policy:{mode:string;workspaceRoot:string}):string[];
}
declare module 'bridge-html' {
  export function convertHtml(html:string):string;
}
declare module 'bridge-html-runtime' {
  export function convertHtml(html:string):string;
}
