"""Human setup, pairing, optional modules and platform background lifecycle."""

from __future__ import annotations

import argparse
import asyncio
import json
import locale
import os
import platform
import plistlib
import subprocess
import sys
import time
import webbrowser
import zipfile
from importlib.resources import files
from importlib.resources.abc import Traversable
from pathlib import Path

import httpx2

from . import __version__
from .common import Error, Json, home, save, uid


def setup(config: Path, server: str, name: str) -> Json:
    data = (
        json.loads(config.read_text(encoding="utf-8"))
        if config.exists()
        else {
            "device_id": uid("computer"),
            "modules": [],
            "access": {"full_access": False, "workspaces": [], "revision": 0},
            "lock_mode": {"enabled": True, "revision": 0},
        }
    )
    if data.get("server") and data["server"] != server.rstrip("/"):
        data.pop("device_key", None)
    data.update({"server": server.rstrip("/"), "name": name})
    save(config, data)
    return {"config": str(config), "device_id": data["device_id"], "name": name, "server": server}


async def register(config: Path, browser: bool = True) -> Json:
    from .network import http_client

    data = json.loads(config.read_text(encoding="utf-8"))
    async with http_client(data) as http:
        response = await http.post(
            data["server"] + "/device/pair",
            json={"device_id": data["device_id"], "name": data["name"], "system": platform.system()},
        )
        response.raise_for_status()
        pending = response.json()
        print(
            json.dumps(
                {"pair_code": pending["code"], "verification_url": pending["verification_url"]},
                ensure_ascii=False,
            ),
            flush=True,
        )
        if browser:
            webbrowser.open(pending["verification_url"])
        while time.time() < pending["expires_at"]:
            reply = await http.get(data["server"] + "/device/pair/" + pending["id"])
            reply.raise_for_status()
            outcome = reply.json()
            if outcome["status"] == "approved":
                data["device_key"] = outcome["device_key"]
                if "access" in outcome:
                    data["access"] = outcome["access"]
                save(config, data)
                return {"registered": True, "device_id": data["device_id"], "name": data["name"]}
            if outcome["status"] == "denied":
                raise Error("pair_denied", "操作者没有批准这台电脑")
            await asyncio.sleep(2)
    raise Error("pair_expired", "配对已过期，请重新注册")


def module(config: Path, enabled: bool, package: str | None, name: str = "work-tree") -> Json:
    from .modules import Modules

    if package:
        subprocess.run([sys.executable, "-m", "pip", "install", package], check=True)
    data = json.loads(config.read_text(encoding="utf-8"))
    names = set(data.get("modules", []))
    if enabled:
        registry = Modules([name])
        entry = registry.get(name)
        entry.configure()
        names.add(name)
    else:
        names.discard(name)
    data["modules"] = sorted(names)
    save(config, data)
    return {"module": name, "enabled": enabled, "restart_device_component": True}


