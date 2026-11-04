---
name: computer-bridge
description: Operate an explicitly selected registered computer through original files and local commands, without activating Work Tree.
---

1. Call `computer.list`, then `computer.workspaces(device_id="c1")`. Keep the returned `context` (v1)
   for this conversation; pass it to every subsequent `computer.workspaces` and `computer.open`,
   including when switching to another computer or returning to a previous project. This keeps
   AGENTS.md delivery once per content version across those switches. A new conversation starts
   without a context. System instructions apply only to their computer; project instructions apply
   only to their project. The computer list never contains their text. Restricted computers require
   `computer.open(device_id="c1", workspace_id="w1")`; full access also permits a direct path.
   Select the editable display name the user means, then use its short ID, e.g.
   `computer.open(device_id="c2", path="D:\\Projects\\Example")`. Names may change; IDs remain stable.
   Use that returned workspace `session` in all file, terminal and module calls. The response reports
   the actual system, user and shell. Administrator workspaces grant writes; reads and networking remain unrestricted. Directory changes do not expand grants.
2. Use `computer.files(session, operation, payload)` for original files:
   - `list`: `path` (default `.`).
   - `search`: `path`, `query`, optional `regex` (boolean); returns matching lines, not rewritten excerpts.
   - `read`: `path` or `file_ref` (e.g. `f1`); original text and newlines are preserved.
     Optional `offset`/`length` select a byte window; continue with returned `next_offset` and `version` until `eof`.
     Without a range the full remainder is returned. `binary: true` explicitly returns Base64 bytes.
     For line pagination use `line_offset`/`line_limit`, then pass `next_line` as the next `line_offset`
     with the returned `version`. Do not use byte `offset` to continue a line window.
   - `write`: `path` and `text` or `base64`; an empty text intentionally clears that file.
   - `edit`: `path`, exact `old`, `new`, optional `all: true` for every occurrence.
   - `patch`: `path` (patch working directory) and standard unified `patch`; uses the computer's Git.
     Patch paths are relative to that directory even inside a Git repository subdirectory.
   - `move`: `path`, `destination`; `delete`: `path` (file).
   Paths inside the working directory are relative to it. Use `computer.image(session, path)` or `file_ref` to view the actual image.
3. Use `computer.exec(session, command, cwd?, request_key?)`. macOS runs the local shell; Windows runs
   PowerShell. Git and other programs are the target computer's programs. Commands return an `operation` such as `o1`.
   Exec waits up to one second and includes the result if completed. Otherwise keep that operation and wait.
   `computer.input(session, operation, text, eof?)` writes standard input.
   `computer.wait(session, operation, seconds?, consume?)` checks that same operation; it does not rerun it.
   Completed results include `exit_code`, `stdout_text`/`stderr_text` (at most 4 KiB per stream),
   `stdout_complete`/`stderr_complete`, and full `stdout`/`stderr` file IDs. Read short output directly.
   For longer output, follow the exact `stdout_read`/`stderr_read` tool and arguments, then advance
   its payload.offset to the returned next_offset until eof. Do not redirect the command or run it again.
   A full read is `computer.files(session="s1", operation="read", payload={"file_ref":"f1"})`.
   `consume=true` explicitly deletes completed command output, so omit it while continuation is needed.
   Write/edit receipts include saved size and mtime; request payload.sha256=true only when a digest is wanted.
   Release consumed results with
   `computer.release`; stop only the requested command with `computer.stop`.
   On a restricted computer, request wider access for one command with
   `sandbox_permissions="danger-full-access"` and `justification`. Accepting the confirmation
   approves that command once, including its child processes and subsequent stdin. There is no
   checkbox or permanent command approval. Wait on the returned original operation; do not rerun it.
   Administrator full access executes commands directly without this approval, even if the
   wider-access parameters are present. Following ordinary commands on a restricted computer
   remain confined after a one-command approval.
4. Use a stable request_key for writes, commands and other mutations. Repeat the same key and arguments
   to retrieve the original execution; do not choose a new key because a response was lost. On interrupted
   calls follow the returned computer.recover(device_id, request_id, seconds?) invocation. Request IDs x1
   retain the original session/operation/file IDs. Omitting request_id lists recent recoverable metadata.
   Positive seconds (1..30) bound the entire server wait, including network/reconnection. Default 0
   polls with a five-second network limit. delivery_unconfirmed is not proof of non-execution;
   received means previously registered, completed_unclaimed means the result still needs retrieval.
   Continue the supplied recovery call with the same request ID. Only a device-confirmed
   not_received provides a request_key for retrying the original call; unknown/expired never replays it.
   Keep waiting on an existing operation. Released command outputs cannot be recovered or recreated.
5. Ordinary computer work requires no Work Tree initialization, research scan or module activation.
   When research is explicitly requested, inspect `computer.modules` and use the research Skill.
6. Lock mode defaults on per computer. Query `computer.lock_mode(device_id="c1")`; set `enabled=false`
   to allow normal idle sleep, or true to keep the computer awake while its screen can lock/turn off.
   This is independent of file grants, persists after unlock/restart and never locks, unlocks or wakes
   a sleeping computer. Read `applied` and `state`; offline changes wait for reconnect. Windows
   Modern Standby battery policies can limit the request. Do not report saved/pending as applied.

`computer.list` includes `connection_state`, `latency_ms`, `latency_state` and `latency_checked_at` per computer.
This is the service/computer round trip, shared for five seconds, not command/GPT response time.
An open connection can still have high latency or a timed-out probe. A null value is not zero latency.

Report the actual computer and files changed. Device offline and actual process errors must be shown as such.

Use `computer.skills(operation="list")` to discover skills through registered adapters, then read
the selected `id` (k1). Use `computer.agents` the same way for subagent definitions (g1).
Read the original definition and its resources, then use the current host's native execution.
Definitions are read directly from `.work` and the enabled external sources; querying creates no `.work`.
Use `computer.web` to fetch a URL, then wait and read its full raw/content file references.
Use `computer.present(session, files=[...])` to return downloadable final files.
Open the link in a browser and sign in as the account that generated it or an administrator.
Links expire after one hour and stop working if the issuing account loses access.
They cannot be reused by another ordinary user, including someone sharing the same computer.
Use `computer.jobs` to list this session's existing command/web operations.
Never ask the model to change administrator directory grants or bypass a denied write.
