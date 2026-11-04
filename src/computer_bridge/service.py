"""One computer's workspace handles and optional modules; no global current directory."""

from __future__ import annotations

import asyncio
import getpass
import json
import os
import platform
import time
from pathlib import Path
from typing import Any, cast

from . import __version__
from .access import Access, reclaim_grants, validate_access
from .adapters import Registry
from .common import Error, Json, save, uid
from .files import LocalFiles
from .guidance import instructions
from .modules import Modules
from .operations import Operations
from .power import Power
from .requests import Requests
from .update_control import UpdateControl
from .workspace_paths import create_directories, inspect_access, missing_directories, usable_roots


class Computer:
    def __init__(self, config: Path):
        self.config = config
        self.settings = json.loads(config.read_text(encoding="utf-8"))
        self.directory = config.parent
        self.requests = Requests(self.directory / "requests", self.execute, self.validate_receipt)
        self.session_file = self.directory / "workspaces.json"
        self.sessions: Json = json.loads(self.session_file.read_text(encoding="utf-8")) if self.session_file.exists() else {}
        self.operations = Operations(self.directory / "operations")
        self.operations.node_path = self.settings.get("native_node")
        self.adapters = Registry(self.directory / "adapter-runs", self.operations.node_path)
        self.modules = Modules(self.settings.get("modules", []))
        self.updates = UpdateControl(self.directory)
        self.draining = False
        self.operation_contexts: dict[str, Json] = {}
        self.access = Access(
            self.settings.get("access", {"full_access": True, "workspaces": [], "revision": 0})
        )
        self.access_lock = asyncio.Lock()
        self.power = Power(self.settings.get("lock_mode", {"enabled": True, "revision": 0}))

    def validate_receipt(self, method: str, response: Json) -> None:
        if method in {"computer.exec", "computer.web", "computer.wait"}:
            identity = response.get("result", {}).get("operation")
            if identity and not (self.operations.directory / identity / "metadata.json").exists():
                raise Error("operation_released", "原操作和输出已释放；没有重新执行")

    def info(self) -> Json:
        return {
            "id": self.settings["device_id"],
            "name": self.settings["name"],
            "system": platform.system(),
            "version": __version__,
            "user": getpass.getuser(),
            "home": str(Path.home()),
            "shell": "PowerShell" if os.name == "nt" else "bash",
            "modules": self.settings.get("modules", []),
            "access_revision": self.access.value["revision"],
            "lock_mode": self.power.status(),
            "request_protocol": 1,
            "protocol": {"min": 1, "max": 1},
            "capabilities": ["request_recovery", "module_registry", "transport_v2", "command_approval_v1"]
            + (["updates_v1"] if self.updates.supported() else []),
            "module_versions": self.modules.status(),
            "install_id": os.environ.get("COMPUTER_BRIDGE_INSTALL_ID"),
        }

    def root(self, session: str) -> Path:
        if session not in self.sessions:
            raise Error("session_missing", "请先在所选电脑打开工作目录")
        return Path(self.sessions[session]["path"])

    def module(self, name: str) -> Any:
        return self.modules.get(name)

    async def execute(self, method: str, args: Json, human_confirm: Any = None) -> Json:
        if method == "computer.configure_power":
            setting = args["lock_mode"]
            if setting["revision"] < self.power.setting["revision"]:
                return self.power.status()
            if setting != self.settings.get("lock_mode", {"enabled": True, "revision": 0}):
                self.settings["lock_mode"] = setting
                save(self.config, self.settings)
            return self.power.apply(setting)
        if method in {"computer.wait", "computer.input", "computer.stop", "computer.release"}:
            result = await self._execute(method, args, human_confirm)
            return await self.attach_guidance(result, args)
        async with self.access_lock:
            if method == "computer.configure":
                return await self.configure(args["access"])
            if method == "computer.inspect_workspaces":
                checked = await asyncio.to_thread(inspect_access, args["access"])
                return {"access": checked, "missing": missing_directories(checked)}
            if method == "computer.create_workspace_directories":
                return {"access": await asyncio.to_thread(create_directories, args["access"])}
            incoming = args.get("_access")
            if incoming and incoming["revision"] > self.access.value["revision"]:
                await self.configure(incoming)
            result = await self._execute(method, args, human_confirm)
            if method == "computer.open":
                args = {**args, "session": result["session"]}
            if method != "computer.exec":
                return await self.attach_guidance(result, args)
        # A command waits for itself after releasing the device configuration lock.
        result = await self.operations.wait(args["session"], result["operation"], 1, consume=False)
        return await self.attach_guidance(result, args)

    async def attach_guidance(self, result: Json, args: Json) -> Json:
        if "_guidance_stamps" not in args:
            return result
        session = self.sessions.get(args.get("session", ""))
        root = Path(session.get("project", session["path"])) if session else None
        documents, stamps = await asyncio.to_thread(instructions, root, args["_guidance_stamps"])
        return {**result, "_guidance": documents, "_guidance_stamps": stamps}

    async def configure(self, value: Json) -> Json:
        if value["revision"] < self.access.value["revision"]:
            return {"applied": True, "revision": self.access.value["revision"], "access": self.access.value}
        updated = validate_access(value)
        old = self.access.value
        affected: set[str] = set()
        if old["full_access"] and not updated["full_access"]:
            affected.update(self.sessions)
        elif not updated["full_access"]:
            new = {w["id"]: w for w in updated["workspaces"]}
            changed = {
                w["id"]
                for w in old["workspaces"]
                if w["id"] not in new
                or ({w["path"], *w["additional"]} - {new[w["id"]]["path"], *new[w["id"]]["additional"]})
            }
            affected.update(k for k, s in self.sessions.items() if s.get("workspace") in changed)
        for identity, operation in list(self.operations.entries.items()):
            if operation.state == "awaiting_approval" and updated["revision"] != old["revision"]:
                await self.operations.stop(operation.session, identity)
            if operation.kind == "command" and operation.state == "running" and operation.session in affected:
                await self.operations.stop(operation.session, identity)
        self.access = Access(updated)
        self.settings["access"] = updated
        save(self.config, self.settings)
        await self.reclaim_grants()
        return {"applied": True, "revision": updated["revision"], "access": updated}

    async def reclaim_grants(self) -> None:
        keep = {
            frozenset(
                [w["path"], *[p["path"] for p in w["validation"]["additional"] if p["state"] == "valid"]]
            )
            for w in self.access.value["workspaces"]
            if w.get("validation", {}).get("main", {}).get("state") == "valid"
        }
        active = set()
        for entry in self.operations.entries.values():
            path = entry.directory / "sandbox.json"
            if entry.state == "running" and path.exists():
                active.add(json.loads(path.read_text(encoding="utf-8"))["grant_key"])
        await reclaim_grants(self.operations.grant_base, keep, active, self.operations.node_path)

    async def _execute(self, method: str, args: Json, human_confirm: Any = None) -> Json:
        if method == "computer.info":
            return self.info()
        if method == "computer.workspaces":
            return dict(self.access.value)
        if method == "computer.open":
            selected = self.access.open(args.get("path"), args.get("workspace_id"))
            root = Path(selected["path"])
            session = uid("workspace")
            project = (
                self.access.workspace(selected["workspace"])["path"] if selected["workspace"] else str(root)
            )
            self.sessions[session] = {**selected, "project": project, "created": time.time()}
            save(self.session_file, self.sessions)
            return {
                "session": session,
                "path": str(root),
                "workspace_id": selected["workspace"],
                "full_access": self.access.value["full_access"],
                "computer": self.info(),
            }
        session = args["session"]
        root = self.root(session)
        roots = (
            None
            if method in {"computer.wait", "computer.input", "computer.stop", "computer.release"}
            else self.access.roots(self.sessions[session])
        )
        if method in {"computer.skills", "computer.agents"}:
            entry = self.sessions[session].get("workspace")
            extra = usable_roots(self.access.workspace(entry))[1:] if entry else []
            project = Path(self.sessions[session].get("project", str(root)))
            return await self.adapters.execute(
                "skill" if method == "computer.skills" else "agent",
                args.get("operation", "list"),
                project,
                extra,
                roots,
                args.get("_definition"),
                args.get("path"),
            )
        if method == "computer.web":
            from .tools import fetch

            identity = ""

            async def perform() -> Json:
                return await fetch(
                    args["url"], self.operations.get(session, identity).directory, self.operations.node_path
                )

            started = self.operations.start(session, root, "web", perform)
            identity = started["operation"]
            return started
        if method == "computer.jobs":
            return {
                "operations": [
                    {"operation": k, "kind": v.kind, "state": v.state}
                    for k, v in self.operations.entries.items()
                    if v.session == session
                ]
            }
        if method in {"computer.present", "computer.download"}:
            from .tools import export_chunk, export_info

            if method == "computer.download":
                return await asyncio.to_thread(export_chunk, root, args["path"], args["offset"])
            return {"files": [await asyncio.to_thread(export_info, root, p) for p in args["files"]]}
        if method == "computer.modules":
            return {"modules": self.modules.status()}
        if method == "computer.module_tools":
            return cast(Json, await self.module(args["module"]).tools(root, args.get("payload", {})))
        if method == "computer.module_call":
            return cast(
                Json,
                await self.module(args["module"]).call(
                    session, root, args["action"], args.get("payload", {}), human_confirm
                ),
            )
        if method in {"computer.files", "computer.image"}:
            files = LocalFiles(
                root, roots, node_path=self.operations.node_path, grant_base=self.operations.grant_base
            )
            if method == "computer.image":
                return await asyncio.to_thread(files.image, args["path"])
            payload = args.get("payload", {})
            await self.modules.event("file_request", root, args, payload)
            result = await asyncio.to_thread(files.apply, args["operation"], payload)
            await self.modules.event("file_result", root, args, result)
            return result
        if method == "computer.approval_details":
            return self.operations.approval_details(session, args["operation"])
        if method == "computer.approval_decide":
            return await self.operations.decide(session, args["operation"], args["approval_id"],
                args["digest"], args["decision"], {"device": self.settings["device_id"],
                    "caller": args["_caller"], "revision": self.access.value["revision"]})
        if method == "computer.exec":
            if roots is not None and args.get("sandbox_permissions") and not args.get("_caller"):
                raise Error("approval_unavailable", "服务端尚未提供可信审批上下文，请先升级服务端")
            extension = await self.modules.command_context(root, args)
            capture = None
            if extension:

                async def capture(result: Json) -> Json:
                    return cast(Json, await extension.command_result(root, args, result))

            result = await self.operations.command(
                session,
                root,
                args["command"],
                LocalFiles(root).path(args.get("cwd", ".")),
                capture,
                request_key=args.get("request_key"),
                roots=roots,
                sandbox_permissions=args.get("sandbox_permissions") if roots is not None else None,
                justification=args.get("justification") if roots is not None else None,
                description=args.get("description"),
                approval_context={"device": self.settings["device_id"], "caller": args.get("_caller"),
                                  "revision": self.access.value["revision"]},
            )
            if extension:
                self.operation_contexts[result["operation"]] = args
                await extension.event("command", root, args, result)
            return result
        if method == "computer.input":
            context = self.operation_contexts.get(args["operation"])
            if context:
                await self.modules.event(
                    "command_input",
                    root,
                    context,
                    {
                        "operation": args["operation"],
                        "text": args.get("text", ""),
                        "eof": args.get("eof", False),
                    },
                )
            return await self.operations.input(
                session, args["operation"], args.get("text", ""), args.get("eof", False)
            )
        if method == "computer.wait":
            return await self.operations.wait(
                session, args["operation"], args.get("seconds", 1), args.get("consume")
            )
        if method == "computer.stop":
            return await self.operations.stop(session, args["operation"])
        if method == "computer.release":
            self.operation_contexts.pop(args["operation"], None)
            return await self.operations.release(session, args["operation"])
        raise Error("computer_method", method)

    async def close(self) -> None:
        await self.requests.close()
        await self.power.close()
        await self.operations.close()
        await self.reclaim_grants()
        await self.modules.close()
