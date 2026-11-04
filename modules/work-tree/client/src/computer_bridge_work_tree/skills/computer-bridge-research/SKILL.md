---
name: computer-bridge-research
description: Drive an explicitly requested Work Tree project using Computer Bridge and independent native subagents.
---

Open the user's selected computer and existing Work Tree project directory with `computer.open`.
Use `computer.modules` to verify that `work-tree` is installed and enabled; installation is an operator action.
Call `computer.module_tools(session=workspace, module="work-tree")` for the available module actions.

Activate Discussion with `computer.module_call(session=workspace, module="work-tree", action="connect", payload={})`.
The returned research `session` is distinct from the computer workspace. Keep both. For subsequent actions,
the outer session is the computer workspace (`s1`) and `payload.session` is the research session (`r1`).
Use returned short IDs for steps (`t1`), executions (`e1`), attempts (`a1`), changesets (`d1`),
proposals (`p1`) and questions (`q1`). Existing scientific file IDs keep their original values.
Read current capability schemas with `computer.module_tools(..., payload={"session": research_session})`.
Invoke listed capabilities with action `call`, payload `{session, capability, payload, request_key?}`.
It returns an operation; action `wait` uses `{session, operation, seconds?, consume?}`, and action `release`
releases consumed results. Wait on the original operation across connection interruptions.

Apply returned definition/topology changes. No update is injected during pure chat without a plugin call.
New executions use current definitions; running executions and recovery keep their pinned definitions.
Read additional material from original files through `computer.files`, using `payload.file_ref` for a
returned material reference (`f1`), not summaries prepared by Discussion.

Use the existing `discussion.next_execution` result. Spawn one independent native child with the supplied
role, run ID, attempt ID, model and settings supported by the actual host. Do not inherit the parent research
dialogue. Bind its actual native agent ID using module action `bind` with the parent research session,
`run_id`, `attempt_id`, and `agent_id`; give the child its returned pinned context and research session.
Use the host's actual child limit (Dot: at most 6). Wait for a slot rather than launch a local model.
After stopping a native child, report action `child_stopped` for that actual execution. Keep the original
Step order, Worker/Checker loop, question waiting and human confirmation rules.

A phase always has one leader selected by the unchanged Step definition. At startup,
`worker_members` / `checker_members` can specify initial collaborators with separate assignments and
definition sources: `lead` reuses the leader's pinned definition, `project` selects an existing ID,
and `temporary` supplies name, prompt and optional custom settings for this Step only. `team.agents`
reads the available definitions. Cross-role source selection does not change the member's actual
phase role, public memory, norms or Scope. Phase leaders may request more collaborators during work;
claim those queued handoffs using the same `discussion.next_execution` flow and create siblings under
this Discussion. Keep the existing event-wait flow active while children work so additional handoffs
can be received. Respect the shared host slot limit; reported collaborators release their slots.
Only leaders submit whole results or final Checker verdicts. Member reports remain in the same Step
and do not create another human-review item.

For a human's explicit norms request, register genuine host-exported original dialogue files with action
`import_originals`, payload `{session, files:[absolute_paths]}`, then action `start_norms`, payload `{session}`.
The MCP human form starts the original workflow. Do not summarize, filter or invent dialogue for it.
Plugin call logs alone are not complete host records; report missing originals. No complete GPT/Dot export
has yet been verified, so do not claim full process acceptance from this plugin's logs.

Discussion suggestions fill the original review item. File saves are not human confirmation. Give the
actual Work Tree review URL returned by this project's service; do not reuse another project's URL.