def service(config: Path, action: str) -> Json:
    data = json.loads(config.read_text(encoding="utf-8"))
    identity = data["device_id"]
    args = [sys.executable, "-m", "computer_bridge", "serve", "--config", str(config)]
    if (config.parent / "active.json").exists():
        args = [data["launcher_python"], str(config.parent / "launcher.py"), "--home", str(config.parent)]
    if sys.platform == "darwin":
        label = "com.computer-bridge." + identity
        destination = Path.home() / "Library/LaunchAgents" / (label + ".plist")
        domain = "gui/" + str(os.getuid())
        if action == "install":
            destination.parent.mkdir(parents=True, exist_ok=True)
            definition = {
                "Label": label,
                "ProgramArguments": args,
                "RunAtLoad": True,
                "KeepAlive": True,
                "ThrottleInterval": 10,
                "EnvironmentVariables": {
                    "COMPUTER_BRIDGE_HOME": str(config.parent),
                    "PATH": str(Path(sys.executable).parent)
                    + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                },
                "StandardOutPath": str(config.parent / "agent.out.log"),
                "StandardErrorPath": str(config.parent / "agent.err.log"),
            }
            destination.write_bytes(plistlib.dumps(definition))
            destination.chmod(0o600)
            subprocess.run(["launchctl", "bootstrap", domain, str(destination)], check=True)
        elif action == "stop":
            subprocess.run(["launchctl", "bootout", domain + "/" + label], check=True)
        elif action == "start":
            subprocess.run(["launchctl", "bootstrap", domain, str(destination)], check=True)
        elif action == "status":
            result = subprocess.run(
                ["launchctl", "print", domain + "/" + label], capture_output=True, text=True
            )
            return {
                "device_id": identity,
                "installed": destination.exists(),
                "running": "state = running" in result.stdout,
            }
    elif os.name == "nt":
        task = "ComputerBridge-" + identity
        if action == "install":
            pythonw = Path(args[0]).with_name("pythonw.exe")
            args[0] = str(pythonw)
            # Use an explicit task definition rather than scheduler defaults (battery/72-hour limit).
            from xml.etree.ElementTree import Element, SubElement, tostring

            namespace = "http://schemas.microsoft.com/windows/2004/02/mit/task"
            definition = Element("Task", {"version": "1.2", "xmlns": namespace})
            trigger = SubElement(SubElement(definition, "Triggers"), "LogonTrigger")
            SubElement(trigger, "Enabled").text = "true"
            principal = SubElement(SubElement(definition, "Principals"), "Principal", {"id": "User"})
            user = subprocess.check_output(["whoami"], text=True, encoding=locale.getencoding()).strip()
            SubElement(principal, "UserId").text = user
            SubElement(principal, "LogonType").text = "InteractiveToken"
            SubElement(principal, "RunLevel").text = "LeastPrivilege"
            settings = SubElement(definition, "Settings")
            for name, value in {
                "MultipleInstancesPolicy": "IgnoreNew",
                "DisallowStartIfOnBatteries": "false",
                "StopIfGoingOnBatteries": "false",
                "ExecutionTimeLimit": "PT0S",
            }.items():
                SubElement(settings, name).text = value
            restart = SubElement(settings, "RestartOnFailure")
            SubElement(restart, "Interval").text = "PT1M"
            SubElement(restart, "Count").text = "3"
            command = SubElement(SubElement(definition, "Actions", {"Context": "User"}), "Exec")
            SubElement(command, "Command").text = args[0]
            SubElement(command, "Arguments").text = subprocess.list2cmdline(args[1:])
            task_file = config.parent / "background-task.xml"
            task_file.write_bytes(tostring(definition, encoding="utf-16", xml_declaration=True))
            subprocess.run(
                [
                    "schtasks",
                    "/Create",
                    "/TN",
                    task,
                    "/XML",
                    str(task_file),
                    "/F",
                ],
                check=True,
            )
            subprocess.run(["schtasks", "/Run", "/TN", task], check=True)
        elif action == "start":
            subprocess.run(["schtasks", "/Run", "/TN", task], check=True)
        elif action == "stop":
            from .legacy_windows import LegacyWindowsMigration

            # The same verified stop covers install, rollback and manual control.
            # A named Job does not include the supervisor that can respawn it.
            migration = LegacyWindowsMigration(config.parent, sys.executable, data.get("launcher_python"))
            try:
                migration.capture()
                subprocess.run(["schtasks", "/End", "/TN", task], check=True)
                migration.stop_and_wait()
            finally:
                migration.close()
        elif action == "status":
            from .launcher import WindowsJob

            result = subprocess.run(
                ["schtasks", "/Query", "/TN", task, "/FO", "CSV"], capture_output=True,
                text=True, encoding=locale.getencoding()
            )
            job = WindowsJob(config.parent, existing=True)
            try:
                count = job.active_count()
                return {"device_id": identity, "installed": result.returncode == 0,
                        "running": count > 0, "managed_processes": count, "task": result.stdout}
            finally:
                job.close()
    else:
        raise Error("platform", "首版后台安装支持 macOS 和 Windows；当前可用 serve 前台运行")
    return {"device_id": identity, "action": action, "completed": True}


def package(server: str, destination: Path) -> Json:
    from urllib.parse import urlsplit

    if urlsplit(server).scheme != "https":
        raise Error("public_url", "插件连接需要实际 HTTPS 地址")
    resources = files("computer_bridge").joinpath("plugin")
    manifest = {
        "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        "name": "computer-bridge",
        "version": __version__,
        "description": "Operate your registered computers; Work Tree is optional.",
        "extensions": {
            "com.openai": {
                "interface": {
                    "displayName": "Computer Bridge",
                    "shortDescription": "操作已注册电脑的文件与终端，可选 Work Tree",
                    "capabilities": ["Read", "Write"],
                }
            }
        },
    }
    mcp = {
        "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {
            "computer_bridge": {
                "type": "streamable-http",
                "url": server.rstrip("/") + "/mcp",
                "extensions": {"com.openai": {"auth": {"type": "oauth", "client": {"mode": "dcr"}}}},
            }
        },
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("plugin.json", json.dumps(manifest, indent=2))
        archive.writestr("mcp.json", json.dumps(mcp, indent=2))

        def add(folder: Traversable, prefix: str) -> None:
            for item in folder.iterdir():
                if item.is_dir():
                    add(item, prefix + item.name + "/")
                else:
                    archive.writestr(prefix + item.name, item.read_bytes())

        add(resources, "")
    return {"plugin": str(destination), "server": server, "credentials_in_package": False}


