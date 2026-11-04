"""Standard-library supervisor copied outside replaceable environments.

One Windows Job belongs to the supervisor lifetime, allowing the updater to
survive agent restarts. Creation follows DSH's suspended/assign/resume order;
this launcher lifecycle plumbing does not implement or modify the sandbox.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import time
from pathlib import Path


def job_name(home: Path) -> str:
    identity = os.path.normcase(str(home.resolve())).encode("utf-8")
    return "Local\\ComputerBridge-" + hashlib.sha256(identity).hexdigest()


class WindowsJob:
    """Non-inheritable kill-on-close Job; every agent descendant stays inside it."""

    def __init__(self, home: Path, *, existing: bool = False):
        import ctypes
        from ctypes import wintypes as w

        self.ctypes, self.w = ctypes, w
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.handle = None
        bindings = {
            "CreateJobObjectW": ([w.LPVOID, w.LPCWSTR], w.HANDLE),
            "OpenJobObjectW": ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
            "SetInformationJobObject": ([w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD], w.BOOL),
            "QueryInformationJobObject": ([w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD, w.LPVOID], w.BOOL),
            "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
            "TerminateJobObject": ([w.HANDLE, w.UINT], w.BOOL),
            "TerminateProcess": ([w.HANDLE, w.UINT], w.BOOL),
            "ResumeThread": ([w.HANDLE], w.DWORD),
            "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
            "GetExitCodeProcess": ([w.HANDLE, ctypes.POINTER(w.DWORD)], w.BOOL),
            "CloseHandle": ([w.HANDLE], w.BOOL),
            "CreateProcessW": ([w.LPCWSTR, w.LPWSTR, w.LPVOID, w.LPVOID, w.BOOL,
                                w.DWORD, w.LPVOID, w.LPCWSTR, w.LPVOID, w.LPVOID], w.BOOL),
        }
        for name, (arguments, result) in bindings.items():
            function = getattr(self.api, name)
            function.argtypes, function.restype = arguments, result
        if existing:
            # This observer keeps the Job alive, so stop must explicitly terminate
            # it after ending the task, then await the entire range becoming empty.
            self.handle = self.api.OpenJobObjectW(0x0004 | 0x0008, False, job_name(home))
            if not self.handle and ctypes.get_last_error() != 2:
                raise ctypes.WinError(ctypes.get_last_error())
            return
        if ctypes.sizeof(ctypes.c_void_p) != 8:
            raise RuntimeError("Computer Bridge requires 64-bit Python on Windows")
        ctypes.set_last_error(0)
        self.handle = self.api.CreateJobObjectW(None, job_name(home))
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:
            self.close()
            raise RuntimeError("Computer Bridge launcher is already running for this installation")
        try:
            # Verified x64 layout/constants from DSH win32-process/abi.ts.
            information = ctypes.create_string_buffer(144)
            w.DWORD.from_buffer(information, 16).value = 0x2000
            self.check(self.api.SetInformationJobObject(self.handle, 9, information, 144))
        except BaseException:
            self.close()
            raise

    def check(self, result: object) -> None:
        if not result:
            raise self.ctypes.WinError(self.ctypes.get_last_error())

    def active_count(self) -> int:
        if not self.handle:
            return 0
        information = self.ctypes.create_string_buffer(48)
        self.check(self.api.QueryInformationJobObject(self.handle, 1, information, 48, None))
        return self.w.DWORD.from_buffer(information, 40).value

    def terminate(self) -> None:
        if self.handle:
            self.check(self.api.TerminateJobObject(self.handle, 1))

    def wait_empty(self, timeout: float = 15) -> None:
        deadline = time.monotonic() + timeout
        while self.active_count():
            if time.monotonic() >= deadline:
                raise TimeoutError("Computer Bridge process tree did not stop within the deadline")
            time.sleep(0.05)

    def spawn(self, argv: list[str], environment: dict[str, str], home: Path) -> WindowsProcess:
        import msvcrt

        c, w = self.ctypes, self.w

        class StartupInfo(c.Structure):
            _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR),
                        ("title", w.LPWSTR), ("x", w.DWORD), ("y", w.DWORD),
                        ("width", w.DWORD), ("height", w.DWORD), ("xchars", w.DWORD),
                        ("ychars", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD),
                        ("show", w.WORD), ("reserved_size", w.WORD), ("reserved_data", w.LPVOID),
                        ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]

        class ProcessInfo(c.Structure):
            _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE),
                        ("pid", w.DWORD), ("tid", w.DWORD)]

        startup, info = StartupInfo(), ProcessInfo()
        startup.cb = c.sizeof(startup)
        startup.flags, startup.show = 0x100 | 0x1, 0
        command = c.create_unicode_buffer(subprocess.list2cmdline(argv))
        entries = sorted(environment.items(), key=lambda item: item[0].upper())
        block = c.create_unicode_buffer("\0".join(f"{key}={value}" for key, value in entries) + "\0\0")
        # SW_HIDE preserves console inheritance. No CREATE_NO_WINDOW or
        # CREATE_NEW_CONSOLE on the agent or its restricted descendants.
        with open(os.devnull, "rb") as stdin, (home / "launcher.out.log").open("ab") as stdout, \
                (home / "launcher.err.log").open("ab") as stderr:
            handles = [msvcrt.get_osfhandle(stream.fileno()) for stream in (stdin, stdout, stderr)]
            startup.stdin, startup.stdout, startup.stderr = handles
            try:
                for handle in handles:
                    os.set_handle_inheritable(handle, True)
                self.check(self.api.CreateProcessW(argv[0], command, None, None, True,
                    0x4 | 0x400, block, str(home), c.byref(startup), c.byref(info)))
            finally:
                for handle in handles:
                    os.set_handle_inheritable(handle, False)
        try:
            self.check(self.api.AssignProcessToJobObject(self.handle, info.process))
            if self.api.ResumeThread(info.thread) == 0xFFFFFFFF:
                raise c.WinError(c.get_last_error())
        except BaseException:
            self.api.TerminateProcess(info.process, 1)
            self.api.CloseHandle(info.process)
            raise
        finally:
            self.api.CloseHandle(info.thread)
        return WindowsProcess(self, info.process, info.pid)

    def close(self) -> None:
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


class WindowsProcess:
    def __init__(self, job: WindowsJob, handle: object, pid: int):
        self.job, self.handle, self.pid = job, handle, pid
        self.returncode: int | None = None

    def poll(self) -> int | None:
        if self.returncode is None:
            result = self.job.api.WaitForSingleObject(self.handle, 0)
            if result == 0xFFFFFFFF:
                raise self.job.ctypes.WinError(self.job.ctypes.get_last_error())
            if result == 0:
                code = self.job.w.DWORD()
                self.job.check(self.job.api.GetExitCodeProcess(self.handle, self.job.ctypes.byref(code)))
                self.returncode = code.value
        return self.returncode

    def wait(self) -> int:
        while (code := self.poll()) is None:
            time.sleep(0.05)
        return code

    def terminate(self) -> None:
        if self.poll() is None:
            self.job.check(self.job.api.TerminateProcess(self.handle, 1))

    def close(self) -> None:
        if self.handle:
            self.job.api.CloseHandle(self.handle)
            self.handle = None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    args.home = args.home.resolve()
    if os.name == "nt":
        os.environ["PYTHONUTF8"] = "1"
    if args.command is not None:
        active = json.loads((args.home / "active.json").read_text(encoding="utf-8"))
        result = subprocess.run(
            [active["python"], "-m", "computer_bridge", *args.command],
            env={**os.environ, "COMPUTER_BRIDGE_HOME": str(args.home)},
        )
        raise SystemExit(result.returncode)
    stopping = False
    child: subprocess.Popen[bytes] | WindowsProcess | None = None
    job = WindowsJob(args.home) if os.name == "nt" else None

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        if job:
            job.terminate()
        elif child and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not stopping:
            active = json.loads((args.home / "active.json").read_text(encoding="utf-8"))
            environment = {
                **os.environ,
                "COMPUTER_BRIDGE_HOME": str(args.home),
                "COMPUTER_BRIDGE_LAUNCHED": "1",
                "COMPUTER_BRIDGE_INSTALL_ID": active["id"],
            }
            argv = [active["python"], "-m", "computer_bridge", "serve", "--config", str(args.home / "device.json")]
            child = job.spawn(argv, environment, args.home) if job else subprocess.Popen(argv, env=environment)
            child.wait()
            if isinstance(child, WindowsProcess):
                child.close()
            if not stopping:
                time.sleep(0.5)
    finally:
        if job:
            try:
                job.terminate()
                job.wait_empty()
            finally:
                job.close()
                if isinstance(child, WindowsProcess):
                    child.close()


if __name__ == "__main__":
    main()
