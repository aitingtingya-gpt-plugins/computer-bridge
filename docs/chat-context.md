# Conversation context and large messages

The complete recent-message context and lossless `.txt` attachment contract (`payload_version=2`) applies to both ordinary Chat and Super Agent user messages. Semantic summaries, `chat.working_context`, `chat.maintenance`, and `chat.trace` remain exclusive to ordinary Chat; Super Agent retains its separate task dispatch, pending-input routing, and upstream role contract (`chat.task`).

## Complete recent messages

The v2 context contains the trigger or selected anchor and at most nine preceding raw messages, in chronological order. Message text is never sliced to a per-message character limit. Older complete messages and (in ordinary Chat) tool groups may be omitted to fit the budget; original saved messages, pending task inputs, and trace read APIs remain available.

The usual target is **200,000 UTF-8 bytes**, measured after JSON serialization. Webhook delivery also measures the complete outer event, not just `context`. The hard event limit is **262,144 bytes (256 KiB)**, as documented for [ChatGPT MCP Events](https://developers.openai.com/plugins/build/mcp-events). This is not a universal model context limit or the size limit of every MCP request and response.

The current trigger has priority over the usual target. If it fits the hard limit with the necessary envelope, it stays complete and inline, including when it alone exceeds 200,000 bytes. Historical messages, optional tool groups and summary text give way first. Both ordinary Chat and Super Agent `user_message` events use `payload_version=2` with a single canonical body in `data.context.current_message`; they do not duplicate the same text or attachments in top-level `data.text` / `data.attachments`.

If the minimal event cannot hold the trigger, its original UTF-8 bytes are saved as an ordinary `.txt` attachment through the existing upload, chunk and completion operations. The saved chat message then has an empty text body and the attachment, rather than a truncated copy or a second full copy in history. Upload completion verifies size and SHA-256; the stable message request key reuses the saved attachment and message after interruption. A receiving host must read the attachment when the task requires its content; receiving a file reference is not evidence that its full text has been read.

Attachment metadata must itself fit the event. Excessive metadata fails explicitly instead of silently discarding files. Large client input also needs the Web/TUI attachment upload path before exceeding an HTTP/MCP request limit.

## Real semantic summaries

`chat.summary` reads or writes a **host-provided** semantic summary. The gateway has no hidden summarizing model and does not substitute excerpts for a semantic summary. Until a host supplies a valid result, `summary` is null and the context reports `summary_status: not_generated`.

Writes require the current authorized model connection, a stable request key, `expected_revision`, `covered_through`, and source message IDs and/or trace IDs. Every cited source must exist in this chat and fall within the covered range. Versions are immutable; updating uses optimistic concurrency and may not move coverage backwards. An identical retry returns its original version even after an authorized connection change.

Write concise prose that preserves the user's confirmed goals, constraints, decisions and open questions. Distinguish the user's statements, assistant-reported results and uncertain inferences, and cite their sources. Preserve the host assistant's existing conversational style rather than inventing a new identity. Do not include credentials, private material from unrelated work, or unshared child-task history. Obvious credentials are rejected as a defense in depth, not a complete privacy classifier; the host still has to minimize and protect sensitive information.

A summary is context, not authorization, a delivery receipt, or proof that work finished. Its coverage does not advance the pending-input ledger. When a summary does not fit, its version reference remains available for retrieval.

## Conditional automatic semantic generation

After a successful ordinary `chat.reply`, the MCP adapter checks the **current authenticated caller's** advertised sampling capability. A capable legacy host is asked through `sampling/createMessage`; a modern host receives an `input_required` sampling request and returns through a server-validated continuation. The original reply is saved first. The continuation reads its original reply receipt and never executes `chat.reply` again.

Only messages falling outside the ten-message window are eligible. Each generation includes the previous semantic summary and a bounded source window, with same-chat tool groups when they fit. The request uses `includeContext: none`, no tools, and no provider credentials. It does not ask for private context from other chats. Attachments remain identified as unread unless their contents were actually supplied.

The source payload is limited to 60,000 serialized UTF-8 bytes per sampling request. When a single inline message cannot fit, its full text is supplied in ordered segments with explicit UTF-16 offsets that never split a surrogate pair. Each later segment carries the preceding working summary, marked as incomplete context. Every source character is supplied exactly once; raw history and ordinary Chat context remain unchanged. No partial message is saved as a completed summary, and coverage advances only after the final segment passes validation. Metadata that cannot fit still requires an external read. Segmented requests omit tool groups rather than silently cutting them.

The continuation ticket contains source IDs/hashes, an argument fingerprint, the writer identity, a version, segment range when applicable, and expiry, not source bodies or connection credentials. Every segment completion checks current chat access, the writer, source hashes, the summary revision and newer chat input. Rejected, malformed, truncated, oversized or credential-containing output is not saved or forwarded as a working summary. Each segment has a fresh single-use ticket. Replaying or cancelling a consumed ticket returns the current chain status without issuing another sampling request or rewriting a terminal result.

A rejection or unobserved sampling outcome stops automatic retries on that writer; it does not change permissions or undo the saved reply. A later reply with a different request key also detects an expired active ticket and preserves this stop, including when expiry occurs during an asynchronous state read. A lost segment continuation cannot silently restart production. Older completed operations retain their own generated receipts, and an explicitly authorized replacement writer has its own production state.

`chat.context` and `chat.resume` expose `host_capabilities.sampling` from the actual request envelope or initialization: `unobserved`, `not_advertised`, or `advertised`. **Advertised does not mean generation succeeded.** A saved summary identifies `generation.kind: mcp_sampling` only after a valid sampling response was received and stored. The local protocol tests simulate host responses and verify the real HTTP route; they do not prove that a deployed Work/Dot client advertises or allows sampling. Verify that separately through the connected deployment. Unsupported hosts can still converse, use attachments and explicitly supply a semantic summary.

## Historical snapshots and recovery

Reading `chat.context` or resuming a chat does not make its anchor a new incoming request. Fixed historical snapshots exclude later messages, later tool records and later-written summary versions. Real-time reads may include subsequently saved context; the response records its snapshot generation time.

For delayed work or recovery, separately inspect newer user directions, including cancellations and permission changes. Do not use a historical snapshot to restore superseded authority. Several pending inputs may be handled together and answered naturally, without a separate acknowledgment or reply for every message. Explicit quotation is a navigation relationship, not an execution-completion signal.

## Migration and checks

The new summary records are additive. Existing conversations have no invented summary, and unknown historical authors stay unknown. Existing raw history is not retrospectively rewritten merely to create a summary. Conversation deletion removes summary versions and their deduplication receipts along with the conversation's other records.

Run `npm run check --prefix gateway` and `npm run build --prefix gateway` to type-check and bundle the gateway context and summary pipeline. Automated contract and HTTP-route suites are maintained in the internal development repository; verifying an external host requires checking automatic summary generation or attachment reads directly through a connected deployment.
