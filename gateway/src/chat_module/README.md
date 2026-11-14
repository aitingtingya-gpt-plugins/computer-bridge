# Independent chat module

- `service.ts` owns persistent conversations, identity-aware messages, attachments, the single writing connection, and reliable notification transport.
- `context.ts` implements Chat mode and bounded, anchored multi-message context. It has no task-engine dependency or dispatch effect.
- `repositories/` provides explicit, bounded official-API repository reads. It never obtains or shares credentials, changes a repository, or starts work automatically.
- `super_agent/` contains the fixed-source Super Agent domain core, durable task state, narrow host interface and tests/provenance. It is called only for Super Agent conversations.
- `../chat.ts` is a compatibility re-export for existing server consumers. Web/TUI remain clients of the same version-compatible API.

Computer file/command execution, permission decisions and registered-computer transport remain outside this module. A chat mode never weakens or replaces those boundaries. Work/Dot provides real reasoning and execution; the module does not invent an internal model runtime.

See `docs/chat-modes.md` for user-facing behavior and validation.

`host.ts` is the host-side library entry. `npm run build` also emits the separate
`build/super-agent-host.mjs` module exporting `SuperAgentHost` and
`createMcpTaskTransport`. Loading it starts nothing. The existing Work/Dot host
must supply its authorized native execution and event integration; the gateway
server does not launch a model or load this host library automatically.
