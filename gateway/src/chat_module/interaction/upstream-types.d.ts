// The portable excerpts need only these host type boundaries, not a DSH runtime.
declare module '@deepseek-ai/dsh-agent' { export interface Agent {} }
declare module '@deepseek-ai/dsh-goal' { export type GoalView = import('./vendor/types').GoalView; }
declare module '@deepseek-ai/dsh-brand' { export type Branded<T extends string> = string & { readonly brand: T }; }
declare module '@deepseek-ai/dsh-session/types' {
  export type SessionId = string;
  export interface SessionEventMap {}
}
declare module '@deepseek-ai/dsh-session' {
  export type SessionEvent = {type:'goal/change';seq:number;data:unknown}
    |{type:'user/message';seq:number;data:{source:import('@deepseek-ai/dsh-llm').MessageSource}};
}
declare module '@deepseek-ai/dsh-llm' {
  export interface MessageSourceMap { user:{kind:'user'} }
  export type MessageSource = MessageSourceMap[keyof MessageSourceMap];
  export type ContentBlock = {type:'text';text:string};
}
declare module '@deepseek-ai/cordis' { export interface Events {} }
declare module '@deepseek-ai/dsh-scope' { export type Scoped<T> = T; }
declare module '@deepseek-ai/dsh-commands/brand' { export type CommandId = string; }
declare module '@deepseek-ai/dsh-session-projection/types' {
  export interface SessionProjectionStateMap {}
  export interface SessionProjectionMap {}
}
declare module '@deepseek-ai/dsh-session-projection' {
  type PlanEvent = {type:'command/run';data:{name:string;args?:string;commandId:string}}
    |{type:'command/done';data:{kind:string;commandId:string}}
    |{type:'plan/mode';data:{active:boolean}}
    |{type:'request/header';data:Record<string,never>};
  export interface ProjectionDefinition<K extends string,S> {
    key:K;stateVersion:number;stateSchema:unknown;init:()=>S;apply:(state:S,event:PlanEvent)=>S;
    wire:{viewSchema:unknown;view:(state:S)=>unknown};
  }
}
