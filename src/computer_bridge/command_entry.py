"""Install stable, per-user terminal commands independently of a release directory."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any

COMMANDS = ("closesi", "cs")
START = "# >>> Computer Bridge commands >>>"
END = "# <<< Computer Bridge commands <<<"


def _profile(path: Path, directory: Path) -> None:
    """Keep one owned block while preserving everything outside that block."""
    before = path.read_text(encoding="utf-8") if path.exists() else ""
    quoted = shlex.quote(str(directory))
    block = (
        START + "\n"
        + f"case \":$PATH:\" in *:{quoted}:*) ;; *) export PATH={quoted}:\"$PATH\" ;; esac\n"
        + END + "\n"
    )
    start = before.find(START)
    if start >= 0:
        end = before.index(END, start) + len(END)
        if before[end:end + 1] == "\n":
            end += 1
        after = before[:start] + block + before[end:]
    else:
        after = before + ("\n" if before and not before.endswith("\n") else "") + block
    if before != after:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(after, encoding="utf-8")


def _windows_path(directory: Path) -> None:
    import ctypes
    import winreg
    from ctypes import wintypes

    registry: Any = winreg

    def normalized(value: str) -> str:
        return os.path.normcase(os.path.normpath(os.path.expandvars(value)))

    with registry.CreateKeyEx(registry.HKEY_CURRENT_USER, "Environment", 0,
                             registry.KEY_QUERY_VALUE | registry.KEY_SET_VALUE) as key:
        try:
            previous, kind = registry.QueryValueEx(key, "Path")
        except FileNotFoundError:
            previous, kind = "", registry.REG_EXPAND_SZ
        entries = [entry for entry in previous.split(";") if entry]
        if normalized(str(directory)) not in {normalized(entry) for entry in entries}:
            value = str(directory) + (";" + previous if previous else "")
            registry.SetValueEx(key, "Path", 0, kind, value)
    # Existing parent terminals retain their own environment. Explorer can now
    # pass the updated user PATH to newly opened terminals.
    user32 = ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]
    send = user32.SendMessageTimeoutW
    send.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                     wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)]
    send.restype = ctypes.c_ssize_t
    environment = ctypes.c_wchar_p("Environment")
    result = ctypes.c_size_t()
    send(0xFFFF, 0x001A, 0, ctypes.cast(environment, ctypes.c_void_p).value,
         0x0002, 5000, ctypes.byref(result))


def register_commands(installation_home: Path, *, user_home: Path | None = None,
                      zdotdir: Path | None = None) -> dict[str, object]:
    """Create and validate commands, then register their directory for new shells."""
    installation_home = installation_home.expanduser().resolve()
    directory = installation_home / "bin"
    directory.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    if os.name == "nt":
        # These entry files must retain ASCII command syntax; the installation
        # directory is discovered relative to the wrapper, so Unicode paths work.
        content = (
            "@echo off\r\nsetlocal\r\n"
            'for %%I in ("%~dp0..") do set "BRIDGE_DATA=%%~fI"\r\n'
            'if defined COMPUTER_BRIDGE_HOME set "BRIDGE_DATA=%COMPUTER_BRIDGE_HOME%"\r\n'
            'for /f "tokens=2 delims=:" %%C in (\'chcp\') do set "BRIDGE_CODEPAGE=%%C"\r\n'
            "chcp 65001 >nul\r\n"
            'set /p BRIDGE_PYTHON=<"%BRIDGE_DATA%\\launcher-python.txt"\r\n'
            '"%BRIDGE_PYTHON%" "%BRIDGE_DATA%\\launcher.py" --home "%BRIDGE_DATA%" --command chat %*\r\n'
            'set "BRIDGE_EXIT=%errorlevel%"\r\n'
            "chcp %BRIDGE_CODEPAGE% >nul\r\n"
            "exit /b %BRIDGE_EXIT%\r\n"
        )
        for name in COMMANDS:
            path = directory / (name + ".cmd")
            path.write_bytes(content.encode("ascii"))
            paths.append(path)
    else:
        content = (
            "#!/bin/sh\nset -eu\n"
            'bridge_home="${COMPUTER_BRIDGE_HOME:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"\n'
            'bridge_python="$(cat "$bridge_home/launcher-python.txt")"\n'
            'exec "$bridge_python" "$bridge_home/launcher.py" --home "$bridge_home" --command chat "$@"\n'
        )
        for name in COMMANDS:
            path = directory / name
            path.write_text(content, encoding="utf-8")
            path.chmod(0o755)
            paths.append(path)

    environment = {**os.environ, "COMPUTER_BRIDGE_HOME": str(installation_home)}
    versions = []
    for path in paths:
        result = subprocess.run([str(path), "--version"], env=environment, check=True,
                                capture_output=True, text=True, encoding="utf-8")
        versions.append(result.stdout.strip())
        subprocess.run([str(path), "--help"], env=environment, check=True,
                       capture_output=True, text=True, encoding="utf-8")
    expected = json.loads((installation_home / "active.json").read_text(encoding="utf-8"))["version"]
    if versions != [expected] * len(COMMANDS):
        raise RuntimeError("终端命令实际版本与当前安装版本不一致")

    profiles: list[Path] = []
    if os.name == "nt":
        _windows_path(directory)
    else:
        personal = (user_home or Path.home()).expanduser().resolve()
        zsh = (zdotdir or Path(os.environ.get("ZDOTDIR", str(personal)))).expanduser().resolve()
        login = next((personal / name for name in (".bash_profile", ".bash_login", ".profile")
                      if (personal / name).exists()), personal / ".bash_profile")
        profiles = list(dict.fromkeys([zsh / ".zshrc", zsh / ".zprofile", personal / ".bashrc", login]))
        for profile in profiles:
            _profile(profile, directory)
    return {"commands": list(COMMANDS), "directory": str(directory), "version": expected,
            "profiles": [str(path) for path in profiles], "new_terminal_required": True}


def main() -> None:
    parser = argparse.ArgumentParser(description="Register Computer Bridge terminal commands")
    parser.add_argument("action", choices=["install"])
    parser.add_argument("--home", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(register_commands(args.home), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
