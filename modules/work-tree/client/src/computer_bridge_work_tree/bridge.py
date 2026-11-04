"""Optional remote facade over existing project services. No Application or SQLite here."""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, cast

from work_tree.contracts import Error, Json, Role, digest, uid
from work_tree.file_contracts import DEFINITION_DIR, WORK_DIRS, path_owner
from work_tree.harness_adapter import invoke
from work_tree.harness_registry import load as registry
from work_tree.service_catalog import project_directory, read_service
from work_tree.service_client import RemoteApplication
from work_tree.tool_surfaces import DISCUSSION_DESCRIPTIONS, DISCUSSION_TOOLS, RESEARCH_DESCRIPTIONS

from computer_bridge import __version__
from computer_bridge.operations import Operations

from .sources import load, update

SUBMISSIONS = {"worker.submit", "checker.submit", "memory.propose", "norm_curation.propose", "team.report"}
IGNORED = {".git", ".work-tree", ".agents", ".codex", ".dsh", "node_modules", ".venv", "__pycache__"}


def stamp(root: Path) -> tuple[tuple[str, int, int], ...]:
    """Only stat metadata is observed here; project text remains with its owners."""
    result = []
    for prefix in [*WORK_DIRS.values(), DEFINITION_DIR]:
        for directory, names, files in os.walk(root / prefix):
            folder = Path(directory)
            names[:] = [
                name
                for name in names
                if name not in IGNORED and not (folder / name / ".work-tree/project.sqlite3").is_file()
            ]
            for name in files:
                path = folder / name
                try:
                    info = path.stat()
                except FileNotFoundError:
                    continue
                result.append((str(path.relative_to(root)), info.st_mtime_ns, info.st_size))
    return tuple(sorted(result))