def update_channel_prompt() -> str:
    print("请选择更新渠道：", flush=True)
    print("  1. 正式版 (stable) — 仅正式发布版本", flush=True)
    print("  2. b测 (beta)      — 包含正式版与 Beta 版本", flush=True)
    print("  3. a测 (alpha)     — 包含正式版、Beta 与 Alpha 版本", flush=True)
    return input("输入序号或名称 [默认 1]: ")


async def run_update_cli(
    config: Path,
    *,
    channel: str | None = None,
    channel_flag: str | None = None,
    yes: bool = False,
    check_only: bool = False,
    repository: str | None = None,
    api_base: str | None = None,
) -> Json:
    from .github_update import (
        CHANNEL_LABELS,
        DEFAULT_REPOSITORY,
        GITHUB_API_URL,
        current_installed_version,
        fetch_latest_release,
        install_client_release,
        is_newer_version,
        load_device_settings,
        normalize_channel,
        parse_version,
    )

    if channel and channel_flag and normalize_channel(channel) != channel_flag:
        raise Error("update_channel", "不能同时指定相互冲突的更新渠道")
    if channel_flag:
        resolved_channel = channel_flag
    elif channel:
        resolved_channel = normalize_channel(channel)
    elif sys.stdin.isatty():
        resolved_channel = normalize_channel(update_channel_prompt())
    else:
        resolved_channel = "stable"

    repo = (repository or DEFAULT_REPOSITORY).strip()
    home_dir = config.parent
    current = current_installed_version(home_dir)
    settings = load_device_settings(home_dir)
    print(f"当前版本：{current}（渠道：{CHANNEL_LABELS[resolved_channel]} · 仓库：{repo}）", flush=True)
    release = await fetch_latest_release(
        settings,
        channel=resolved_channel,
        repository=repo,
        api_base=api_base or GITHUB_API_URL,
    )
    if release is None:
        print(f"所选渠道（{CHANNEL_LABELS[resolved_channel]}）暂无可用客户端发布版本。", flush=True)
        return {"updated": False, "reason": "no_release", "channel": resolved_channel, "current_version": current}

    latest = str(release["version"])
    if not is_newer_version(latest, current):
        if parse_version(latest) == parse_version(current):
            print(f"当前已是所选渠道最新版本（{current}）。", flush=True)
        else:
            print(f"当前版本（{current}）已高于所选渠道最新版本（{latest}），无需更新（不自动降级）。", flush=True)
        return {
            "updated": False,
            "reason": "up_to_date",
            "channel": resolved_channel,
            "current_version": current,
            "latest_version": latest,
        }

    print(f"发现新版本：{current} -> {latest}", flush=True)
    if release.get("published_at"):
        print(f"发布时间：{release['published_at']}", flush=True)
    notes = str(release.get("notes") or "").strip()
    if notes:
        summary = "\n".join(notes.splitlines()[:10])[:600]
        print(f"更新说明：\n{summary}", flush=True)
    if check_only:
        return {
            "updated": False,
            "check_only": True,
            "available": True,
            "channel": resolved_channel,
            "current_version": current,
            "latest_version": latest,
        }
    if not yes:
        if not sys.stdin.isatty():
            raise Error("update_confirmation_required", "非交互终端检测到新版本，请使用 -y / --yes 确认安装")
        answer = input(f"是否立即更新到 {latest}？[y/N]: ").strip().lower()
        if answer not in {"y", "yes", "是"}:
            print("已取消更新。", flush=True)
            return {"updated": False, "reason": "cancelled", "channel": resolved_channel, "current_version": current}

    result = await install_client_release(home_dir, release, progress=lambda text: print(text, flush=True))
    print(f"更新完成：{result['version']}（安装 ID: {result['id']}）", flush=True)
    return {"updated": True, **result}


