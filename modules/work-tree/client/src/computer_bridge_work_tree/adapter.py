"""Remote native execution contract. No model or local host is launched."""

from __future__ import annotations

from pathlib import Path

from work_tree.adapters.common import definition_attributes, main
from work_tree.contracts import Error, Json

from computer_bridge import __version__

from .sources import originals


def handle(request: Json) -> Json:
    operation, payload = request["operation"], request["payload"]
    if operation == "describe":
        return {
            "version": __version__,
            "models": [],
            "capabilities": {
                "native": True,
                "automatic_native": False,
                "max_subagents": 6,
                "updates": "on_plugin_call",
                "original_process": "requires_host_originals",
            },
        }
    if operation == "configure":
        return {"assets": []}
    if operation == "apply_configuration":
        return {}
    if operation == "render_action":
        launch = payload.get("launch")
        if launch:
            attributes = definition_attributes(launch)
            return {
                "execution": "computer_bridge_native_subagent",
                "independent_context": True,
                "max_subagents": 6,
                "role": launch["role"],
                "run_id": launch["run_id"],
                "attempt_id": launch["attempt_id"],
                "is_leader": launch.get("is_leader", True),
                "assignment": launch.get("assignment", ""),
                "team_id": launch.get("team_id"),
                "model": launch.get("model") or attributes.get("model") or launch.get("fallback_model"),
                "reasoning_effort": launch.get("reasoning_effort")
                or attributes.get("model_reasoning_effort") or launch.get("fallback_reasoning_effort"),
                "instructions": (
                    "Create an independent native subagent without the parent's research dialogue. "
                    "Pass its actual native agent ID to computer.module_call(action=bind) "
                    "with the parent session, "
                    "run_id and attempt_id. The returned session supplies its pinned definition, "
                    "context and permitted tools. Use computer.files and computer.exec with the "
                    "workspace and research_session for real project files. "
                    "Follow context.dynamic.execution: leaders submit the whole result; "
                    "members use team.report. "
                    "The bound execution role governs permissions even if the source definition has "
                    "another role. Use team.request for additional siblings through the parent; "
                    "after completion return to the parent and release the native agent slot. "
                    "Use the host's supported model settings; no local model process is needed."
                ),
            }
        return {"update": payload.get("context")}
    if operation == "read_conversation":
        return originals(Path(request["project"]), payload["session_id"], payload.get("section", "process"))
    if operation == "human_review":
        return {"channel": "mcp_form"}
    if operation == "stop" and payload.get("job"):
        job = payload["job"]
        return {
            "stopped": False,
            "native_action": {
                "execution": "computer_bridge_native_subagent",
                "action": "stop_child",
                "agent_id": job.get("session_id"),
                "run_id": job["run_id"],
                "attempt_id": job["attempt_id"],
            },
            "instruction": (
                "由宿主停止该原生子智能体，完成后调用 "
                "computer.module_call(action=child_stopped)，再继续原操作。"
            ),
        }
    if operation in {"launch", "stop"}:
        raise Error("remote_host", "原生执行由当前 GPT／Dot 宿主管理，不启动或停止本机模型宿主")
    raise Error("adapter_operation", operation)


if __name__ == "__main__":
    main(handle)
