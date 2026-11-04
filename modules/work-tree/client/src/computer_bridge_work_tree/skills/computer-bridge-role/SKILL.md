---
name: computer-bridge-role
description: Execute one independently bound Worker, Checker, Memory or Norm Curator run through the optional Work Tree module.
---

Use the parent's computer workspace and your separately bound research session. Preserve the supplied
pinned definition, model attributes, task, feedback and permissions. Think independently; do not inherit
the parent's research conclusions.

For Worker/Checker executions, read `context.get.dynamic.execution` before acting. Its actual role,
`is_leader`, separate `assignment` and `completion` determine this execution. The source definition may
originally belong to another role; it supplies professional guidance and model settings, not a different
role, Scope or workflow. Members share the phase's public memory, norms and file permissions.

Use `computer.module_tools(session=workspace, module="work-tree", payload={"session":research_session})`
for your actual capability schemas. Invoke a capability with `computer.module_call` action `call`, using
`payload={session:research_session, capability, payload, request_key?}`. Continue module `wait` on the
returned operation, then `release` it after consumption. `interaction.ask` waits for the original human
answer and applicable Trace decision; do not create a replacement question when a network wait ends.

Read and edit original files with `computer.files(session=workspace, research_session=research_session, ...)`.
Run commands with `computer.exec(..., research_session=research_session)` so the actual inputs and output
references belong to your execution. Read command outputs before releasing them. Do not write a separate
model-authored process summary for another agent. Missing host originals are missing evidence.

- Worker leader: follow the supplied small/exploration scope, coordinate members and integrate the whole
  result; submit with `worker.submit` after member assignments are complete or cancelled.
- Checker: independently review the supplied existing Note modification Diff; read reference changes
  and other originals as needed. The Checker leader integrates member findings and submits PASS or
  actionable FAIL using `checker.submit`, explaining material disagreements in the final comment.
- Worker/Checker collaborator: complete your separate assignment, use `team.send` / `team.receive` for
  communication in this round's role group, then use `team.report`. Return to the parent and release
  your native slot; member reports do not advance the Step. Leaders may use `team.agents` and
  `team.request` to select or compose further professional definitions. The parent host starts those
  sibling executions through its existing dispatch path.
- Memory: read the supplied work history and genuine original process files as needed; edit the actual
  history, summary and norm files; submit with `memory.propose`.
- Norm Curator: read the original dialogue files for this explicit human request, abstract reusable rules,
  edit real Discussion norms and use `norm_curation.propose`. Prefer self-contained rules; project dependencies
  use the project's explicit reference format.

After successful submission, return a concise result to the parent and release the native child slot.
