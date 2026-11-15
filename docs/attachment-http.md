# Server chat attachment HTTP transfer

These endpoints store chat attachments on the server. They are not remote-computer filesystem upload/download APIs. Existing JSON/Base64 attachment methods remain supported. New tus uploads must be written through tus, not the legacy chunk endpoint.

## Protocol surface

- `OPTIONS /chat/uploads/tN`: authenticated discovery; tus 1.0.0, `creation`, maximum 1 GiB.
- `POST /chat/uploads/tN`: `Tus-Resumable: 1.0.0`, known `Upload-Length`, optional `Upload-Metadata` (`filename` and `filetype`, UTF-8 encoded as Base64). Empty body only. Returns 201 and Location. Zero-length files complete immediately.
- Optional `Idempotency-Key` deduplicates a lost creation response within the existing upload retry window. Its repeated metadata must match. Browser requests use this header so a retry does not create another attachment.
- `HEAD /chat/uploads/tN/aN`: current durable Upload-Offset and Upload-Length.
- `PATCH` same resource: `application/offset+octet-stream` and exact Upload-Offset. Arbitrary offsets and patch lengths work, including partial storage chunks. 8 MiB maximum per PATCH. After interruption clients must HEAD and resume the committed prefix, not assume the entire PATCH was rolled back. Completion is automatic at Upload-Length.
- Existing `/chat/files/tN/aN` supports GET/HEAD, single byte ranges (including suffix and open-ended ranges), 206/416, SHA-256 strong ETag and exact strong If-Range matching. Stale/weak/date If-Range causes a full response. Invalid or multiple ranges are ignored, yielding 200.

No optional tus checksum, creation-with-upload, deferred-length, concatenation or termination extension is advertised. Expiration exists as internal cleanup policy, not the tus expiration extension. Uploads expire after 24 hours without committed progress. At most 16 unfinished uploads per chat and 8 active PATCH streams per service instance. Concurrent requests for one upload return 409; transactional offset checks protect across instances. PATCH idle timeout is 30 seconds, maximum request duration is five minutes. Limits apply to new tus resources; the legacy API retains existing compatibility.

Authentication and device grants apply at the HTTP boundary, at creation, for every committed storage chunk, during final digest calculation, and on each downloaded chunk. Browser mutations require the existing same-origin/CSRF boundary. No bearer token is embedded in Location. Metadata is bounded and rejected if malformed or containing control characters. Downloads remain no-store and nosniff.

## Storage and durability

Storage chunks remain 256 KiB. Only one bounded partial chunk is merged in memory at a time. Binary HTTP bodies are consumed incrementally; no whole-file buffering/Base64 envelope is used. Backpressure comes from awaiting each storage transaction before reading more network data. The network adapter must also preserve streaming.

SQLite/Store metadata commits the visible offset only after the corresponding chunk write resolves. Node blob writes fsync the temporary file, atomically rename it, then fsync containing/ancestor directories before returning. This requires a server filesystem supporting these operations; failures do not advance the offset. Any bytes written before a failed metadata transaction are uncommitted tail bytes: the next append discards everything beyond the recorded offset. Completed objects are immutable. Store implementations must serialize transactions and durably commit them; multi-process deployments additionally need a store implementation providing cross-process serialization. The in-memory concurrency limit is not a distributed quota.

On Windows, Node cannot portably fsync a directory. The backend therefore writes
bounded chunks into `chat-attachment-chunks.sqlite3` with SQLite FULL synchronous
commits before acknowledging the metadata offset. It continues to read legacy
disk chunks when no replacement exists in SQLite. Each operation closes its
database handle. This preserves Windows server support without claiming that an
unsupported directory fsync succeeded. Real Windows filesystem verification is
still part of release qualification.
