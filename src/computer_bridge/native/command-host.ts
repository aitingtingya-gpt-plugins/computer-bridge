/** Host services for unchanged DSH tool, approval, job and sandbox execution. */
import {Context} from '@deepseek-ai/cordis'
import {ToolsService} from '@deepseek-ai/dsh-tools'
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as pwshTool from '@deepseek-ai/dsh-tool-pwsh'
import * as bashTool from '@deepseek-ai/dsh-tool-bash'
import {SandboxPwshExecutor} from '@deepseek-ai/dsh-pwsh-sandbox'
import {SandboxBashExecutor} from '@deepseek-ai/dsh-bash-sandbox'
import {ShellEnvRegistry} from '@deepseek-ai/dsh-shell-env'
import {LocalJobRegistry} from '@deepseek-ai/dsh-jobs-local'
import type {ShellExecution, ShellExecSpec} from '@deepseek-ai/dsh-shell'
import {appendFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

export interface CommandRequest {
  protocol: 1
  command: string
  cwd: string
  sandbox_prefix: string[]
  stdout_path: string
  stderr_path: string
  session?: string
  operation?: string
  description?: string
  sandbox_permissions?: string
  justification?: string
}

export class CommandHost {
  private readonly abort = new AbortController()
  private readonly execution = Promise.withResolvers<ShellExecution>()
  private pendingApproval: ((decision: string) => void) | undefined
  private jobId: any
  private owner: any

  constructor(private ctx: Context, private request: CommandRequest, private send: (value: unknown) => void) {}

  decide(decision: string): void {
    if (!this.pendingApproval) throw new Error('No native approval is pending')
    const complete = this.pendingApproval
    this.pendingApproval = undefined
    complete(decision)
  }

  stop(): void {
    this.abort.abort()
    this.pendingApproval?.('cancelled')
    this.pendingApproval = undefined
    if (this.jobId) this.ctx.jobs.kill(this.jobId, this.owner.id, 'Bridge command stopped')
  }

  async start(): Promise<ShellExecution> {
    const host = this
    const request = this.request
    const mode = request.sandbox_prefix.length ? 'workspace-write' : 'danger-full-access'
    const policy = {mode, workspaceRoot: request.cwd, sessionId: request.session}
    const sections = new Map<string, unknown>()
    const providers = new Set<unknown>()
    const session = {
      header: {id: request.session ?? request.operation, cwd: request.cwd},
      append(type: string, data: unknown) {
        appendFileSync(join(dirname(request.stdout_path), 'jobs.jsonl'), JSON.stringify({type, data}) + '\n')
      },
    }
    this.owner = {id: request.session ?? request.operation, session, ctx: this.ctx}
    await this.ctx.plugin((ctx: Context) => {
      ctx.provide('systemPrompt', {
        tools(provider: unknown) { providers.add(provider); return () => providers.delete(provider) },
        section(section: any) { sections.set(section.name, section); return () => sections.delete(section.name) },
        getSectionOrder() { return 0 },
      })
      ctx.provide('agents', {get(id: string) { return id === host.owner.id ? host.owner : undefined }})
      ctx.provide('workingDirectory', {async ensure() { return request.cwd }})
      ctx.provide('sandboxPolicy', {defaultMode: mode, resolve() { return policy }})
      ctx.provide('sandbox', {
        async confine(argv: string[], requested: any, signal: AbortSignal) {
          signal?.throwIfAborted()
          if (requested.mode !== 'workspace-write' || !request.sandbox_prefix.length) {
            throw new Error('Unsupported Bridge confinement policy')
          }
          return {argv: [...request.sandbox_prefix, ...argv],
            enforcement: process.platform === 'win32' ? 'partial' : 'full',
            denialSignatures: ['access is denied', 'access to the path', 'permission denied', 'operation not permitted'],
            runnerFailureRules: [{allowedExitCodes: [127], fatalSignatures: ['computer-bridge-sandbox: ']}]}
        },
      })
      ctx.provide('approval', {
        async request(approval: any) {
          return await new Promise<string>(resolve => {
            const cancel = () => { host.pendingApproval = undefined; resolve('cancelled') }
            host.pendingApproval = decision => {
              approval.signal?.removeEventListener('abort', cancel)
              resolve(decision)
            }
            approval.signal?.addEventListener('abort', cancel, {once: true})
            if (approval.signal?.aborted) { cancel(); return }
            host.send({event: 'approval_requested', reason: approval.reason})
          })
        },
      })
    })
    await this.ctx.plugin(ToolsService)
    await this.ctx.plugin(nativeExecutor)
    await this.ctx.plugin(ShellEnvRegistry)
    await this.ctx.plugin(LocalJobRegistry)
    this.ctx.jobs.attachController('bridge')
    const Executor = process.platform === 'win32' ? SandboxPwshExecutor : SandboxBashExecutor
    class ObservedExecutor extends Executor {
      override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
        try {
          // Bridge's interactive stdin is UTF-8. The unchanged DSH PowerShell
          // executor pins output encoding only; initialize this command's input
          // decoder before user code, after the original tool's approval step.
          const execution = await super.execute(process.platform === 'win32' ? {
            ...spec,
            command: '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); ' + spec.command,
          } : spec)
          host.execution.resolve(execution)
          return execution
        } catch (error) {
          host.execution.reject(error)
          throw error
        }
      }
    }
    // A startup error may precede the background tool's returned job ID.
    void this.execution.promise.catch(() => {})
    await this.ctx.plugin(ObservedExecutor, {cwd: request.cwd, maxOutputBytes: 4096})
    await this.ctx.plugin(process.platform === 'win32' ? pwshTool : bashTool)
    const outcome = await this.ctx.tools.execute({
      calls: [{type: 'tool_call', id: request.operation ?? 'bridge-command',
        name: process.platform === 'win32' ? 'pwsh' : 'bash',
        arguments: JSON.stringify({
          command: request.command, workdir: request.cwd,
          description: request.description ?? 'Execute the requested command in this workspace',
          run_in_background: true,
          ...(request.sandbox_permissions ? {sandbox_permissions: request.sandbox_permissions} : {}),
          ...(request.justification ? {justification: request.justification} : {}),
        })}],
      agent: this.owner, signal: this.abort.signal,
    } as any)
    const result = outcome.results[0]?.result
    if (!result || result.isError) throw new Error(result?.error.message ?? 'DSH command registration failed')
    this.jobId = (result.value as any).jobId
    if (!this.jobId) throw new Error('DSH command did not return a background job')
    const execution = await this.execution.promise
    this.send({event: 'job_registered', job_id: this.jobId})
    return execution
  }
}
