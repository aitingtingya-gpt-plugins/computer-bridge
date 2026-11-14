# Super Agent source adapter

The upstream reference is [DeepSeek's published Super Agent prototype](https://github.com/deepseek-ai/dsh-superagent-prototype), pinned to `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` under MIT. `vendor/UPSTREAM.json` records source provenance and hashes; `verify-vendor.mjs` verifies the pinned files offline. Runtime adapters are maintained outside those copies.

## Roles and execution

The user talks in the existing Bridge Super Agent conversation. A connected model follows the upstream orchestrator/worker role instructions and reports decisions and observations through `chat.task`. It chooses tools and delegation within those instructions and the user's existing permissions. Bridge does not mandate a subagent, prioritize computer tools over host tools, or create a worker chat per task.

No native agent lifecycle listener or embedded inference service is provided. Task and assignment identifiers are Bridge's stable records. A model's self-report is accepted as a report, not promoted to a server-observed host event. A parent may forward its worker's report when the worker cannot call the plugin. Host subagent identifiers are not required.

The optional `SuperAgentTaskClient` and `createMcpTaskTransport` are transport helpers. They do not execute, poll, claim, dispatch or recover tasks on their own. `build/super-agent-host.mjs` retains that standalone transport entrypoint.

## Task contract

New input first remains pending classification. A model can answer conversationally while discussing it, or route it immediately using original message references. Pending discussion does not dispatch a ticket or start an upstream assessment deadline. Other tasks can continue while discussion remains pending.

The engine owns task state transitions. Delivery and reading, assignment claiming and starting, and reporting and turn completion are separate calls. Progress does not imply turn completion; an outgoing event does not imply reading. Upstream reply purposes govern acknowledgements, answers, attention and results; recording a task report does not manufacture a user-facing reply.

All model writes use the authorized conversation connection. Original author access and task/assignment ownership are checked by the service. Mutating requests require a stable request key. Repeat the same request and key after an uncertain receipt; do not replace it with a contradictory failure report. Input retry and task recovery retain original records. Ordinary Chat has its independent implementation.

## Environment

Repository binding is optional context. The model uses computer tools for authorized registered-computer operations and its host's tools for host-side operations according to the task. A binding does not clone, push, grant credentials or expand workspace permissions. Node and Cloudflare use the same task rules with their platform storage and wake adapters.

## Compatibility

Previously persisted version-1 task records keep their existing execution path until finished. New records use the report-driven adapter. Switching application code does not replay old task inputs or start native work. Source inspection and protocol tests alone do not establish live Dot execution; validate that connection separately before rollout.
