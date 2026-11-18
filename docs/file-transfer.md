# Direct executor ↔ computer file transfer

This channel transfers original files between the executor and an authorized
computer. Bytes do not pass through model messages. The gateway forwards one
bounded chunk at a time; it stores routing and authorization metadata, not a
second copy of the file. Server chat attachments are a separate feature, described
in [attachment-http.md](attachment-http.md).

## Executor workflow

1. Materialize the source attachment on the executor using its supported file
   service. Do not assume a path on another executor refers to the same file.
2. For an upload, run `python scripts/transfer_file.py prepare-upload SOURCE`.
   It returns the exact size and SHA256 without printing file bytes.
3. Call `computer.transfer` with the selected project session, `action` equal to
   `upload_begin`, destination `path`, exact `size`, `sha256`, and a stable
   `request_key`. Replacing an existing file requires `overwrite: true` and the
   user's authorization. For a download, call `download_begin` with the source
   path and stable request key.
4. Complete any existing computer tool approval. A denied or pending begin has
   not authorized the data channel. Successful begin returns the transfer metadata
   and `http` configuration.
5. Save that result as a private JSON file (Unix mode 0600), or feed it on stdin.
   Never print or post its Authorization header, put it in a URL or process
   argument, or save it in project source control.
   The source/installation packages include `transfer_file.py`. An executor that
   has no checkout can GET `http.client_url` using the same private `http.headers`,
   reject redirects, save the returned script, and verify its SHA256 against
   `http.client_sha256` before running it. This endpoint requires the original
   capability and current authorization, and contains no account or device key.
6. Run one of:

   ```sh
   python scripts/transfer_file.py upload SOURCE --ticket PRIVATE_RESULT.json
   python scripts/transfer_file.py download DESTINATION --ticket PRIVATE_RESULT.json
   ```

   `--ticket -` reads JSON on stdin. Local downloads do not overwrite an existing
   destination unless `--overwrite` is explicitly supplied. The helper prints only
   progress, size, digest, and completion state. It does not use a browser login,
   account password, device key, or OAuth token.

If transport fails, keep the same file and begin request. The helper asks the
server for the durable offset before uploading another chunk. Downloads use a
private `.bridge-part` file, a metadata sidecar, and a pinned ETag to resume.
After an hour, recovering/repeating the same authorized begin can issue a new
short-lived HTTP credential; do not start a different upload to work around an
unknown result. `computer.recover` remains the first step for an uncertain MCP
begin result.

## Authorization boundary

`computer.transfer` inherits the stricter of its own rule and `computer.files`.
An approval names one source/destination, direction, size, digest and overwrite
decision. It authorizes only that transfer's data operations, not arbitrary later
file writes. The agent stores that decision internally; request payloads cannot
claim they are approved. The HTTP capability is limited to one transfer for one
hour. It is HMAC-authenticated and bound to account epoch, device, project session
and access revision. Account invalidation, revoked device access, changed rules
or changed workspace revision stop it. These checks run before and after every
bounded RPC. The computer also rechecks its path and permission state.

The URL contains only an opaque identifier. Its bearer signature is a private
short-lived capability, not an account credential. There are no permissive CORS
headers, redirects, generic URL-fetch inputs, or endpoints that accept replacement
paths or sessions. The executor helper refuses redirects and disables implicit
environment HTTP proxies so it will not forward the capability unexpectedly.

## HTTP surface

- `HEAD /transfers/ID`: metadata/current upload offset; download metadata includes
  Content-Length, ETag and Accept-Ranges.
- Upload `PATCH`: binary `application/octet-stream`, exact `Upload-Offset`, at
  most 8 MiB per request. The gateway forwards at most 256 KiB in each internal
  computer RPC. The internal legacy WebSocket framing uses Base64 for bounded
  chunks; no whole-file Base64 envelope is created.
- Upload `POST /transfers/ID/commit`: verify complete size/SHA256 and atomically
  install on the computer. An offset equal to size is **not** completion without
  this commit response. Repeating commit recovers its original outcome.
- Download `GET`: full or single byte Range, including open-ended and suffix
  ranges; strong If-Range, 200/206/416. A changed source is rejected rather than
  combining bytes from different versions.
- `DELETE`: cancel the original transfer only.

This remote-file surface uses ordinary HTTP streaming and Range, with an
explicit application commit. It is not advertised as a complete tus endpoint.
The server-chat attachment endpoint implements tus core + creation and the web
chat uses pinned `tus-js-client` 4.3.1. If a legacy server has no tus endpoint, the
web adapter falls back to its existing bounded JSON attachment API.

Concurrent upload operations on the same HTTP resource are rejected. At most
eight upload streams are active per gateway instance, with a 30-second idle
timeout and five-minute PATCH duration. This is not a distributed quota. All
responses are no-store. Stream cancellation is bounded so an uncooperative
request cannot retain an upload lock indefinitely.

## Explicit network selection

The helper identifies itself as `computer-bridge/0.2.6 transfer-helper` and keeps
TLS certificate verification and redirect rejection enabled. Its first HEAD
checks the real transfer resource before any upload bytes. DNS, TLS, timeout
and connection failures are reported separately without URLs or credentials.
A failed DNS/TLS check is not a completed transfer.

Direct access remains the default. Only when a trusted proxy is deliberately
authorized, pass `--proxy http://trusted-host:port` (or HTTPS). Ambient proxy
environment variables remain ignored. Proxy URLs cannot contain credentials,
paths, queries or fragments. This does not change Cloudflare security policy
or repair DNS in an executor whose network cannot reach the service.

Upload network fragments are coalesced into a single 256 KiB buffer before a
remote write. A disconnected request retains full committed chunks; an
uncommitted partial buffer is discarded and resent from the next HEAD offset.
The five-minute PATCH deadline includes remote writes. The helper allows
330 seconds for a PATCH response; metadata and download reads retain 60-second
socket timeouts. These limits do not disable TLS or authorization checks.
