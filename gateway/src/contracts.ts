/** The single model-facing catalogue; plugin packages store only the MCP URL. */
import {z} from 'zod';

const retryKey=z.string().optional().describe('Stable caller retry key. Reuse with identical parameters to recover the original execution; never choose a new key just because a connection failed.');
const session = {request_key:retryKey,session:z.string().describe('Project session s1 returned by computer.open; not workspace w1.')};
const operation = {...session,operation:z.string().describe('Existing operation o1 returned by exec or web.')};
const context = z.string().optional().describe('Conversation context v1. Reuse across computer/project selections; omit in a new conversation.');
const device = z.string().describe('Computer ID c1 returned by computer.list; not its display name.');
const payload = z.record(z.string(),z.unknown());
const filePayload = z.object({
  path:z.string().optional().describe('Original absolute path or path relative to session. List/glob/search default to the session directory.'),
  file_ref:z.string().optional().describe('File ID f1, e.g. result.stdout. Use instead of path when reading command output.'),
  offset:z.number().int().nonnegative().optional().describe('Read: starting byte offset, default 0. Continue using the returned next_offset.'),
  length:z.number().int().positive().optional().describe('Read: optional byte window; omit to read all remaining bytes. UTF-8 windows preserve complete characters.'),
  version:z.string().optional().describe('Read: carry the previous page version to reject a changed file instead of mixing versions.'),
  line_offset:z.number().int().positive().optional().describe('Read text by DSH line window: first line, 1-based. Continue with next_line as line_offset; offset is bytes. Cannot combine with byte offset/length or binary.'),
  line_limit:z.number().int().positive().max(2000).optional().describe('DSH line window: maximum lines, default 2000, also bounded by the upstream output limits.'),
  binary:z.boolean().optional().describe('Read: true returns original bytes as Base64; otherwise returns UTF-8 text or binary-file metadata.'),
  text:z.string().optional().describe('Write: complete UTF-8 content, including empty text. Use text or base64.'),
  base64:z.string().optional().describe('Write: complete original bytes encoded as Base64, instead of text.'),
  sha256:z.boolean().optional().describe('Write/edit: explicitly compute the saved file SHA256. Default false; size and mtime are always returned.'),
  old:z.string().optional().describe('Edit: exact non-empty original text to replace.'),
  new:z.string().optional().describe('Edit: replacement text; empty string deletes the match.'),
  all:z.boolean().optional().describe('Edit: replace every match. Default false requires one match.'),
  patch:z.string().optional().describe('Patch: unified patch passed to git apply. Paths in the patch are relative to the selected working directory, including inside Git repository subdirectories; path selects that directory.'),
  destination:z.string().optional().describe('Move: destination original path, relative to the session or absolute.'),
  pattern:z.string().optional().describe('Glob: pathlib glob pattern relative to path, e.g. **/*.md.'),
  query:z.string().optional().describe('Search: literal text, or a regular expression when regex=true.'),
  regex:z.boolean().optional().describe('Search: interpret query as a regular expression; default false.'),
});