class WorkTreeBridge:
    def __init__(self, projects: dict[str, Path]):
        self.projects = {name: path.resolve() for name, path in projects.items()}
        self.apps: dict[str, RemoteApplication] = {}
        self.sessions: dict[str, Json] = {}
        self.stamps: dict[str, tuple[tuple[str, int, int], ...]] = {}
        self.cursors: dict[str, int] = {}
        self.observed: dict[str, tuple[tuple[str, int, int], ...]] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.operations = Operations()

    async def app(self, project: str) -> RemoteApplication:
        if project not in self.projects:
            raise Error("project_missing", "请从 computer.open 返回的项目中选择")
        async with self.locks.setdefault("project:" + project, asyncio.Lock()):
            if project not in self.apps:
                remote = await asyncio.to_thread(RemoteApplication, self.projects[project])
                self.apps[project] = remote
                for identity, entry in load(remote.storage.root).items():
                    if entry.get("workspace_id") == remote.workspace_id:
                        self.sessions[identity] = {**entry, "project": project}
            return self.apps[project]

    def record(self, app: RemoteApplication, identity: str, entry: Json) -> None:
        stored = update(app.storage.root, identity, {k: v for k, v in entry.items() if k != "project"})
        self.sessions[identity] = {**stored, "project": entry["project"]}

    async def resolve(self, session: str) -> tuple[RemoteApplication, Json]:
        if session not in self.sessions:
            for project, root in self.projects.items():
                record = load(root).get(session)
                if record is not None:
                    self.sessions[session] = {**record, "project": project}
                    break
        entry = self.sessions.get(session)
        if entry is None:
            raise Error("session_missing", "请连接项目，或恢复此前返回的 Work Tree 会话句柄")
        app = await self.app(entry["project"])
        if entry["workspace_id"] != app.workspace_id:
            raise Error("session_wrong_project", "会话属于其它项目目录")
        return app, entry

    async def connect(self, project: str, resume: str | None = None, host_id: str | None = None) -> Json:
        app = await self.app(project)
        if resume:
            owner, entry = await self.resolve(resume)
            if owner.storage.root != app.storage.root or entry["role"] != "discussion":
                raise Error("session_wrong_project", "恢复句柄不属于所选项目的 Discussion")
            identity = resume
        else:
            identity = uid("bridge_session")
            activated = await asyncio.to_thread(
                app.control,
                "sessions.activate",
                {"session_key": "computer-bridge:" + identity, "harness": "computer-bridge"},
            )
            entry = {
                "project": project,
                "workspace_id": app.workspace_id,
                "role": "discussion",
                "conversation": activated["conversation"],
                "host_id": host_id or identity,
                "logical_session": host_id is None,
                "originals": [],
            }
            self.record(app, identity, entry)
        await asyncio.to_thread(
            app.control,
            "harness.register",
            {
                "id": "computer-bridge",
                "name": "Computer Bridge",
                "version": __version__,
                "models": [],
                "execution": "native",
                "capabilities": {"native": True, "max_subagents": 6},
            },
        )
        update = await self.refresh(identity, force=resume is None)
        return {
            "session": identity,
            "project": project,
            "directory": str(app.storage.root),
            "logical_session": entry["logical_session"],
            "max_subagents": 6,
            "update": update,
            "review": await asyncio.to_thread(app.control, "review.link", {}),
        }

    async def refresh(self, session: str, *, force: bool = False) -> Json | None:
        app, entry = await self.resolve(session)
        if entry["role"] != "discussion":
            return None
        async with self.locks.setdefault("refresh:" + session, asyncio.Lock()):
            current = await self.observe(app)
            cursor = await asyncio.to_thread(app.control, "events.cursor", {})
            if not force and self.stamps.get(session) == current and self.cursors.get(session) == cursor:
                return None
            result = await asyncio.to_thread(
                app.control,
                "sessions.context_update",
                {
                    "conversation": entry["conversation"],
                    "force": force,
                },
            )
            await asyncio.to_thread(
                app.control,
                "sessions.context_record",
                {
                    "conversation": entry["conversation"],
                    "context": result["context"],
                },
            )
            self.stamps[session] = current
            self.cursors[session] = await asyncio.to_thread(app.control, "events.cursor", {})
            return cast(Json | None, result["update"])

    async def observe(self, app: RemoteApplication) -> tuple[tuple[str, int, int], ...]:
        key = str(app.storage.root)
        async with self.locks.setdefault("observe:" + key, asyncio.Lock()):
            current = await asyncio.to_thread(stamp, app.storage.root)
            if self.observed.get(key) != current:
                previous = {path: (mtime, size) for path, mtime, size in self.observed.get(key, ())}
                now = {path: (mtime, size) for path, mtime, size in current}
                changed = [
                    path
                    for path in previous.keys() | now.keys()
                    if previous.get(path) != now.get(path) and path_owner(path)
                ]
                if changed:
                    await asyncio.to_thread(app.control, "files.refresh", {"paths": changed})
                current = await asyncio.to_thread(stamp, app.storage.root)
                self.observed[key] = current
            return current

    async def tools(self, session: str) -> Json:
        app, entry = await self.resolve(session)
        inventory = await asyncio.to_thread(
            app.request, "core.inventory", {"role": entry["role"], "run_id": entry.get("run_id")}
        )
        descriptions = DISCUSSION_DESCRIPTIONS if entry["role"] == "discussion" else RESEARCH_DESCRIPTIONS
        return {
            "role": entry["role"],
            "tools": [
                {
                    "name": tool["name"],
                    "inputSchema": tool["inputSchema"],
                    "description": descriptions.get(tool["name"], tool["name"]),
                }
                for tool in inventory
                if entry["role"] != "discussion" or tool["name"] in DISCUSSION_TOOLS
            ],
            "update": await self.refresh(session),
        }

    async def bind(self, session: str, run_id: str, attempt_id: str, agent_id: str) -> Json:
        app, parent = await self.resolve(session)
        if parent["role"] != "discussion":
            raise Error("wrong_role", "由父 Discussion 关联真实宿主子智能体")
        state = await asyncio.to_thread(app.control, "dispatch.state", {})
        job = next((row for row in state["jobs"] if row["run_id"] == run_id), None)
        if (
            not job
            or job["binding"].get("harness_id") != "computer-bridge"
            or (job["binding"].get("conversation") != parent["conversation"])
        ):
            raise Error("work_scope", "执行不属于这个项目和父 Discussion")
        await asyncio.to_thread(
            app.control,
            "dispatch.native_start",
            {
                "run_id": run_id,
                "attempt_id": attempt_id,
                "role": job["role"],
            },
        )
        await asyncio.to_thread(
            app.control,
            "dispatch.native_attach",
            {
                "run_id": run_id,
                "attempt_id": attempt_id,
                "harness": "computer-bridge",
                "conversation": parent["conversation"],
                "session_id": agent_id,
            },
        )
        identity = next(
            (
                key
                for key, row in self.sessions.items()
                if row.get("run_id") == run_id
                and row.get("attempt_id") == attempt_id
                and row["workspace_id"] == app.workspace_id
            ),
            uid("bridge_run"),
        )
        directory = await asyncio.to_thread(app.control, "materials.directory", {"lifetime": run_id})
        entry = {
            "project": parent["project"],
            "workspace_id": app.workspace_id,
            "role": job["role"],
            "conversation": parent["conversation"],
            "run_id": run_id,
            "attempt_id": attempt_id,
            "host_id": agent_id,
            "originals": [],
            "journal": str((Path(directory["path"]) / "computer-bridge.jsonl").relative_to(app.storage.root)),
        }
        if identity in self.sessions:
            entry.pop("originals")
        self.record(app, identity, entry)
        context = await self.business(identity, "context.get", {})
        return {
            "session": identity,
            "role": job["role"],
            "context": context,
            "tools": (await self.tools(identity))["tools"],
        }

    async def journal(self, app: RemoteApplication, entry: Json, record: Json) -> None:
        if not entry.get("journal"):
            return
        path = app.storage.root / entry["journal"]
        # The material owner removes completed lifetimes. Do not resurrect them.
        if not path.parent.exists():
            return
        original = json.dumps(record, ensure_ascii=False)
        material = await asyncio.to_thread(
            app.control,
            "materials.write",
            {
                "lifetime": entry["run_id"],
                "key": "computer-bridge/calls/" + digest(original) + ".json",
                "text": original,
            },
        )
        text = (
            json.dumps(
                {
                    "at": time.time(),
                    "agent_id": entry["host_id"],
                    "run_id": entry["run_id"],
                    "attempt_id": entry["attempt_id"],
                    "record_file": material["path"],
                },
                ensure_ascii=False,
            )
            + "\n"
        )
        async with self.locks.setdefault("journal:" + str(path), asyncio.Lock()):
            await asyncio.to_thread(self._append, path, text)

    @staticmethod
    def _append(path: Path, text: str) -> None:
        with path.open("a", encoding="utf-8", newline="") as stream:
            stream.write(text)

    async def business(self, session: str, capability: str, payload: Json) -> Any:
        app, entry = await self.resolve(session)
        await self.observe(app)
        role = entry["role"]
        if role == "discussion" and capability not in DISCUSSION_TOOLS:
            raise Error("capability_forbidden", "该能力不属于 Discussion 插件工具")
        if role != "discussion":
            inventory = await asyncio.to_thread(
                app.request, "core.inventory", {"role": role, "run_id": entry.get("run_id")}
            )
            if capability not in {tool["name"] for tool in inventory}:
                raise Error("capability_forbidden", "该能力不属于本角色")
            await asyncio.to_thread(
                app.control,
                "dispatch.native_touch",
                {
                    "run_id": entry["run_id"],
                    "lease": entry["attempt_id"],
                },
            )
        data = dict(payload)
        if role == "discussion" and capability == "discussion.start_step":
            data["harness_id"] = "computer-bridge"
        # The existing Application records research capability inputs and outputs once.
        while True:
            service = read_service(project_directory(app.storage.root))
            try:
                result = await app.execute_tool(
                    capability,
                    data,
                    role=cast(Role, role),
                    conversation_id=entry["conversation"],
                    run_id=entry.get("run_id"),
                    execution_lease=entry.get("attempt_id"),
                )
                break
            except Error:
                raise
            except Exception:
                # Only a durable question wait resumes across an actual service replacement.
                # Submissions and other writes are never replayed.
                if capability not in {"interaction.ask", "team.receive"}:
                    raise
                current = read_service(project_directory(app.storage.root))
                marker = project_directory(app.storage.root) / "restart.json"
                changing = marker.exists() and json.loads(marker.read_text())["state"] == "running"
                if not changing and (
                    current is None or service is None or current["instance"] == service["instance"]
                ):
                    raise
                await asyncio.sleep(0.1)
        if role == "discussion" and capability == "discussion.next_execution" and result.get("launch"):
            profile = registry()["profiles"]["computer-bridge"]
            action = await asyncio.to_thread(
                invoke,
                profile,
                "render_action",
                app.storage.root,
                "computer-bridge",
                {"launch": result["launch"]},
            )
            result["native_action"] = {**action, "parent_session": session}
        if capability in SUBMISSIONS:
            await asyncio.to_thread(
                app.control,
                "dispatch.report",
                {
                    "job_id": "job_" + entry["run_id"],
                    "lease": entry["attempt_id"],
                    "status": "finished",
                    "session_id": entry["host_id"],
                },
            )
        return result

    async def call(
        self, session: str, capability: str, payload: Json, request_key: str | None = None
    ) -> Json:
        app, _ = await self.resolve(session)

        async def perform() -> Json:
            result = await self.business(session, capability, payload)
            return {"value": result, "update": await self.refresh(session)}

        return self.operations.start(session, app.storage.root, "business", perform, request_key)

    async def start_norms(self, session: str, human_decision: str) -> Json:
        app, entry = await self.resolve(session)
        if entry["role"] != "discussion":
            raise Error("wrong_role", "从人类与 Discussion 的原对话启动规范整理")
        result = await app.execute_tool(
            "norm_curation.start",
            {"harness_id": "computer-bridge"},
            role="human",
            conversation_id=entry["conversation"],
            human_decision=human_decision,
        )
        return {key: result[key] for key in ("task_id", "run_id", "phase", "review_url") if key in result}

    async def child_stopped(self, session: str, run_id: str, attempt_id: str, agent_id: str) -> Json:
        app, parent = await self.resolve(session)
        state = await asyncio.to_thread(app.control, "dispatch.state", {})
        job = next((row for row in state["jobs"] if row["run_id"] == run_id), None)
        if (
            parent["role"] != "discussion"
            or not job
            or (
                job["binding"].get("conversation") != parent["conversation"]
                or job["binding"].get("harness_id") != "computer-bridge"
                or job.get("session_id") != agent_id
                or job.get("attempt_id") != attempt_id
            )
        ):
            raise Error("work_scope", "该子执行不属于这个项目和父会话")
        result = await asyncio.to_thread(
            app.control,
            "dispatch.report",
            {
                "job_id": job["id"],
                "lease": attempt_id,
                "status": "stopped",
                "session_id": agent_id,
                "cancelled": True,
            },
        )
        if job.get("stop_requested"):
            await asyncio.to_thread(app.control, "dispatch.stop_complete", {"id": job["id"]})
        await asyncio.to_thread(app.control, "recovery.checkpoint", {"id": run_id})
        return {"run_id": run_id, "state": result["status"]}

    async def close(self) -> None:
        await self.operations.close()
        for app in self.apps.values():
            await asyncio.to_thread(app.close)
