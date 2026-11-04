/** Bridge transport extensions around the unmodified DSH shell/process implementations. */
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { OutputCollector } from '@deepseek-ai/dsh-subprocess-local/output'
import {CommandHost, type CommandRequest} from './command-host.ts'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessCollect } from '@deepseek-ai/dsh-subprocess'
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { constants } from 'node:os'
import { Console } from 'node:console'

const request = JSON.parse(readFileSync(process.argv[2], 'utf8')) as CommandRequest
if (request.protocol !== 1) throw new Error('Unsupported command transport protocol')
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
globalThis.console = new Console({stdout: process.stderr, stderr: process.stderr})
const errorValue = (error: unknown) => ({
  code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'command_runtime',
  message: error instanceof Error ? error.message : String(error),
})

/** Only stdio and the existing sandbox envelope are adapted; DSH owns process execution. */
class BridgeCommandRuntime extends LocalSubprocessRuntime {
  handle: SubprocessHandle | undefined
  outputFailure: unknown
  private streams: {name: string; fd?: number; collector: OutputCollector; size: number; error?: ReturnType<typeof errorValue>}[] = []
  private recording = true

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const out = openSync(request.stdout_path, 'w', 0o600)
    const err = openSync(request.stderr_path, 'w', 0o600)
    const collect = (mode: SubprocessCollect | string, name: string, fd: number) => {
      if (typeof mode === 'string') throw new Error('DSH shell must request collected output')
      // Bridge persists the complete original stream; the original collector owns the visible tail.
      const result = new OutputCollector(mode.maxBytes, name)
      this.streams.push({name, fd, collector: result, size: 0})
      return result
    }
    const stdout = collect(spec.stdio.stdout, 'stdout', out)
    const stderr = collect(spec.stdio.stderr, 'stderr', err)
    const handle = super.spawn({
      ...spec,
      stdio: {...spec.stdio, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'},
    })
    this.handle = handle
    const record = (stream: typeof this.streams[number]) => (chunk: Buffer) => {
      try {
        if (this.recording && stream.fd !== undefined) {
          let offset = 0
          while (offset < chunk.length) offset += writeSync(stream.fd, chunk, offset, chunk.length - offset)
          stream.size += chunk.length
        }
        stream.collector.push(chunk)
      } catch (error) {
        stream.error = errorValue(error)
        this.outputFailure ??= error
        handle.terminate()
      }
    }
    for (const stream of this.streams) {
      const pipe = stream.name === 'stdout' ? handle.stdout! : handle.stderr!
      pipe.on('data', record(stream))
      pipe.once('end', () => this.closeStream(stream))
      pipe.once('close', () => this.closeStream(stream))
      pipe.once('error', error => { stream.error = errorValue(error); this.closeStream(stream) })
    }
    // EPIPE is returned by the specific input acknowledgement, never an unhandled stream error.
    handle.stdin!.on('error', () => {})
    return {...handle, collected: {stdout, stderr}}
  }

  seal(): void {
    this.recording = false
    for (const stream of this.streams) this.closeStream(stream)
  }

  private closeStream(stream: typeof this.streams[number]): void {
    stream.collector.seal()
    if (stream.fd !== undefined) {
      const fd = stream.fd
      stream.fd = undefined
      try { closeSync(fd) } catch (error) { stream.error = errorValue(error); this.outputFailure ??= error }
    }
  }

  outputStatus() {
    return Object.fromEntries(this.streams.map(stream => [stream.name, {
      size: stream.size, closed: stream.fd === undefined, ...(stream.error ? {error: stream.error} : {}),
    }]))
  }

  previews() {
    return this.streams.map(stream => {
      // Reuse DSH's bounded raw snapshot; only the Bridge text projection aligns
      // a truncated tail's start. Never trim replacement characters from text.
      const {bytes, totalBytes} = stream.collector.snapshot()
      let start = 0
      const truncated = totalBytes > bytes.length
      if (truncated) {
        while (start < Math.min(3, bytes.length) && (bytes[start]! & 0xc0) === 0x80) start++
      }
      return {text: bytes.subarray(start).toString('utf8'), truncated, size: totalBytes}
    })
  }
}

