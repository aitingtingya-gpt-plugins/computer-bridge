"""Versioned JSON subprocess seam; no harness-specific parsing in this module."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import tomllib
from pathlib import Path
from typing import cast

from ..access import cleanup_sandbox, command_argv
from ..common import Error, Json


class Registry:
    def __init__(self, directory: Path, node: str | None):
        self.directory, self.node = directory, node

    @staticmethod
    def providers() -> list[Json]:
        scripts = Path(__file__).parent.parent / "adapter_scripts"
        entries = {
            entry["name"]: {
                "name": entry["name"],
                "command": [sys.executable, str(scripts / entry["script"])],
            }
            for entry in json.loads((scripts / "manifest.json").read_text(encoding="utf-8"))["adapters"]
        }
        config = Path.home() / ".work/adapters.toml"
        if config.is_file():
            for entry in tomllib.loads(config.read_text(encoding="utf-8")).get("adapters", []):
                if entry.get("enabled", True):
                    entries[entry["name"]] = entry
                else:
                    entries.pop(entry["name"], None)
        return list(entries.values())

    async def request(self, provider: Json, request: Json, root: Path, roots: list[Path] | None) -> Json:
        self.directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.directory) as temporary:
            directory = Path(temporary)
            argv = command_argv(
                provider["command"], roots, directory, self.node, self.directory.parent / "sandbox-grants"
            )
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=root,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **({"creationflags": 0x08000000} if os.name == "nt" else {"start_new_session": True}),
            )
            try:
                output, error = await process.communicate(json.dumps({"protocol": 1, **request}).encode())
            finally:
                if process.returncode is None:
                    if os.name == "nt":
                        stopper = await asyncio.create_subprocess_exec(
                            "taskkill",
                            "/PID",
                            str(process.pid),
                            "/T",
                            "/F",
                            creationflags=0x08000000,
                            stdout=asyncio.subprocess.DEVNULL,
                            stderr=asyncio.subprocess.DEVNULL,
                        )
                        await stopper.wait()
                    else:
                        import signal

                        os.killpg(process.pid, signal.SIGTERM)
                    await process.wait()
                await cleanup_sandbox(directory, self.node)
            if process.returncode:
                raise Error("adapter_failed", f"{provider['name']}: {error.decode(errors='replace')}")
            value = json.loads(output)
            if value["protocol"] != 1:
                raise Error("adapter_protocol", f"{provider['name']}: unsupported protocol")
            return cast(Json, value)

    async def execute(
        self,
        kind: str,
        operation: str,
        root: Path,
        extra: list[Path],
        roots: list[Path] | None,
        selected: Json | None = None,
        path: str | None = None,
    ) -> Json:
        context = {"root": str(root), "additional": [str(p) for p in extra], "home": str(Path.home())}
        providers = self.providers()
        if operation == "read":
            if selected:
                provider = next(p for p in providers if p["name"] == selected["source"])
                request = {"action": "read", "kind": kind, "context": context, "locator": selected["locator"]}
                return await self.request(provider, request, root, roots)
            target = Path(path or "").expanduser()
            target = (target if target.is_absolute() else root / target).resolve(strict=True)
            with target.open(encoding="utf-8", newline="") as source:
                return {"path": str(target), "directory": str(target.parent), "text": source.read()}
        if operation != "list":
            raise Error("definition_operation", operation)
        results = await asyncio.gather(
            *[
                self.request(p, {"action": "list", "kind": kind, "context": context}, root, roots)
                for p in providers
            ],
            return_exceptions=True,
        )
        rows: dict[str, Json] = {}
        for provider, result in zip(providers, results, strict=True):
            if isinstance(result, BaseException):
                raise result
            for item in result["items"]:
                key = item["key"]
                if key not in rows:
                    rows[key] = {**item, "source": provider["name"]}
        return {"items": list(rows.values())}
