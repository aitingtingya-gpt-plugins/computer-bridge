/** Bridge protocol only. File storage and text windows are the original DSH implementations. */
import {Context} from '@deepseek-ai/cordis';
import {LocalFileSystem} from '@deepseek-ai/dsh-fs-local';
import {LocalSubprocessRuntime} from '@deepseek-ai/dsh-subprocess-local';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {Console} from 'node:console';
import {buildWindow, type WindowResult, READ_MAX_BYTES, READ_MAX_LINE_LENGTH} from './third_party/dsh-tools/packages/fs/tool-fs/src/read-render.ts';
import {buildGlobCommand, parseGlobArgs} from './third_party/dsh-tools/packages/fs/tool-fs-search/src/glob.ts';
import {buildGrepCommand, parseGrepArgs, parseGrepMatches} from './third_party/dsh-tools/packages/fs/tool-fs-search/src/grep.ts';
import {runRipgrep, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS, SEARCH_STDERR_MAX_BYTES, SEARCH_TIMEOUT_MS} from './third_party/dsh-tools/packages/fs/tool-fs-search/src/search-core.ts';

globalThis.console = new Console({stdout: process.stderr, stderr: process.stderr});
const ctx = new Context();
await ctx.plugin(LocalFileSystem, {cwd: process.cwd()});
await ctx.plugin(LocalSubprocessRuntime);
const fs = ctx.fs;

type Request = {operation: string; path: string; args: Record<string, any>};

function formatLineRead(path: string, offset: number, window: WindowResult): string {
  const end = window.lines.at(-1)?.number ?? Math.max(0, offset - 1);
  const footer = window.truncatedByBytes
    ? `(Output capped. Showing lines ${offset}-${end}. Use line_offset=${end + 1} to continue.)`
    : end < window.totalLines
      ? `(Showing lines ${offset}-${end} of ${window.totalLines}. Use line_offset=${end + 1} to continue.)`
      : `(End of file - total ${window.totalLines} lines)`;
  const body = window.lines.length
    ? `${window.lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}`
    : footer;
  return `<path>${path}</path>\n<type>file</type>\n<content>\n${body}\n</content>`;
}

async function execute({operation, path, args}: Request) {
  if (operation === 'patch') {
    const child = ctx.subprocess.spawn({argv: args.argv, cwd: path, graceMs: 3000,
      stdio: {stdin: {data: args.patch}, stdout: {maxBytes: 65536}, stderr: {maxBytes: 65536}}});
    const outcome = await child.done;
    await child.waitForExit();
    return {exit_code: outcome.exitCode, stdout: child.collected.stdout?.readFrom(0).text ?? '',
      stderr: child.collected.stderr?.readFrom(0).text ?? ''};
  }
  const target = await fs.resolve(path);
  if (operation === 'write') return fs.writeText(target, args.text);
  if (operation === 'edit') return fs.editText(target, {
    oldString: args.old, newString: args.new, replaceAll: args.all === true,
  });
  if (operation === 'list') return {entries: (await fs.listDir(target)).map(entry => ({
    path: fs.processPath(entry.target), directory: entry.type === 'directory',
  }))};
  if (operation === 'glob' || operation === 'search') {
    const input = operation === 'glob'
      ? parseGlobArgs({pattern: args.pattern, path: fs.processPath(target)})
      : parseGrepArgs({pattern: args.query, path: fs.processPath(target)});
    const argv = operation === 'glob' ? buildGlobCommand(input as any) : buildGrepCommand(input as any);
    // Literal search is an existing Bridge parameter. Keep it a ripgrep argv flag.
    if (operation === 'search' && !args.regex) argv.unshift('--fixed-strings');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('search timeout')), SEARCH_TIMEOUT_MS);
    try {
      const result = await runRipgrep(ctx, {signal: controller.signal} as any, operation === 'glob' ? 'glob' : 'grep',
        argv, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS, SEARCH_STDERR_MAX_BYTES);
      if (operation === 'glob') return {entries: result.stdout.split('\n').filter(Boolean).map(path => ({
        path: resolve(path), directory: false,
      }))};
      return {matches: parseGrepMatches(result.stdout).map(match => ({path: resolve(match.path), line: match.lineNumber, text: match.line}))};
    } finally { clearTimeout(timer); }
  }
  const before = await fs.stat(target);
  if (!before || before.type !== 'file') throw Object.assign(new Error('请选择实际文件'), {code: 'FS_NOT_REGULAR_FILE'});
  if (args.version !== undefined && args.version !== before.version)
    throw Object.assign(new Error('文件在分段读取期间发生变化，请从头重新读取'), {code: 'file_changed'});
  let result;
  if (operation === 'read') {
    const offset = args.offset ?? 0;
    const length = args.length ?? Math.max(0, before.size - offset);
    const bytes = await fs.readByteRange(target, {offset, length});
    const sample = offset === 0 ? bytes.subarray(0, 8192) : await fs.readByteRange(target, {offset: 0, length: 8192});
    result = {base64: Buffer.from(bytes).toString('base64'), sample: Buffer.from(sample).toString('base64'),
      version: before.version, size: before.size, next_offset: offset + bytes.byteLength, eof: offset + bytes.byteLength >= before.size};
  } else if (operation === 'read_lines') {
    const offset = args.line_offset ?? 1, limit = args.line_limit ?? 2000;
    if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000)
      throw Object.assign(new Error('line_offset 必须为正整数；line_limit 必须为 1..2000'), {code: 'read_range'});
    const window = await buildWindow(await fs.streamText(target), {
      offset, limit, maxLineLength: READ_MAX_LINE_LENGTH, maxBytes: READ_MAX_BYTES,
    }, fs.processPath(target));
    const next = offset + window.lines.length;
    result = {text: formatLineRead(fs.processPath(target), offset, window), lines: window.lines,
      total_lines: window.totalLines, next_line: next, eof: next > window.totalLines,
      truncated: window.truncatedByBytes, version: before.version, size: before.size};
  } else throw new Error(`Unknown file operation: ${operation}`);
  const after = await fs.stat(target);
  if (!after || before.version !== after.version)
    throw Object.assign(new Error('文件在读取期间发生变化，请重新读取'), {code: 'file_changed'});
  return result;
}

try {
  for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
    try { process.stdout.write(JSON.stringify({result: await execute(JSON.parse(line))}) + '\n'); }
    catch (error) { const failure = error as Error & {code?: string}; process.stdout.write(JSON.stringify({error: {
      code: failure.code ?? failure.name, message: failure.message,
    }}) + '\n'); }
  }
} finally { await ctx.fiber.dispose(); }
