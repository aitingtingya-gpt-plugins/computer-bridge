"""Prepare a separate environment and hand it to the persistent launcher."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import time
import venv
import zipfile
from pathlib import Path
from typing import Any

from .common import Error, Json, save
from .module_dependencies import pin
from .power import Power
from .update_artifacts import download


class Update:
    def __init__(self, path: Path):
        self.path = path
        self.job = json.loads(path.read_text(encoding="utf-8"))
        self.home = path.parent.parent.parent
        self.config = self.home / "device.json"
        self.settings = json.loads(self.config.read_text(encoding="utf-8"))
        self.previous = self.job.get("previous") or json.loads((self.home / "active.json").read_text(encoding="utf-8"))
        self.job.update(previous=self.previous, helper_pid=os.getpid())
        self.job.setdefault("previous_modules", self.settings.get("modules", []))
        save(self.path, self.job)
        self.destination = self.home / "releases" / self.job["id"]
        self.destination.mkdir(parents=True, exist_ok=True)

    def state(self, state: str, message: str) -> None:
        self.job.update(state=state, message=message, changed_at=time.time())
        save(self.path, self.job)

    def cancelled(self) -> None:
        if self.path.with_suffix(".cancel").exists():
            raise Error("update_cancelled", "更新已取消，原版本保持运行")

    async def download(self, artifact: Json, target: Path) -> None:
        await download(self.settings, artifact, target, self.cancelled)

    async def command(self, python: Path, *args: str) -> None:
        options: dict[str, Any] = {"creationflags": 0x08000000} if os.name == "nt" else {}
        process = await asyncio.create_subprocess_exec(
            str(python), *args, env={**os.environ, "COMPUTER_BRIDGE_HOME": str(self.home)}, **options
        )
        code = await process.wait()
        if code:
            raise Error("update_install", "安装或校验步骤失败，退出码 " + str(code))

    async def prepare(self) -> Json:
        source = self.destination / "source"
        modules = dict(self.previous.get("modules", {}))
        enabled = list(self.settings.get("modules", []))
        kind = self.job["kind"]
        if kind == "core":
            archive = self.destination / "client.zip"
            await self.download(self.job["artifact"], archive)
            with zipfile.ZipFile(archive) as package:
                for member in package.namelist():
                    if not (source / member).resolve().is_relative_to(source.resolve()):
                        raise Error("update_archive", "安装包包含无效路径")
                package.extractall(source)
        else:
            shutil.copytree(
                self.previous["source"],
                source,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info", "node_modules"),
                dirs_exist_ok=True,
            )
            name = self.job["module"]
            if kind in {"module_install", "module_update"}:
                artifact = self.job["artifact"]
                wheel = self.destination / artifact["file"]
                await self.download(artifact, wheel)
                modules[name] = {
                    "wheel": str(wheel),
                    "version": artifact["version"],
                    "dependencies": artifact.get("dependencies", []),
                }
            if kind == "module_remove":
                modules.pop(name, None)
            if kind in {"module_disable", "module_remove"}:
                enabled = [item for item in enabled if item != name]
            elif self.job.get("enabled", True) and name not in enabled:
                enabled.append(name)
        self.state("installing", "安装独立环境")
        await asyncio.to_thread(venv.EnvBuilder(with_pip=True).create, self.destination / "env")
        python = self.destination / "env" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        await self.command(python, "-m", "pip", "install", "-c", str(source / "constraints.txt"), str(source))
        for module in modules.values():
            await self.command(python, "-m", "pip", "install", "--no-deps", module["wheel"])
        dependencies = {name for module in modules.values() for name in module.get("dependencies", [])}
        sources = dict(self.settings.get("module_dependency_sources", {}))
        for name, dependency in sources.items():
            if name in dependencies:
                sources[name] = await pin(python, self.home, name, dependency)
                await self.command(
                    python, "-m", "pip", "install", "-c", str(source / "constraints.txt"), sources[name]
                )
        await self.command(python, "-m", "computer_bridge", "install-runtime")
        await self.command(python, "-m", "computer_bridge", "verify")
        if kind == "module_enable":
            await self.command(
                python,
                "-c",
                "from computer_bridge.modules import Modules; "
                f"states=Modules({enabled!r}).status(); "
                f"state=next(s for s in states if s['id']=={self.job['module']!r}); "
                "raise SystemExit(0 if state['state']=='available' else state['state']+': '+state['error'])",
            )
        actual = await asyncio.create_subprocess_exec(
            str(python), "-m", "computer_bridge", "--version", stdout=asyncio.subprocess.PIPE
        )
        version = (await actual.communicate())[0].decode().strip()
        expected = self.job["artifact"]["version"] if kind == "core" else self.previous["version"]
        if actual.returncode or version != expected:
            raise Error("update_version", "安装后的实际版本不符")
        self.cancelled()
        return {
            "id": self.job["id"],
            "python": str(python),
            "source": str(source),
            "version": version,
            "modules": modules,
            "enabled": enabled,
            "dependency_sources": sources,
        }

    async def healthy(self, candidate: Json, seconds: int = 90) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            status_file = self.home / "agent-status.json"
            if status_file.exists():
                status = json.loads(status_file.read_text(encoding="utf-8"))
                if (
                    status.get("install_id") == candidate["id"]
                    and status.get("connected")
                    and status.get("version") == candidate["version"]
                ):
                    enabled = json.loads(self.config.read_text(encoding="utf-8")).get("lock_mode", {}).get("enabled", True)
                    if enabled and not status.get("lock_mode", {}).get("applied"):
                        raise Error("update_power", "新版组件未能接管防睡眠请求")
                    return
            await asyncio.sleep(0.5)
        raise Error("update_health", "组件未在期限内恢复连接")

    async def run(self) -> None:
        power: Power | None = None
        switched = False
        try:
            active = json.loads((self.home / "active.json").read_text(encoding="utf-8"))
            if active["id"] == self.job["id"]:
                switched = True
                power = Power(self.settings.get("lock_mode", {"enabled": True, "revision": 0}))
                await power.start()
                if power.setting["enabled"] and not power.applied:
                    raise Error("update_power", "临时防睡眠请求未能建立：" + power.error)
                await self.healthy(active)
                self.state("completed", "更新完成，实际版本 " + active["version"])
                return
            candidate = await self.prepare()
            self.state("waiting_idle", "等待正在运行的命令、请求和模块任务完成")
            while not self.path.with_suffix(".ready").exists():
                self.cancelled()
                await asyncio.sleep(0.5)
            self.cancelled()
            current = json.loads(self.config.read_text(encoding="utf-8"))
            power = Power(current.get("lock_mode", {"enabled": True, "revision": 0}))
            await power.start()
            if power.setting["enabled"] and not power.applied:
                raise Error("update_power", "临时防睡眠请求未能建立：" + power.error)
            self.state("switching", "切换后台组件")
            current["modules"] = candidate.pop("enabled")
            current["module_dependency_sources"] = candidate.pop("dependency_sources")
            save(self.config, current)
            save(self.home / "active.json", candidate)
            switched = True
            self.path.with_suffix(".go").touch()
            self.state("verifying", "等待新版组件连接并核验")
            await self.healthy(candidate)
            self.state("completed", "更新完成，实际版本 " + candidate["version"])
        except Exception as exc:
            if switched:
                current = json.loads(self.config.read_text(encoding="utf-8"))
                current["modules"] = self.job["previous_modules"]
                save(self.config, current)
                save(self.home / "active.json", self.previous)
                status_file = self.home / "agent-status.json"
                if status_file.exists():
                    status = json.loads(status_file.read_text(encoding="utf-8"))
                    if status.get("install_id") == self.job["id"]:
                        if os.name == "nt":
                            subprocess.run(
                                ["taskkill", "/PID", str(status["pid"]), "/F"],
                                check=False,
                                creationflags=0x08000000,
                            )
                        else:
                            import signal

                            try:
                                os.kill(status["pid"], signal.SIGTERM)
                            except ProcessLookupError:
                                pass
                try:
                    await self.healthy(self.previous)
                    self.state("rolled_back", str(exc) + "；原程序已恢复通信")
                except Error as restore:
                    self.state("failed", str(exc) + "；恢复原程序后：" + str(restore))
            else:
                self.state(
                    "cancelled" if getattr(exc, "code", "") == "update_cancelled" else "failed", str(exc)
                )
        finally:
            if power:
                await power.close()
            for suffix in (".ready", ".go", ".cancel"):
                self.path.with_suffix(suffix).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(Update(args.job).run())


if __name__ == "__main__":
    main()
