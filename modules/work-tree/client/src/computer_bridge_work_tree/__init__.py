"""Optional Work Tree facade; imported only on an explicitly enabled device."""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from importlib.resources import files
from pathlib import Path
from typing import Any, cast

from work_tree.harness_registry import register
from work_tree.integration_files import atomic_text

from computer_bridge.common import Error, Json, home

from .bridge import WorkTreeBridge
from .sources import originals, update

ACTIONS = {
    "connect": "Activate Discussion in this selected Work Tree project; optional resume/host_id.",
    "tools": "Read the role's real capability schemas; payload.session is the research session.",
    "call": "Invoke a listed research capability with session, capability, payload, optional request_key.",
    "bind": "Bind actual native child identity with parent session, run_id, attempt_id, agent_id.",
    "child_stopped": "Report only after the native child actually stopped.",
    "wait": "Wait on an existing research operation with session, operation and seconds.",
    "release": "Release an already consumed research operation.",
    "start_norms": "On explicit human request, ask an MCP human form and start from actual originals.",
    "import_originals": "Register actual host-exported original files without rewriting them.",
}


class WorkTreeModule:
    api_version = 1
    _definition = json.loads(files(__package__).joinpath("bridge-module.json").read_text())
    requirements = {"core": _definition["core"], "dependencies": _definition["dependency_versions"]}

    def __init__(self) -> None:
        self.bridge = WorkTreeBridge({})

    @staticmethod
    def accepts_context(args: Json) -> bool:
        return bool(args.get("research_session"))

    async def validate_context(self, root: Path, args: Json) -> None:
        await self._resolve(root, args["research_session"])

    async def command_result(self, root: Path, args: Json, result: Json) -> Json:
        return await self.capture_command(root, args["research_session"], result)

    def busy(self) -> int:
        return sum(entry.state == "running" for entry in self.bridge.operations.entries.values())

    async def event(self, event: str, root: Path, args: Json, value: Json) -> None:
        if not args.get("research_session"):
            return
        if event == "file_request":
            record = {
                "kind": "request",
                "tool": "computer.files",
                "operation": args["operation"],
                "input": args.get("payload", {}),
            }
        elif event == "file_result":
            payload = args.get("payload", {})
            path = (root / payload.get("path", ".")).resolve()
            record = (
                {"kind": "material_read", "source_file": str(path)}
                if args["operation"] == "read" and path.is_relative_to(root / ".work-tree/materials")
                else {"kind": "result", "tool": "computer.files", "output": value}
            )
        elif event == "command":
            record = {"kind": "command", "command": args["command"], "cwd": args.get("cwd", "."), **value}
        elif event == "command_input":
            record = {"kind": "command_input", **value}
        else:
            return
        await self.journal(root, args, record)

    @staticmethod
    def configure() -> None:
        import yaml

        target = home() / "work-tree-harness.yaml"
        profile = yaml.safe_load(files(__package__).joinpath("harness.yaml").read_text())
        profile["harnesses"]["computer-bridge"]["adapter"] = [
            sys.executable,
            "-m",
            "computer_bridge_work_tree.adapter",
        ]
        atomic_text(target, yaml.safe_dump(profile, allow_unicode=True))
        register(target)

    async def tools(self, root: Path, payload: Json) -> Json:
        if payload.get("session"):
            await self._resolve(root, payload["session"])
            return await self.bridge.tools(payload["session"])
        return {"module": "work-tree", "actions": [{"name": k, "description": v} for k, v in ACTIONS.items()]}

    async def _resolve(self, root: Path, session: str) -> None:
        app, _ = await self.bridge.resolve(session)
        if app.storage.root.resolve() != root:
            raise Error("session_wrong_project", "科研会话不属于所选电脑工作目录")

    async def call(
        self, workspace: str, root: Path, action: str, payload: Json, human_confirm: Any = None
    ) -> Json:
        if action not in ACTIONS:
            raise Error("module_action", action)
        self.bridge.projects[workspace] = root
        if action == "connect":
            result = await self.bridge.connect(workspace, payload.get("resume"), payload.get("host_id"))
            if not payload.get("resume"):
                result["module_instructions"] = (
                    files(__package__).joinpath("skills/computer-bridge-research/SKILL.md").read_text()
                )
            return result
        await self._resolve(root, payload["session"])
        if action == "start_norms":
            app, _ = await self.bridge.resolve(payload["session"])
            originals(app.storage.root, payload["session"], "dialogue")
            if human_confirm is None or not await human_confirm("从完整原始对话启动 Work Tree 规范整理？"):
                return {"started": False}
            from computer_bridge.common import uid

            return await self.bridge.start_norms(payload["session"], uid("mcp_human"))
        if action == "import_originals":
            sources = [str(Path(p).expanduser().resolve(strict=True)) for p in payload["files"]]
            if any(not Path(p).is_file() for p in sources):
                raise Error("source_unavailable", "请提供实际宿主原始文件")
            update(root, payload["session"], {"originals": sources})
            return {"files": sources, "host_completeness_verified": False}
        if action in {"wait", "release"}:
            function = getattr(self.bridge.operations, action)
            data = dict(payload)
            data["identity"] = data.pop("operation")
            value = function(**data)
        else:
            value = getattr(self.bridge, action)(**payload)
        result = cast(Json, await value if inspect.isawaitable(value) else value)
        if action == "bind":
            result["module_instructions"] = (
                files(__package__).joinpath("skills/computer-bridge-role/SKILL.md").read_text()
            )
        return result

    async def journal(self, root: Path, payload: Json, record: Json) -> None:
        research = payload.get("research_session")
        if research:
            await self._resolve(root, research)
            app, entry = await self.bridge.resolve(research)
            await self.bridge.journal(app, entry, record)

    async def capture_command(self, root: Path, research: str, result: Json) -> Json:
        await self._resolve(root, research)
        app, entry = await self.bridge.resolve(research)
        if entry.get("run_id"):
            for field in ("stdout_path", "stderr_path"):
                source = Path(result[field])
                material = await asyncio.to_thread(
                    app.control,
                    "materials.copy",
                    {
                        "lifetime": entry["run_id"],
                        "key": "computer-bridge/commands/" + source.parent.name + "/" + source.name,
                        "source": str(source),
                        "size": source.stat().st_size,
                        "source_key": str(source),
                    },
                )
                result[field] = material["path"]
            await self.bridge.journal(app, entry, {"kind": "command_result", **result})
        return result

    async def close(self) -> None:
        await self.bridge.close()
