# DSH source integration

Computer Bridge 0.2.0 vendors selected original DeepSeek Harness source files.
It installs no `@deepseek-ai/dsh-*` npm packages. Generic runtime libraries are
locked separately. `src/computer_bridge/native/DSH_TOOLS.json` records the
upstream repository, commit, source paths, SHA256 values and build entry mappings.

The sandbox snapshot is recorded independently in
`src/computer_bridge/native/UPSTREAM.json`. Original files and licenses remain
under `src/computer_bridge/native/third_party`. Bridge-specific process setup
and transport adapters live outside those snapshots.

## Runtime ownership

- DSH PowerShell/Bash executors select and invoke the shell. Its subprocess
  implementation owns native Jobs, process ranges, cancellation and exit waits.
- DSH OutputCollector owns bounded text presentation. Bridge records original
  byte streams and exposes stdin through its transport.
- Bridge owns operation IDs, receipts and persistence. The command lifecycle
  delegates to DSH ShellProcess without loading a model or agent-session loop.
- DSH LocalFileSystem owns text storage and literal editing. Its readByteRange
  serves byte transport, and buildWindow computes line windows.
- DSH search, HTTP, HTML conversion and image normalization run behind Bridge
  adapters. Patches, binary writes, downloads, move/delete and definition
  adapters are Bridge extensions.

## Tool behavior

Byte reads use `offset` and `length`. Line reads use `line_offset` and
`line_limit`; mixing the two window types is rejected. Search uses ripgrep
pattern semantics. HTTP fetch follows the pinned upstream redirect and size
limits. `raw_complete` distinguishes complete response bytes from a bounded
prefix.

Windows reports the PowerShell family and macOS reports bash. Command results
identify the selected shell. Input is UTF-8 bytes; a native consumer owns how it
decodes stdin.

## Building the integration

Keep snapshot updates explicit and retain upstream license texts. Sandbox and
tool snapshots are separate inputs. Build aliases and Bridge adapters are
maintained outside the immutable source files.

From the repository root, run `python scripts/source_integrity.py` to verify
snapshot hashes and runtime dependency boundaries. The release build invokes
this check before packaging. License locations are listed in
[Third-party notices](../THIRD_PARTY_NOTICES.md).
