"""One-time migration of verified pre-Job launcher trees during source installation.

Process names are never a termination selector. Roots must match this exact
installation's argv and interpreter; handles retain creation identity until the
whole captured range is assigned to a Job and stopped.
"""
from __future__ import annotations

import base64
import ctypes
import json
import os
import secrets
import subprocess
import time
from ctypes import wintypes as w
from pathlib import Path

from .launcher import WindowsJob


def canonical(value: str | Path) -> str:
    return os.path.normcase(str(Path(value).resolve()))


def process_snapshot() -> dict[int, dict]:
    """Read exact CIM creation ticks, argv and executable without printing them."""
    powershell = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    command = """
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$rows = @(Get-CimInstance Win32_Process | ForEach-Object {
    [pscustomobject]@{
        pid = $_.ProcessId
        parent = $_.ParentProcessId
        created = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().Ticks.ToString() } else { '' }
        executable = $_.ExecutablePath
        command = $_.CommandLine
    }
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
"""
    result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive",
        "-EncodedCommand", base64.b64encode(command.encode("utf-16le")).decode("ascii")],
        capture_output=True, encoding="utf-8", check=True, creationflags=0x08000000, timeout=30)
    return {int(row["pid"]): row for row in json.loads(result.stdout)}


def command_arguments(command: str) -> list[str]:
    shell = ctypes.WinDLL("shell32", use_last_error=True)
    shell.CommandLineToArgvW.argtypes = [w.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype = ctypes.POINTER(w.LPWSTR)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes, kernel.LocalFree.restype = [w.HLOCAL], w.HLOCAL
    count = ctypes.c_int()
    pointer = shell.CommandLineToArgvW(command, ctypes.byref(count))
    if not pointer:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return [pointer[index] for index in range(count.value)]
    finally:
        kernel.LocalFree(pointer)


class LegacyWindowsMigration:
    def __init__(self, home: Path, old_python: str, launcher_python: str | None):
        self.home = home.resolve()
        self.handles: dict[int, object] = {}
        self.identities: dict[int, dict] = {}
        self.roots: set[int] = set()
        self.launchers: set[int] = set()
        self.job: WindowsJob | None = None
        self.jobs: list[WindowsJob] = []
        self.owns_job = False
        self.capture_complete = False
        executables = [old_python]
        if launcher_python:
            executables.append(launcher_python)
        # The venv redirector launches its base interpreter. Resolve this from
        # the old interpreter itself; no guessed process path is admitted.
        result = subprocess.run([old_python, "-c", "import sys; print(sys._base_executable)"],
            capture_output=True, encoding="utf-8", check=True, creationflags=0x08000000,
            env={**os.environ, "PYTHONUTF8": "1"}, timeout=15)
        executables.append(result.stdout.strip())
        self.allowed = {canonical(path) for path in executables}
        self.allowed.update(canonical(Path(path).with_name("pythonw.exe")) for path in executables)
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.OpenProcess.argtypes, self.api.OpenProcess.restype = [w.DWORD, w.BOOL, w.DWORD], w.HANDLE
        self.api.CloseHandle.argtypes = [w.HANDLE]
        self.api.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
        self.api.GetProcessTimes.argtypes = [w.HANDLE, ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME),
                                           ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME)]
        self.api.IsProcessInJob.argtypes = [w.HANDLE, w.HANDLE, ctypes.POINTER(w.BOOL)]
        self.api.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
        self.api.WaitForSingleObject.restype = w.DWORD
        self.api.TerminateProcess.argtypes, self.api.TerminateProcess.restype = [w.HANDLE, w.UINT], w.BOOL

    def matches(self, row: dict) -> bool:
        if not row.get("command") or not row.get("executable") or canonical(row["executable"]) not in self.allowed:
            return False
        argv = command_arguments(row["command"])
        if not argv or canonical(argv[0]) not in self.allowed:
            return False
        launcher = len(argv) == 4 and canonical(argv[1]) == canonical(self.home / "launcher.py") \
            and argv[2] == "--home" and canonical(argv[3]) == canonical(self.home)
        agent = len(argv) == 6 and argv[1:4] == ["-m", "computer_bridge", "serve"] \
            and argv[4] == "--config" and canonical(argv[5]) == canonical(self.home / "device.json")
        return launcher or agent

    def verified_handle(self, row: dict) -> object | None:
        handle = self.api.OpenProcess(0x100000 | 0x1000 | 0x0100 | 0x0001, False, row["pid"])
        if not handle:
            if ctypes.get_last_error() == 87:  # exited between snapshot and open
                return None
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            created, ended, kernel, user = (w.FILETIME() for _ in range(4))
            if not self.api.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(ended),
                                           ctypes.byref(kernel), ctypes.byref(user)):
                raise ctypes.WinError(ctypes.get_last_error())
            ticks = (created.dwHighDateTime << 32) | created.dwLowDateTime
            # CIM timestamps have microsecond precision; FILETIME has 100 ns precision.
            expected = int(row["created"]) - 504911232000000000
            if ticks // 10 != expected // 10:
                raise RuntimeError("Legacy process identity changed during capture; installation was not switched")
            size = w.DWORD(32768)
            image = ctypes.create_unicode_buffer(size.value)
            if not self.api.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(size)):
                raise ctypes.WinError(ctypes.get_last_error())
            if canonical(image.value) != canonical(row["executable"]):
                raise RuntimeError("Legacy process executable changed during capture")
            return handle
        except BaseException:
            self.api.CloseHandle(handle)
            raise

    def capture(self) -> None:
        rows = process_snapshot()
        roots = {pid for pid, row in rows.items() if self.matches(row)}
        ancestors = set()
        parent = os.getpid()
        while parent and parent not in ancestors:
            ancestors.add(parent)
            parent = rows.get(parent, {}).get("parent", 0)
        if roots & ancestors:
            raise RuntimeError("请从 Computer Bridge 外部运行安装器；安装器处于待停止的旧组件进程树内")
        existing = WindowsJob(self.home, existing=True)
        if existing.handle:
            self.job = existing
            self.jobs.append(existing)
            # The supervisor owns this Job but is deliberately outside it.
            # Retain its verified identity even if /End has not finished yet.
            for pid in roots:
                handle = self.verified_handle(rows[pid])
                if handle is not None:
                    self.remember(rows[pid], handle, root=True)
            self.capture_complete = True
            return
        existing.close()
        if not roots:
            return
        # Keep identity handles until completion: Windows cannot recycle these PIDs.
        # Attach roots first so their newly created children immediately inherit Job ownership.
        self.owns_job = True
        pending = roots
        deadline = time.monotonic() + 30
        while pending:
            def depth(pid: int) -> int:
                visited = set()
                while pid in rows and pid not in visited:
                    visited.add(pid)
                    pid = rows[pid].get("parent", 0)
                return len(visited)

            for pid in sorted(pending, key=depth):
                row = rows[pid]
                if not row.get("executable") or not row.get("created"):
                    raise RuntimeError("Cannot verify a legacy descendant; refusing an incomplete migration")
                handle = self.verified_handle(row)
                if handle is None:
                    continue
                self.remember(row, handle, root=pid in roots)
                captured = False
                for job in self.jobs:
                    inside = w.BOOL()
                    if not self.api.IsProcessInJob(handle, job.handle, ctypes.byref(inside)):
                        raise ctypes.WinError(ctypes.get_last_error())
                    captured = captured or bool(inside.value)
                if not captured and self.api.WaitForSingleObject(handle, 0) != 0:
                    # Already-running processes can belong to different job chains.
                    # Windows requires an EMPTY new Job for each such attachment;
                    # new children subsequently inherit that process's owned Job.
                    job = WindowsJob(self.home / ("legacy-" + str(pid) + "-" + secrets.token_hex(8)))
                    if not job.api.AssignProcessToJobObject(job.handle, handle):
                        error = ctypes.get_last_error()
                        job.close()
                        if self.api.WaitForSingleObject(handle, 0) != 0:
                            raise OSError(error, f"Cannot capture verified legacy PID {pid} in a migration Job")
                    else:
                        self.jobs.append(job)
            rows = process_snapshot()
            pending = {pid for pid, row in rows.items() if row.get("parent") in self.handles and pid not in self.handles}
            if time.monotonic() >= deadline:
                raise TimeoutError("Legacy process-tree capture did not settle; installation was not switched")
        self.capture_complete = True

    def remember(self, row: dict, handle: object, *, root: bool) -> None:
        pid = row["pid"]
        self.handles[pid] = handle
        self.identities[pid] = row
        if root:
            self.roots.add(pid)
            argv = command_arguments(row["command"])
            if len(argv) == 4 and canonical(argv[1]) == canonical(self.home / "launcher.py"):
                self.launchers.add(pid)

    def describe(self, pids: set[int]) -> str:
        return json.dumps([
            {key: self.identities[pid].get(key) for key in ("pid", "created", "executable")}
            for pid in sorted(pids)
        ], ensure_ascii=False)

    def stop_and_wait(self) -> None:
        deadline = time.monotonic() + 15

        def wait(pids: set[int], stage: str) -> None:
            for pid in pids:
                remaining = max(0, int((deadline - time.monotonic()) * 1000))
                state = self.api.WaitForSingleObject(self.handles[pid], remaining)
                if state == 0xFFFFFFFF:
                    raise ctypes.WinError(ctypes.get_last_error())
                if state != 0:
                    raise TimeoutError(f"旧组件退出超时 ({stage}): {self.describe(pids)}")

        def terminate(pids: set[int]) -> None:
            for pid in pids:
                handle = self.handles[pid]
                state = self.api.WaitForSingleObject(handle, 0)
                if state == 0xFFFFFFFF:
                    raise ctypes.WinError(ctypes.get_last_error())
                if state != 0 and not self.api.TerminateProcess(handle, 1):
                    error = ctypes.get_last_error()
                    # TerminateProcess returns access denied for a process whose
                    # termination is already in progress. Its retained handle
                    # still has to signal; do not misreport that interval.
                    if error == 5:
                        wait({pid}, "terminating")
                        continue
                    if self.api.WaitForSingleObject(handle, 0) != 0:
                        raise OSError(error, f"无法停止旧组件: {self.describe({pid})}")

        # End the supervisors before their children so no old generation can respawn.
        terminate(self.launchers)
        wait(self.launchers, "launcher")
        terminate(self.roots - self.launchers)
        for job in self.jobs:
            job.terminate()
        for job in self.jobs:
            try:
                job.wait_empty(timeout=max(0, deadline - time.monotonic()))
            except TimeoutError as error:
                raise TimeoutError(f"旧组件退出超时 (job): {self.describe(set(self.handles))}") from error
        wait(set(self.handles), "process")
        # No same-installation agent is allowed to remain outside the captured range.
        remaining = [row for row in process_snapshot().values() if self.matches(row)]
        if remaining:
            details = [{key: row.get(key) for key in ("pid", "created", "executable")} for row in remaining]
            raise RuntimeError("旧版本组件仍在运行，尚未切换安装: " + json.dumps(details, ensure_ascii=False))

    def close(self) -> None:
        for job in self.jobs:
            if self.owns_job and not self.capture_complete:
                # Capture failure must leave the old installation running. No
                # limits except kill-on-close were added; remove that flag before
                # releasing the partially populated Job.
                information = ctypes.create_string_buffer(144)
                job.check(job.api.SetInformationJobObject(job.handle, 9, information, 144))
            job.close()
        self.jobs.clear()
        for handle in self.handles.values():
            self.api.CloseHandle(handle)
        self.handles.clear()
        self.identities.clear()
        self.roots.clear()
        self.launchers.clear()
