"""Install the source-only computer component with the user's existing Python."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
import venv
from pathlib import Path


def status_revision(destination: Path) -> int:
    try:
        return (destination / "agent-status.json").stat().st_mtime_ns
    except FileNotFoundError:
        return 0


def wait_connected(destination: Path, active: dict, previous_revision: int, *, seconds: float = 90) -> None:
    """Require a fresh connected generation, including the original lock-mode setting."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            path = destination / "agent-status.json"
            actual = json.loads(path.read_text(encoding="utf-8"))
            setting = json.loads((destination / "device.json").read_text(encoding="utf-8"))
            if (path.stat().st_mtime_ns != previous_revision
                and actual.get("install_id") == active["id"]
                and actual.get("version") == active["version"]
                and actual.get("connected")
                and (not setting.get("lock_mode", {}).get("enabled", True)
                     or actual.get("lock_mode", {}).get("applied"))):
                return
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        time.sleep(0.1)
    raise RuntimeError("组件未在期限内恢复服务器连接并接管电源请求，安装 ID: " + active["id"])


def main(*, connection_timeout: float = 90) -> None:
    parser = argparse.ArgumentParser(description="Install Computer Bridge from source")
    parser.add_argument("--server", required=True, help="Your service base URL, without /mcp")
    parser.add_argument("--name")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--module-wheel", action="append", default=[])
    parser.add_argument("--dependency-source", action="append", default=[])
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    destination = Path(os.environ.get("COMPUTER_BRIDGE_HOME", str(Path.home() / ".computer-bridge")))
    env = {**os.environ, "COMPUTER_BRIDGE_HOME": str(destination), "PYTHONUTF8": "1"}
    identity = "bootstrap-" + uuid.uuid4().hex[:12]
    release = destination / "releases" / identity
    local_source = release / "source"
    local_source.mkdir(parents=True)
    for name in ("pyproject.toml", "constraints.txt", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(source / name, local_source / name)
    shutil.copytree(
        source / "src",
        local_source / "src",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules", "*.egg-info"),
    )
    old_config = (
        json.loads((destination / "device.json").read_text(encoding="utf-8"))
        if (destination / "device.json").exists()
        else {}
    )
    old_active = (
        json.loads((destination / "active.json").read_text(encoding="utf-8"))
        if (destination / "active.json").exists()
        else {}
    )
    launcher_path = destination / "launcher.py"
    previous_launcher = launcher_path.read_bytes() if launcher_path.exists() else None
    launcher_python_path = destination / "launcher-python.txt"
    previous_launcher_python = launcher_python_path.read_bytes() if launcher_python_path.exists() else None
    old_python = old_active.get(
        "python", str(destination / "env" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
    )
    venv.EnvBuilder(with_pip=True).create(release / "env")
    python = release / "env" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    def run(*command: str) -> None:
        subprocess.run([str(python), *command], env=env, check=True)

    run("-m", "pip", "install", "-c", str(local_source / "constraints.txt"), str(local_source))
    run(
        "-m",
        "computer_bridge",
        "setup",
        "--server",
        args.server,
        "--name",
        args.name or old_config.get("name") or platform.node(),
    )
    run(
        "-m",
        "computer_bridge.bootstrap",
        "--source",
        str(local_source),
        "--release",
        str(release),
        "--old-python",
        old_python,
        *[arg for item in args.module_wheel for arg in ("--module-wheel", item)],
        *[arg for item in args.dependency_source for arg in ("--dependency-source", item)],
    )
    run("-m", "computer_bridge", "install-runtime")
    run("-m", "computer_bridge", "verify")
    configuration = json.loads((destination / "device.json").read_text(encoding="utf-8"))
    if "device_key" not in configuration:
        print("Approve the displayed pairing code at your service's /manage page.", flush=True)
        run("-m", "computer_bridge", "register", *(["--no-browser"] if args.no_browser else []))
    old_running = False
    if old_config:
        while True:
            pending = [
                p
                for p in (destination / "operations").glob("*/metadata.json")
                if not (p.parent / "result.json").exists()
            ]
            database = destination / "requests/requests.sqlite3"
            requests = 0
            if database.exists():
                with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as connection:
                    requests = connection.execute(
                        "SELECT count(*) FROM requests WHERE state='running'"
                    ).fetchone()[0]
            if not pending and not requests:
                break
            print("等待当前电脑操作完成后切换…", flush=True)
            time.sleep(2)
        status = subprocess.run(
            [old_python, "-m", "computer_bridge", "status"], env=env, capture_output=True,
            text=True, encoding="utf-8"
        )
        old_running = (
            status.returncode == 0
            and json.loads(status.stdout).get("installed")
            and (os.name == "nt" or json.loads(status.stdout).get("running"))
        )
    signal_file = release / "power-handoff.release"
    handoff = subprocess.Popen(
        [
            str(python),
            "-m",
            "computer_bridge.power_handoff",
            "--config",
            str(destination / "device.json"),
            "--release",
            str(signal_file),
            "--parent",
            str(os.getpid()),
        ],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        text=True, encoding="utf-8",
        creationflags=0x08000000 if os.name == "nt" else 0,
    )
    switched = False
    stopped = False
    launcher_replaced = False
    migration = None
    try:
        ready = handoff.stdout.readline()
        if not ready or not json.loads(ready).get("ready"):
            raise RuntimeError("更新交接未能取得防睡眠请求，原程序保持运行")
        if os.name == "nt" and old_config and Path(old_python).is_file():
            # Import only the new stdlib migration helper from the staged source.
            # Capture the old tree BEFORE schtasks /End can orphan its children.
            sys.path.insert(0, str(local_source / "src"))
            from computer_bridge.legacy_windows import LegacyWindowsMigration

            migration = LegacyWindowsMigration(destination, old_python, old_config.get("launcher_python"))
            migration.capture()
            stopped = old_running or bool(migration.handles)
        if old_running:
            subprocess.run([old_python, "-m", "computer_bridge", "stop"], env=env, check=True)
            stopped = True
        if migration:
            migration.stop_and_wait()
            migration.close()
            migration = None
        launcher = local_source / "src/computer_bridge/launcher.py"
        shutil.copyfile(launcher, launcher_path)
        launcher_replaced = True
        configuration = json.loads((destination / "device.json").read_text(encoding="utf-8"))
        configuration["launcher_python"] = sys._base_executable
        (destination / "launcher-python.txt").write_text(sys._base_executable, encoding="utf-8")
        (destination / "device.json").write_text(json.dumps(configuration, ensure_ascii=False, indent=2), encoding="utf-8")
        modules = json.loads((release / "modules.json").read_text(encoding="utf-8"))
        active = {
            "id": identity,
            "python": str(python),
            "source": str(local_source),
            "version": subprocess.check_output(
                [str(python), "-m", "computer_bridge", "--version"], text=True, encoding="utf-8", env=env
            ).strip(),
            "modules": modules,
        }
        temporary = destination / "active.json.tmp"
        temporary.write_text(json.dumps(active), encoding="utf-8")
        os.replace(temporary, destination / "active.json")
        switched = True
        previous_revision = status_revision(destination)
        run("-m", "computer_bridge", "install-service")
        run("-m", "computer_bridge", "status")
        wait_connected(destination, active, previous_revision, seconds=connection_timeout)
        chat_entry = "chat.cmd" if os.name == "nt" else "chat-macos.command"
        chat_target = destination / ("chat.cmd" if os.name == "nt" else "chat.command")
        shutil.copyfile(source / chat_entry, chat_target)
        if os.name != "nt":
            chat_target.chmod(0o755)
    except Exception:
        if migration:
            migration.close()
            migration = None
        if switched:
            status = subprocess.run(
                [str(python), "-m", "computer_bridge", "status"], env=env, capture_output=True,
                text=True, encoding="utf-8"
            )
            if status.returncode == 0 and (os.name == "nt" or json.loads(status.stdout).get("running")):
                subprocess.run([str(python), "-m", "computer_bridge", "stop"], env=env, check=True)
            if old_active:
                (destination / "active.json").write_text(json.dumps(old_active), encoding="utf-8")
            else:
                (destination / "active.json").unlink(missing_ok=True)
        if launcher_replaced:
            if previous_launcher is None:
                launcher_path.unlink(missing_ok=True)
            else:
                launcher_path.write_bytes(previous_launcher)
            if previous_launcher_python is None:
                launcher_python_path.unlink(missing_ok=True)
            else:
                launcher_python_path.write_bytes(previous_launcher_python)
            configuration = json.loads((destination / "device.json").read_text(encoding="utf-8"))
            if "launcher_python" in old_config:
                configuration["launcher_python"] = old_config["launcher_python"]
            else:
                configuration.pop("launcher_python", None)
            (destination / "device.json").write_text(json.dumps(configuration, ensure_ascii=False, indent=2), encoding="utf-8")
        if stopped:
            previous_revision = status_revision(destination)
            subprocess.run([old_python, "-m", "computer_bridge", "install-service"], env=env, check=True)
            if old_active:
                wait_connected(destination, old_active, previous_revision, seconds=connection_timeout)
                print("原版本已恢复服务器连接。", flush=True)
        raise
    finally:
        signal_file.touch()
        try:
            handoff.wait(timeout=10)
        except subprocess.TimeoutExpired:
            handoff.terminate()
            handoff.wait()
    print("Computer Bridge installed. You may close the installer.", flush=True)


if __name__ == "__main__":
    main()
