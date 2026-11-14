/** An explicit server/tool rejection is not an uncertain transport outcome and must not be retried. */
export class HostRequestRejected extends Error {readonly outcome='rejected';constructor(message:string,readonly code?:string){super(message);}}