const ctx = new Context()
let runtime: BridgeCommandRuntime | undefined
let host: CommandHost | undefined
let stopping = false
let settled = false
const stop = () => {
  stopping = true
  host?.stop()
  runtime?.handle?.stdin?.destroy(new Error('command stopped'))
  runtime?.handle?.terminate()
}
const input = createInterface({input: process.stdin, crlfDelay: Infinity})
input.once('close', stop)
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
let controls = Promise.resolve()
input.on('line', line => {
  let message: {id?: number; method: string; text?: string; eof?: boolean; decision?: string}
  try { message = JSON.parse(line) } catch (error) { send({error: errorValue(error)}); return }
  if (message.method === 'approval') {
    try {
      if (!['allowed-once', 'rejected', 'cancelled'].includes(message.decision ?? '')) throw new Error('Invalid approval decision')
      host!.decide(message.decision!)
      send({id: message.id, result: {accepted: true}})
    } catch (error) { send({id: message.id, error: errorValue(error)}) }
    return
  }
  // Cancellation and output release must never queue behind a blocked stdin write.
  if (message.method === 'stop' || message.method === 'shutdown') {
    stop()
    send({id: message.id, result: {stopping: true}})
    return
  }
  if (message.method === 'release') {
    runtime?.seal()
    send({id: message.id, result: {released: true}})
    return
  }
  if (message.method === 'output_status') {
    send({id: message.id, result: runtime?.outputStatus() ?? {}})
    return
  }
  controls = controls.then(async () => {
    try {
      if (message.method === 'input') {
        const stream = runtime?.handle?.stdin
        if (!stream || stream.destroyed || stream.writableEnded || settled) throw new Error('stdin is unavailable')
        const bytes = Buffer.from(message.text ?? '', 'utf8')
        await new Promise<void>((resolve, reject) => stream.write(bytes, error => error ? reject(error) : resolve()))
        if (message.eof) await new Promise<void>((resolve, reject) => stream.end((error?: Error) => error ? reject(error) : resolve()))
        send({id: message.id, result: {written: bytes.length, eof: message.eof === true}})
      } else throw new Error('Unknown command control method')
    } catch (error) { send({id: message.id, error: errorValue(error)}) }
  })
})

try {
  await ctx.plugin(BridgeCommandRuntime)
  runtime = ctx.subprocess as BridgeCommandRuntime
  host = new CommandHost(ctx, request, send)
  const execution = await host.start()
  const shell = process.platform === 'win32' ? (ctx.shell as any).pwshPath : 'bash'
  if (stopping) execution.kill()
  send({event: 'started', shell})
  const result = await execution.result()
  const [stdoutPreview, stderrPreview] = runtime.previews()
  if (runtime.outputFailure !== undefined) throw runtime.outputFailure
  settled = true
  runtime.handle?.stdin?.destroy(new Error('command root exited'))
  await controls
  send({event: 'completed', result: {
    exit_code: result.exitCode ?? (result.signal ? 128 + (constants.signals[result.signal] ?? 0) : 1),
    shell,
    signal: result.signal,
    stdout_path: request.stdout_path, stderr_path: request.stderr_path,
    stdout_preview: {...result.stdout, text: stdoutPreview!.text, truncated: stdoutPreview!.truncated},
    stderr_preview: {...result.stderr, text: stderrPreview!.text, truncated: stderrPreview!.truncated},
    stdout_preview_size: stdoutPreview!.size, stderr_preview_size: stderrPreview!.size,
    output_status: runtime.outputStatus(),
  }})
  // Keep this actual DSH composition owned by Operations while descendants live.
  // Root completion is not composition disposal, and raw pipes keep draining.
  await runtime.handle?.waitForExit()
  await ctx.fiber.dispose()
  runtime.seal()
} catch (error) {
  await ctx.fiber.dispose().catch(() => {})
  runtime?.seal()
  settled = true
  send({event: 'failed', error: errorValue(error)})
  process.exitCode = 1
} finally {
  input.close()
  process.stdin.destroy()
}