def main(argv: list[str] | None = None) -> None:
    if os.name == "nt":
        os.environ["PYTHONUTF8"] = "1"
        for stream in (sys.stdout, sys.stderr):
            if stream is not None and hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8")
    effective_argv = list(sys.argv[1:] if argv is None else argv)
    if len(effective_argv) >= 2 and effective_argv[0] == "chat" and effective_argv[1] == "update":
        effective_argv = ["update", *effective_argv[2:]]
    parser = argparse.ArgumentParser(prog="computer-bridge")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in [
        "setup",
        "register",
        "serve",
        "install-runtime",
        "verify",
        "install-service",
        "start",
        "stop",
        "status",
        "module",
        "network",
        "chat",
        "update",
    ]:
        item = commands.add_parser(name)
        item.add_argument("--config", type=Path, default=home() / "device.json")
        if name == "setup":
            item.add_argument("--server", required=True)
            item.add_argument("--name", required=True)
        elif name == "register":
            item.add_argument("--no-browser", action="store_true")
        elif name == "chat":
            item.add_argument("--version", action="version", version=__version__)
            item.add_argument("--resume", metavar="t1", help="打开已有短 ID 对话")
            item.add_argument("--login", action="store_true", help="重新连接聊天账号")
            item.add_argument("--no-browser", action="store_true", help="仅显示账号连接链接")
        elif name == "network":
            item.add_argument("--mode", choices=["auto", "direct", "proxy"], required=True)
            item.add_argument("--proxy-url")
        elif name == "module":
            item.add_argument("action", choices=["enable", "disable"])
            item.add_argument("name")
            item.add_argument("--package")
        elif name == "update":
            item.add_argument("channel", nargs="?", help="更新渠道：stable（正式版）/ beta（b测）/ alpha（a测）")
            group = item.add_mutually_exclusive_group()
            group.add_argument(
                "--stable", action="store_const", const="stable", dest="channel_flag", help="仅检查或更新正式版"
            )
            group.add_argument(
                "--beta", action="store_const", const="beta", dest="channel_flag",
                help="检查或更新 b测（包含正式版与 beta）",
            )
            group.add_argument(
                "--alpha", action="store_const", const="alpha", dest="channel_flag",
                help="检查或更新 a测（包含正式版、beta 与 alpha）",
            )
            item.add_argument("-y", "--yes", action="store_true", help="发现新版本后直接安装，不再次确认")
            item.add_argument("--check", action="store_true", help="仅检查更新，不执行安装")
            item.add_argument("--repo", help="GitHub 仓库（owner/repo）")
            item.add_argument("--api-base", help=argparse.SUPPRESS)
    item = commands.add_parser("package")
    item.add_argument("--server", required=True)
    item.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args(effective_argv)
    try:
        if hasattr(args, "config"):
            args.config = args.config.expanduser().resolve()
        if args.command == "setup":
            result = setup(args.config, args.server, args.name)
        elif args.command == "register":
            result = asyncio.run(register(args.config, not args.no_browser))
        elif args.command == "chat":
            from .chat import run

            asyncio.run(run(args.config, args.resume, browser=not args.no_browser, login=args.login))
            return
        elif args.command == "update":
            asyncio.run(
                run_update_cli(
                    args.config,
                    channel=args.channel,
                    channel_flag=args.channel_flag,
                    yes=args.yes,
                    check_only=args.check,
                    repository=args.repo,
                    api_base=args.api_base,
                )
            )
            return
        elif args.command == "network":
            from .network import proxy_for

            data = json.loads(args.config.read_text(encoding="utf-8"))
            data["network"] = {"mode": args.mode, "proxy_url": args.proxy_url}
            proxy_for(data)
            save(args.config, data)
            result = {"mode": args.mode, "restart_device_component": True}
        elif args.command == "serve":
            import logging

            from .agent import serve

            logging.basicConfig(
                level=logging.INFO,
                filename=args.config.parent / "agent.err.log",
                encoding="utf-8",
                format="%(asctime)s %(levelname)s %(name)s %(message)s",
            )
            asyncio.run(serve(args.config))
            return
        elif args.command == "module":
            result = module(args.config, args.action == "enable", args.package, args.name)
        elif args.command == "install-runtime":
            from .native_install import install

            result = install(args.config)
        elif args.command == "verify":
            from .verification import verify

            result = asyncio.run(verify())
        elif args.command == "package":
            result = package(args.server, args.destination)
        else:
            result = service(args.config, "install" if args.command == "install-service" else args.command)
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    except (Error, OSError, ValueError, subprocess.CalledProcessError, httpx2.HTTPError) as exc:
        print(
            json.dumps(
                {"error": {"code": getattr(exc, "code", type(exc).__name__), "message": str(exc)}},
                ensure_ascii=False,
            ),
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(1) from exc


def chat_main() -> None:
    """Both short console commands use the existing terminal chat parser."""
    main(["chat", *sys.argv[1:]])