export const toolSpecs = [
  ['computer.recover','Recover an original request without re-executing it. Request IDs x1 come from interrupted-call errors. Omit request_id to list pending/unclaimed request metadata for this authorized computer. Completed result uses original session/operation/file IDs. Expired or unknown results are never replayed.',z.object({device_id:device,request_id:z.string().optional().describe('Original request x1 from an error; omit to list recent recoverable receipt metadata.'),seconds:z.number().min(0).max(30).optional().describe('Total server wait budget including delivery and reconnection, 1..30 seconds. Default 0 polls without waiting for execution; network query is bounded to 5 seconds. Timeout returns the original request and recovery arguments; it never repeats execution.')})],
  ['computer.list','List computer IDs c1, names, OS, version, online state, modules and grants. Includes connection_state (healthy/degraded/recovering/offline), latency_ms (server/computer round-trip, not command or GPT response time), latency_state (ok/timeout/offline/unavailable), latency_checked_at. Samples are shared for 5 seconds; failures return null milliseconds. No AGENTS.md text.',z.object({})],
  ['computer.lock_mode','Query or change this computer lock mode, default enabled. Enabled prevents automatic idle sleep while allowing display off and screen lock; remains enabled after unlock. Does not lock/unlock, wake a sleeping computer, or change file permissions. Returns enabled, applied and state (applied/pending/failed/update_required). Offline changes apply on reconnect.',z.object({device_id:device,enabled:z.boolean().optional().describe('Omit to query; true enables idle-sleep prevention, false releases it. Saved per computer across restarts.')})],
  ['computer.workspaces','Select a computer and list configured workspace IDs w1, paths and validation. Returns context v1 and changed system AGENTS.md.',z.object({device_id:device,context,request_key:retryKey})],
  ['computer.open','Open a project and return session s1. Restricted access requires workspace_id; full access also allows a direct path. Selected project AGENTS.md is delivered once per content version.',z.object({
    request_key:retryKey,device_id:device,workspace_id:z.string().optional().describe('Configured workspace w1 from computer.workspaces; required when full_access=false.'),
    path:z.string().optional().describe('Directory to open. With workspace_id defaults to its root; relative paths are based there. Full access without a workspace defaults to the user home.'),context,
  })],
  ['computer.files','Operate on original files. Read path or file_ref f1; ranges return next_offset/eof. Write/edit return written, size, mtime and optional SHA256. Read output with {session:"s1",operation:"read",payload:{file_ref:"f1"}}.',z.object({
    ...session,operation:z.enum(['list','glob','search','read','write','edit','patch','move','delete']).describe('Selects the payload fields described below.'),
    payload:filePayload.describe('Arguments for the selected file operation.'),research_session:z.string().optional().describe('Optional execution context supplied by an installed module.'),
  })],
  ['computer.skills','List adapted skill metadata k1 or read the selected original definition. Definitions and resources stay on the computer.',z.object({...session,operation:z.enum(['list','read']),id:z.string().optional().describe('Read: k1 from the skill list.'),path:z.string().optional().describe('Read: original skill file path, instead of id.')})],
  ['computer.agents','List adapted subagent metadata g1 or read the selected original definition for the current host.',z.object({...session,operation:z.enum(['list','read']),id:z.string().optional().describe('Read: g1 from the agent list.'),path:z.string().optional().describe('Read: original agent definition path, instead of id.')})],
  ['computer.present','Return one-hour download links for original files. Open links in a browser and sign in as the issuing account or an administrator; other users cannot reuse them, even for a shared computer. The issuer must retain access and the computer must remain online. The server does not store file contents.',z.object({...session,files:z.array(z.string()).describe('Original absolute or session-relative file paths; not file IDs.')})],
  ['computer.web','Fetch an HTTP(S) page on this computer. Returns operation o1; wait for converted text and raw/content file IDs. No search API.',z.object({...session,url:z.string().describe('HTTP(S) address to retrieve.')})],
  ['computer.jobs','List operations belonging to this project session, including their IDs, kind and state.',z.object(session)],
  ['computer.image','Return actual image content from an original path or a file ID.',z.object({...session,path:z.string().optional().describe('Original image path; alternatively supply file_ref.'),file_ref:z.string().optional().describe('Image file ID f1, instead of path.')})],
  ['computer.exec','Run a command on the selected computer. Waits at most 1 second for completion. Completed result includes exit_code, stdout_text/stderr_text (up to 4 KiB each), complete flags and full file IDs. Long output includes an executable *_read tool call; otherwise continue with computer.wait on the same operation.',z.object({...session,
    description:z.string().optional().describe('Short description of the requested command.'),
    sandbox_permissions:z.enum(['danger-full-access']).optional().describe('On a restricted computer, request one user-approved command outside the workspace sandbox. Accept approves once, with no checkbox. Administrator full access executes directly without this approval. Omit for normal confined execution.'),
    justification:z.string().min(1).optional().describe('Explain why this exact command needs wider access. Required with sandbox_permissions.'),
    command:z.string().describe('Actual command for this computer shell: macOS shell or Windows PowerShell.'),
    cwd:z.string().optional().describe('Working directory, absolute or relative to this session; default session root.'),
    request_key:z.string().optional().describe('Caller-selected retry key. Repeating it in the same session reuses the existing operation.'),
    research_session:z.string().optional().describe('Bound Work Tree role r1 when executing research work; otherwise omit.'),
  })],
  ['computer.input','Write UTF-8 stdin to the existing command. Does not restart it.',z.object({...operation,text:z.string().describe('Actual text to write, including any needed newline.'),eof:z.boolean().optional().describe('Close stdin after writing; default false.')})],
  ['computer.wait','Wait on an existing operation without repeating it. Completed commands return exit_code, visible stdout/stderr, full file IDs and continuation calls. Read a file ID with computer.files, not a new shell command. Result files remain until release unless consume=true.',z.object({...operation,
    seconds:z.number().optional().describe('Wait duration, default 1 second, clamped to 0..30. A timeout leaves the operation running.'),
    consume:z.boolean().optional().describe('Explicitly delete completed operation/output files. Default keeps command output for reading; do not consume when continuation is needed.'),
  })],
  ['computer.stop','Stop only this existing command on its original computer. Use wait for its settled result, then release.',z.object(operation)],
  ['computer.release','Delete this completed operation and its local result files; its file IDs can no longer be read. Stop a running command first.',z.object(operation)],
  ['computer.modules','List optional modules and their installed/enabled state. Does not activate modules.',z.object(session)],
  ['computer.module_tools','Read an enabled module action catalogue. Use only parameters returned by the selected module.',z.object({...session,module:z.string().describe('Module ID from computer.modules.'),payload:payload.optional().describe('Module-specific catalogue parameters from its instructions.')})],
  ['computer.module_call','Call a discovered optional module action. Use module_tools for its exact payload. Ordinary files and commands do not activate Work Tree.',z.object({...session,module:z.string().describe('Enabled module ID.'),action:z.string().describe('Action name from computer.module_tools.'),payload:payload.optional().describe('The chosen action parameters; IDs and permissions follow the module catalogue.')})],
] as const;

