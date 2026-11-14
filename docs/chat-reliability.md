# Ordinary Chat reliability

This bookkeeping is separate from Super Agent dispatch, conversation context and semantic summaries. It does not execute work, require a task claim, or automatically replay an external operation.

## Independent evidence

- Saved history proves server persistence.
- Notification `received` means the signed webhook returned HTTP 2xx. It does not prove that a model read the message or started work.
- Processing `pending` is created transactionally with each new ordinary Chat user input. `active`, `blocked` and `resolved` are explicit host reports, identified as `host_reported`, not independently verified execution.
- A saved reply is independent of processing completion. Acknowledgements and progress never close an input by themselves. The host may resolve several inputs with one answer or explicitly report that no separate reply is needed.
- An absent processing record is `legacy_unknown`. Existing `replied_at` values are not migrated into completion claims. Old history is not automatically replayed.

The pending ledger survives context-window eviction, summary updates and service restarts. It has its own pagination and global unresolved count. `legacy_untracked_through` identifies the pre-ledger history boundary without manufacturing processing observations for it.

## Interfaces

- `chat.pending`: page unresolved inputs with `after`/`limit`, or inspect one `message_id`. The response includes the current ledger `revision` and `latest_sequence`.
- `chat.processing`: record a genuine observation for a batch of input IDs with the current writing connection, `expected_revision` and a stable `request_key`. A later user input changes the revision, preventing stale completion. `blocked` schedules no retry, and a resolved input cannot be reopened as a new request.
- `chat.reply`: `reply_to` is an optional citation. Optional `resolves_message_ids` plus `expected_revision` atomically save a combined reply and resolve only the named inputs. A failed transaction rolls back the reply, processing changes and retry receipt together.
- `chat.receipt`: read the saved result by the original reply `request_key`, without a writing connection but with current chat authorization. `not_found` says nothing about external side effects. It is not permission to invent a new key or repeat an operation.

A reply's logical identity is independent of a temporary writer generation. An authorized replacement writer may retrieve/retry the identical logical reply without creating a second message. Legacy writer-bound fingerprints are reconciled against the exact saved body, attachments and citation; changed content still conflicts. Current access and writing authority are checked before any replay receipt or mutation is returned.

Resolution also retires every named input's queued notification in the same transaction. Delivery checks resolution again immediately before starting HTTP delivery, so subscription refresh and service recovery do not turn completed inputs into fresh triggers. A callback already sent cannot be recalled; the stable event ID and current pending ledger remain the recovery evidence. Batched replies record each resolved input's reply-save timing without requiring a citation to each input.

## Recovery boundaries

Before recovery, inspect the latest user directions, cancellations and authorization changes, then inspect uncertain effects. Do not interpret a summary, queued input, timer, or lease as renewed authorization. Approval-review failures that occur before a tool executes may be invisible to Bridge. Record them only if the host actually reports them; otherwise the stage remains unknown. There is no approval bypass or fallback executor.

Ordinary Chat v2 events carry the complete current text and attachments once, at `data.context.current_message`. The event is measured after JSON serialization in UTF-8. A trigger that fits the verified 256 KiB webhook limit remains complete even when it exceeds the preferred 200000-byte context budget. An oversized trigger is saved through the existing ordinary attachment lifecycle with exact UTF-8 bytes, checksum and stable upload key; history then contains the attachment rather than a truncated text prefix. Callback delivery is not a claim of recipient reading.

## Verification and remaining limits

The integration tests exercise real SQLite transactions, pending pagination beyond 100 inputs, restart recovery, batched answers, no-reply dispositions, stale completion, legacy receipts, authorized writer changes, current ACL checks, transaction rollback, exact event sizing, normal attachment readback and concurrent identical send retries. They do not claim a real Work/Dot model integration, live webhook delivery or deployed Mac/Windows acceptance.

The actual MCP handler can now capture its own `computer.*` calls and returned results when the caller explicitly supplies an authorized ordinary Chat binding. `server_observed` proves gateway arrival and return, not a new external execution. Retries retain the underlying original request key and share a logical call ID while keeping their distinct observed responses. The capture path does not replace tool permissions or approval. Invalid chat binding is rejected before the action; optional record-storage failure cannot turn an already performed action into a retryable failure. Capture never guesses a destination, reads other plugins, or copies private Super Agent task data.

The host must actually supply `chat_context` containing this chat's `chat_id`, current `connection`, and real `source_message_ids` on each intended `computer.*` call. Default `capture: metadata` omits command and output bodies; `capture: content` is an explicit authorized choice, not a complete sensitive-data filter. A connected host whose refreshed tool schema lacks `chat_context` cannot use this capture path. Ordinary unbound calls remain unrecorded even if the caller has a chat connection. Deploying this gateway and refreshing the tool catalog are necessary but not sufficient: acceptance must also observe the real host sending a binding and receiving a recorded `chat_trace` receipt. Host-native tools and other plugins remain outside this gateway's observation boundary.

Semantic summary generation uses only the requesting MCP host's advertised sampling interface, after a reply is durably saved. Opaque server-side continuation tickets prevent replaying the reply while sampling completes. A real host capability/result must be observed before claiming that production works there; test-host success is not Work/Dot deployment acceptance. Processing observations still require explicit host reports. Host approval failures before a request reaches this gateway remain unobservable unless reported.
