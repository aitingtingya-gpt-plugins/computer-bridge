"""Installed extension discovery; base installations do not import extension implementations."""

from __future__ import annotations

import json
from importlib.metadata import PackageNotFoundError, entry_points, version
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from packaging.specifiers import SpecifierSet

from ..common import Error, Json

API_VERSION = 1


class Modules:
    def __init__(self, enabled: list[str]):
        self.enabled = enabled
        self.entries = {entry.name: entry for entry in entry_points(group="computer_bridge.modules")}
        self.loaded: dict[str, Any] = {}

    def status(self) -> list[Json]:
        result = []
        for name in sorted(set(self.entries) | set(self.enabled)):
            entry = self.entries.get(name)
            state, error = "not_installed", ""
            requirements: Json = {}
            display_version = entry.dist.version if entry and entry.dist else None
            if entry:
                try:
                    spec = find_spec(entry.module.split(".")[0])
                    if spec is None or spec.origin is None:
                        raise ModuleNotFoundError(name=entry.module)
                    definition = json.loads(Path(spec.origin).with_name("bridge-module.json").read_text(encoding="utf-8"))
                    display_version = definition["version"]
                    requirements = {
                        "core": definition["core"],
                        "dependencies": definition.get("dependency_versions", {}),
                    }
                    state = (
                        "incompatible"
                        if definition["api"] != API_VERSION
                        else "available"
                        if name in self.enabled
                        else "disabled"
                    )
                    if version("computer-bridge") not in SpecifierSet(requirements["core"]):
                        state, error = "incompatible", "核心版本不符合 " + requirements["core"]
                    for dependency, required in requirements.get("dependencies", {}).items():
                        if version(dependency) not in SpecifierSet(required):
                            state, error = "incompatible", dependency + " 需要 " + required
                except ModuleNotFoundError as exc:
                    state, error = "missing_dependency", str(exc.name)
                except PackageNotFoundError as exc:
                    state, error = "missing_dependency", str(exc)
            result.append(
                {
                    "id": name,
                    "installed": entry is not None,
                    "enabled": name in self.enabled,
                    "version": display_version,
                    "state": state,
                    "error": error,
                    "requires": requirements,
                }
            )
        return result

    def get(self, name: str) -> Any:
        if name not in self.enabled:
            raise Error("module_disabled", "该电脑未启用此模块：" + name)
        status = next(item for item in self.status() if item["id"] == name)
        if status["state"] != "available":
            raise Error("module_" + status["state"], "模块不可用：" + name + " " + status["error"])
        if name not in self.loaded:
            self.entries[name].load().configure()
            self.loaded[name] = self.entries[name].load()()
        return self.loaded[name]

    async def event(self, event: str, root: Path, args: Json, value: Json) -> None:
        for module in self.loaded.values():
            await module.event(event, root, args, value)

    async def command_context(self, root: Path, args: Json) -> Any:
        if not args.get("research_session") and not args.get("module_context"):
            return None
        for state in self.status():
            if state["state"] == "available":
                module = self.get(state["id"])
                if module.accepts_context(args):
                    await module.validate_context(root, args)
                    return module
        if args.get("research_session") or args.get("module_context"):
            raise Error("module_context_missing", "执行上下文对应的模块尚未安装或启用")
        return None

    def busy(self) -> int:
        return sum(int(module.busy()) for module in self.loaded.values())

    async def close(self) -> None:
        for module in self.loaded.values():
            await module.close()