export const serverInstructions = 'On interrupted calls use the supplied computer.recover invocation. Keep request_key unchanged when retrying mutations; a transport failure does not mean the operation did not execute. Lock mode defaults on; query/change computer.lock_mode(device_id,enabled?). It prevents idle sleep without locking/unlocking or expanding file access. Saved/pending is not applied. List computers c1, select with workspaces, open a project for session s1. Restricted access requires workspace_id w1; full access also accepts paths. Carry context v1 across computer/project selections in this conversation; AGENTS.md is scoped and delivered once per content version. New conversations omit context. A command awaiting_approval has not executed. Follow its confirmation flow or management URL and wait on its original operation. Never repeat a failed command with its original request_key to request wider permissions. Commands return an existing operation o1 and may finish immediately; wait never repeats a command. Completed output includes text previews and full file IDs f1. Follow *_read continuation calls or use files(operation="read",payload={file_ref:"f1"}); release only after consuming output. Skills k1 and agent definitions g1 are original files, used by the current host. Discover installed optional modules only after selecting the target computer and workspace.';
export const helpText = 'list -> workspaces(device_id="c1") returns context v1 -> open(device_id="c1",workspace_id="w1",context="v1") returns session s1. Carry context across selections; full access also permits paths. exec returns an operation and, if finished in one second, its result. Otherwise wait(session="s1",operation="o1"). Short stdout_text/stderr_text is inline. Long output includes *_read containing the exact tool and arguments for files(read); repeat using next_offset until eof=true. Full file read: files(session="s1",operation="read",payload={file_ref:"f1"}). Original bytes: add binary=true. release deletes operation output. Skills/agents list metadata; read k1/g1 for original definitions. Optional modules are explicit.';
export const promptText = 'List computers, select the intended one with workspaces, then open the requested project. Reuse context across selections, and session for its operations. Read visible command results directly; follow returned continuation calls for long output without redirecting or re-executing it. Read original skills/agent definitions on demand. Do not create .work automatically.';
