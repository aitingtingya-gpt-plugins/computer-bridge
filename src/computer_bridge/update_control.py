"""Authenticated management messages; update helpers never become model tools."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .common import Error, Json, background_options, save

FINISHED = {"completed", "failed", "cancelled", "rolled_back"}


def helper_running(pid: int) -> bool:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


class UpdateControl:
    def __init__(self, directory: Path):
        self.directory = directory / "updates"
        self.jobs = self.directory / "jobs"
        self.jobs.mkdir(parents=True, exist_ok=True)
        self.changed = asyncio.Event()
        self.report: Callable[[], None] = lambda: None
        if self.active():
            self.changed.set()
        self.helpers: dict[str, subprocess.Popen[Any]] = {}

    def active(self) -> list[Path]:
        return [p for p in self.jobs.glob("u*.json") if json.loads(p.read_text(encoding="utf-8"))["state"] not in FINISHED]

    def supported(self) -> bool:
        return os.environ.get("COMPUTER_BRIDGE_LAUNCHED") == "1"

    def start(self, value: Json) -> Json:
        if not self.supported():
            raise Error("update_bootstrap_required", "需要先安装更新组件")
        identity = value["id"]
        if not re.fullmatch(r"u[1-9][0-9]*", identity):
            raise Error("update_id", "更新任务号无效")
        path = self.jobs / (identity + ".json")
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]
        if self.active():
            raise Error("update_busy", "该电脑已有更新任务")
        save(path, {**value, "state": "preparing", "message": "准备更新"})
        self.launch(path)
        self.changed.set()
        return {"id": identity, "state": "preparing"}

    def launch(self, path: Path) -> None:
        with (self.directory / (path.stem + ".log")).open("ab") as log:
            self.helpers[path.stem] = subprocess.Popen(
                [sys.executable, "-m", "computer_bridge.updater", "--job", str(path)],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                **background_options(),
            )

    def cancel(self, identity: str) -> Json:
        if not re.fullmatch(r"u[1-9][0-9]*", identity):
            raise Error("update_id", "更新任务号无效")
        path = self.jobs / (identity + ".json")
        job = json.loads(path.read_text(encoding="utf-8"))
        if job["state"] in {"switching", "verifying"} | FINISHED:
            raise Error("update_cancel_late", "该任务已开始切换或已结束")
        path.with_suffix(".cancel").touch()
        self.changed.set()
        return {"id": identity, "cancel_requested": True}

    def states(self) -> list[Json]:
        return [
            {k: value.get(k) for k in ("id", "state", "message", "version", "kind", "module")}
            for p in self.jobs.glob("u*.json")
            if (value := json.loads(p.read_text(encoding="utf-8")))
        ]

    async def watch(self, computer: Any, stop: Callable[[], object]) -> None:
        previous = ""
        while True:
            await self.changed.wait()
            active = self.active()
            states = json.dumps(self.states(), sort_keys=True)
            if states != previous:
                previous = states
                self.report()
            for path in active:
                job = json.loads(path.read_text(encoding="utf-8"))
                child = self.helpers.get(path.stem)
                if child and child.poll() is not None:
                    self.helpers.pop(path.stem)
                    child = None
                if not child and (not job.get("helper_pid") or not helper_running(job["helper_pid"])):
                    self.launch(path)
                if job["state"] == "waiting_idle" and not path.with_suffix(".ready").exists():
                    busy = (
                        len(computer.requests.tasks)
                        + sum(op.state == "running" for op in computer.operations.entries.values())
                        + computer.modules.busy()
                    )
                    if not busy and not computer.access_lock.locked():
                        computer.draining = True
                        path.with_suffix(".ready").touch()
                if path.with_suffix(".go").exists():
                    path.with_suffix(".go").unlink()
                    stop()
                    return
                if job["state"] in FINISHED:
                    computer.draining = False
            if not active:
                computer.draining = False
                self.changed.clear()
            else:
                await asyncio.sleep(0.5)
