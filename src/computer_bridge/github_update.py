"""Check GitHub Releases and perform isolated client self-updates."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import uuid
import venv
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx2
from packaging.version import InvalidVersion, Version
from websockets.proxy import get_proxy
from websockets.uri import parse_uri

from . import __version__
from .common import Error, Json, home, save

DEFAULT_REPOSITORY = os.environ.get("COMPUTER_BRIDGE_UPDATE_REPOSITORY", "").strip() or "aitingtingya-gpt-plugins/computer-bridge"
GITHUB_API_URL = "https://api.github.com"

CHANNELS: tuple[tuple[str, str, str], ...] = (
    ("stable", "正式版", "仅包含正式发布版本"),
    ("beta", "b测 (Beta)", "包含正式版与 Beta 预发布版本"),
    ("alpha", "a测 (Alpha)", "包含正式版、Beta 与 Alpha 预发布版本"),
)
CHANNEL_LABELS = {key: label for key, label, _ in CHANNELS}

_CHANNEL_ALIASES = {
    "stable": "stable",
    "release": "stable",
    "正式": "stable",
    "正式版": "stable",
    "1": "stable",
    "beta": "beta",
    "b": "beta",
    "b测": "beta",
    "2": "beta",
    "alpha": "alpha",
    "a": "alpha",
    "a测": "alpha",
    "3": "alpha",
}


class UpdateCancelledError(Error):
    def __init__(self, message: str = "已取消更新") -> None:
        super().__init__("update_cancelled", message)


def normalize_channel(value: str | None) -> str:
    text = (value or "").strip().lower()
    if not text:
        return "stable"
    resolved = _CHANNEL_ALIASES.get(text)
    if resolved is None:
        raise Error("update_channel", "更新渠道需为 stable（正式版）、beta（b测）或 alpha（a测）")
    return resolved


def parse_version(value: str) -> Version:
    text = value.strip()
    if text[:1] in {"v", "V"}:
        text = text[1:]
    return Version(text)


def channel_allows(version_text: str, channel: str) -> bool:
    resolved = normalize_channel(channel)
    try:
        parsed = parse_version(version_text)
    except InvalidVersion:
        return False
    if not parsed.is_prerelease:
        return True
    if resolved == "stable":
        return False
    pre_tag = parsed.pre[0] if parsed.pre else ""
    if resolved == "beta":
        return pre_tag in {"b", "rc"}
    return pre_tag in {"a", "b", "rc"}


def is_newer_version(candidate: str, current: str) -> bool:
    return parse_version(candidate) > parse_version(current)


def current_installed_version(home_dir: Path | None = None) -> str:
    base = (home_dir or home()).expanduser().resolve()
    active_file = base / "active.json"
    if active_file.is_file():
        try:
            active = json.loads(active_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            active = {}
        version = active.get("version")
        if isinstance(version, str) and version.strip():
            return version.strip()
    return __version__


def load_device_settings(home_dir: Path) -> Json:
    config = home_dir / "device.json"
    if not config.is_file():
        return {}
    try:
        data = json.loads(config.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _normalize_proxy_url(proxy: str | None) -> str | None:
    if not proxy:
        return None
    if proxy.startswith("socks5h://"):
        return "socks5://" + proxy[len("socks5h://") :]
    return proxy


def _detected_system_proxy(target_url: str) -> str | None:
    detected: str | None = None
    with contextlib.suppress(OSError, ValueError, ImportError, RuntimeError):
        raw_proxy = get_proxy(parse_uri(target_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)))
        detected = str(raw_proxy) if raw_proxy else None
    if not detected:
        for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
            value = os.environ.get(name, "").strip()
            if value:
                detected = value
                break
    proxy = _normalize_proxy_url(detected)
    if proxy and urlsplit(proxy).scheme in {"http", "https", "socks5"}:
        return proxy
    return None


def github_proxy_candidates(settings: Json, target_url: str) -> list[str | None]:
    raw_network = settings.get("network")
    network: Json = raw_network if isinstance(raw_network, dict) else {}
    mode = network.get("mode", "auto")
    if mode == "proxy":
        raw = str(network.get("proxy_url") or "")
        if urlsplit(raw).scheme not in {"http", "https", "socks5", "socks5h"}:
            raise Error("proxy_config", "请设置 HTTP、HTTPS 或 SOCKS5 代理地址")
        return [_normalize_proxy_url(raw)]
    detected = _detected_system_proxy(target_url)
    return [detected, None] if detected else [None]


def _github_headers(*, accept: str, token: str | None) -> dict[str, str]:
    headers = {
        "Accept": accept,
        "User-Agent": "Computer-Bridge-Updater",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    return headers


def _check_cancelled(cancelled: Callable[[], None] | None) -> None:
    if cancelled:
        cancelled()


def _error_detail(exc: Exception | None) -> str:
    if exc is None:
        return "未知网络错误"
    return str(exc) or type(exc).__name__


async def _github_get_bytes(
    settings: Json,
    url: str,
    *,
    accept: str,
    token: str | None,
    timeout: float = 30.0,
) -> bytes:
    headers = _github_headers(accept=accept, token=token)
    last_error: Exception | None = None
    for proxy in github_proxy_candidates(settings, url):
        try:
            async with httpx2.AsyncClient(trust_env=False, proxy=proxy, timeout=timeout) as client:
                response = await client.get(url, headers=headers, follow_redirects=True)
            if response.status_code >= 400:
                raise Error("github_http", f"GitHub 请求失败：HTTP {response.status_code}")
            return response.content
        except (httpx2.TransportError, httpx2.TimeoutException, OSError) as exc:
            last_error = exc
    raise Error("github_network", f"无法连接 GitHub Releases：{_error_detail(last_error)}")


async def download_github_artifact(
    settings: Json,
    artifact: Json,
    target: Path,
    *,
    cancelled: Callable[[], None] | None = None,
    token: str | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> None:
    url = str(artifact.get("download_url") or "")
    if not url:
        raise Error("update_manifest", "发布清单缺少安装包下载地址")
    expected_sha = str(artifact.get("sha256") or "").lower()
    expected_size = int(artifact.get("size") or 0)
    resolved_token = os.environ.get("GITHUB_RELEASE_TOKEN", "").strip() if token is None else token
    headers = _github_headers(accept="application/octet-stream", token=resolved_token or None)
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for proxy in github_proxy_candidates(settings, url):
        digest = hashlib.sha256()
        total = 0
        try:
            async with (
                httpx2.AsyncClient(trust_env=False, proxy=proxy, timeout=60.0) as client,
                client.stream("GET", url, headers=headers, follow_redirects=True) as response,
            ):
                if response.status_code >= 400:
                    raise Error("github_http", f"GitHub 下载失败：HTTP {response.status_code}")
                with target.open("wb") as output:
                    async for chunk in response.aiter_bytes():
                        _check_cancelled(cancelled)
                        total += len(chunk)
                        digest.update(chunk)
                        output.write(chunk)
                        if progress:
                            progress(total, expected_size)
        except (httpx2.TransportError, httpx2.TimeoutException, OSError) as exc:
            target.unlink(missing_ok=True)
            last_error = exc
            continue
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        if digest.hexdigest() != expected_sha or total != expected_size:
            target.unlink(missing_ok=True)
            raise Error("update_checksum", "安装包大小或 SHA256 校验失败，已取消安装")
        return
    raise Error("github_network", f"下载安装包失败：{_error_detail(last_error)}")


async def fetch_latest_release(
    settings: Json,
    *,
    channel: str,
    repository: str = DEFAULT_REPOSITORY,
    api_base: str = GITHUB_API_URL,
    token: str | None = None,
) -> Json | None:
    if not repository:
        raise Error("update_repository", "请先通过 --repo 或 COMPUTER_BRIDGE_UPDATE_REPOSITORY 指定 GitHub 更新仓库（owner/repo）")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise Error("update_repository", "请填写有效的 GitHub 仓库（owner/repo）")
    resolved_channel = normalize_channel(channel)
    resolved_token = os.environ.get("GITHUB_RELEASE_TOKEN", "").strip() if token is None else token
    base = api_base.rstrip("/")
    candidates: list[tuple[Version, str, Json]] = []
    page = 1
    while True:
        payload = await _github_get_bytes(
            settings,
            f"{base}/repos/{repository}/releases?per_page=100&page={page}",
            accept="application/vnd.github+json",
            token=resolved_token or None,
        )
        rows = json.loads(payload.decode("utf-8"))
        if not isinstance(rows, list):
            raise Error("github_http", "GitHub 返回的发布列表格式无效")
        for row in rows:
            if not isinstance(row, dict) or row.get("draft"):
                continue
            if resolved_channel == "stable" and row.get("prerelease"):
                continue
            tag_name = str(row.get("tag_name") or "")
            tag_version = tag_name.removeprefix("v").removeprefix("V")
            if not channel_allows(tag_version, resolved_channel):
                continue
            candidates.append((parse_version(tag_version), tag_version, row))
        if len(rows) < 100:
            break
        page += 1
    candidates.sort(key=lambda item: item[0], reverse=True)
    for _, tag_version, release in candidates:
        assets = release.get("assets") or []
        manifest_asset = next(
            (item for item in assets if isinstance(item, dict) and item.get("name") == "release-manifest.json"),
            None,
        )
        if not manifest_asset:
            continue
        manifest_url = str(manifest_asset.get("url") or manifest_asset.get("browser_download_url") or "")
        if not manifest_url:
            continue
        manifest_raw = await _github_get_bytes(
            settings,
            manifest_url,
            accept="application/octet-stream",
            token=resolved_token or None,
        )
        try:
            manifest = json.loads(manifest_raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise Error("update_manifest", "发布清单解析失败") from exc
        if manifest.get("format") != 1 or not isinstance(manifest.get("artifacts"), list):
            raise Error("update_manifest", "发布清单格式不正确")
        manifest_version = str(manifest.get("version") or "").removeprefix("v").removeprefix("V")
        if manifest_version != tag_version:
            raise Error("update_manifest", "发布标签与清单版本不一致")
        artifacts: list[Json] = [a for a in manifest["artifacts"] if isinstance(a, dict)]
        client_artifact = next(
            (a for a in artifacts if a.get("target") == "client" and a.get("id") == "client"),
            None,
        ) or next((a for a in artifacts if a.get("target") == "client"), None)
        if not client_artifact:
            continue
        sha256_text = str(client_artifact.get("sha256") or "").lower()
        size_value = client_artifact.get("size")
        if not re.fullmatch(r"[a-f0-9]{64}", sha256_text) or not isinstance(size_value, int) or size_value <= 0:
            raise Error("update_manifest", "客户端发布资源校验信息不完整")
        remote_asset = next(
            (item for item in assets if isinstance(item, dict) and item.get("name") == client_artifact.get("file")),
            None,
        )
        if not remote_asset or (
            remote_asset.get("size") is not None and int(remote_asset["size"]) != size_value
        ):
            raise Error("update_manifest", f"发布资源缺失或大小不符：{client_artifact.get('file')}")
        download_url = str(remote_asset.get("url") or remote_asset.get("browser_download_url") or "")
        if not download_url:
            raise Error("update_manifest", f"发布资源缺少下载地址：{client_artifact.get('file')}")
        return {
            "repository": repository,
            "channel": resolved_channel,
            "id": release.get("id"),
            "tag_name": str(release.get("tag_name") or ""),
            "version": str(manifest["version"]),
            "prerelease": bool(release.get("prerelease", False)),
            "published_at": str(release.get("published_at") or ""),
            "url": str(release.get("html_url") or ""),
            "notes": str(release.get("body") or ""),
            "artifact": {
                **client_artifact,
                "sha256": sha256_text,
                "download_url": download_url,
                "browser_download_url": str(remote_asset.get("browser_download_url") or ""),
            },
            "manifest": manifest,
        }
    return None


def _extract_client_zip(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            if not (destination / member.filename).resolve().is_relative_to(root):
                raise Error("update_archive", "安装包包含无效路径")
        archive.extractall(destination)
    if not (destination / "pyproject.toml").is_file() or not (destination / "constraints.txt").is_file():
        raise Error("update_archive", "客户端安装包缺少必要构建文件")


async def _run_subprocess(
    command: list[str],
    *,
    env: dict[str, str],
    cancelled: Callable[[], None] | None = None,
    capture_output: bool = True,
) -> tuple[int, str, str]:
    options: dict[str, Any] = {"creationflags": 0x08000000} if os.name == "nt" else {}
    process = await asyncio.create_subprocess_exec(
        *command,
        env=env,
        stdout=asyncio.subprocess.PIPE if capture_output else asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE if capture_output else asyncio.subprocess.DEVNULL,
        **options,
    )
    communicate_task = asyncio.create_task(process.communicate())
    try:
        while not communicate_task.done():
            if cancelled is not None:
                try:
                    cancelled()
                except BaseException:
                    process.terminate()
                    try:
                        await asyncio.wait_for(communicate_task, timeout=5)
                    except TimeoutError:
                        process.kill()
                        await communicate_task
                    raise
            done, _ = await asyncio.wait({communicate_task}, timeout=0.2)
            if communicate_task in done:
                break
        stdout_bytes, stderr_bytes = await communicate_task
    except BaseException:
        if not communicate_task.done():
            process.terminate()
            await asyncio.gather(communicate_task, return_exceptions=True)
        raise
    return (
        int(process.returncode or 0),
        (stdout_bytes or b"").decode("utf-8", errors="replace"),
        (stderr_bytes or b"").decode("utf-8", errors="replace"),
    )


async def _run_checked(
    command: list[str],
    *,
    env: dict[str, str],
    cancelled: Callable[[], None] | None = None,
    error_message: str,
) -> str:
    code, stdout, stderr = await _run_subprocess(command, env=env, cancelled=cancelled)
    if code != 0:
        detail = (stderr or stdout).strip()
        raise Error("update_install", f"{error_message}（退出码 {code}）" + (f"：{detail}" if detail else ""))
    return stdout


def _status_revision(destination: Path) -> int:
    try:
        return (destination / "agent-status.json").stat().st_mtime_ns
    except FileNotFoundError:
        return 0


async def _wait_connected(
    destination: Path,
    active: Json,
    previous_revision: int,
    *,
    seconds: float = 90.0,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while loop.time() < deadline:
        try:
            status_path = destination / "agent-status.json"
            actual = json.loads(status_path.read_text(encoding="utf-8"))
            setting = json.loads((destination / "device.json").read_text(encoding="utf-8"))
            if (
                status_path.stat().st_mtime_ns != previous_revision
                and actual.get("install_id") == active["id"]
                and actual.get("version") == active["version"]
                and actual.get("connected")
                and (
                    not setting.get("lock_mode", {}).get("enabled", True)
                    or actual.get("lock_mode", {}).get("applied")
                )
            ):
                return
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass
        await asyncio.sleep(0.1)
    raise Error("update_health", "组件未在期限内恢复服务器连接并接管电源请求，安装 ID: " + str(active["id"]))


async def _wait_idle(
    home_dir: Path,
    *,
    cancelled: Callable[[], None] | None = None,
    report: Callable[[str], None] | None = None,
) -> None:
    while True:
        _check_cancelled(cancelled)
        pending = [
            p
            for p in (home_dir / "operations").glob("*/metadata.json")
            if not (p.parent / "result.json").exists()
        ]
        database = home_dir / "requests/requests.sqlite3"
        requests_running = 0
        if database.is_file():
            with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as connection:
                requests_running = int(
                    connection.execute("SELECT count(*) FROM requests WHERE state='running'").fetchone()[0]
                )
        if not pending and not requests_running:
            return
        if report:
            report("等待当前电脑操作完成后切换…")
        await asyncio.sleep(0.5)


async def _register_shell_commands(
    python_bin: Path,
    home_dir: Path,
    *,
    env: dict[str, str],
    user_home: Path | None,
    zdotdir: Path | None,
) -> None:
    if user_home is None and zdotdir is None:
        await _run_checked(
            [str(python_bin), "-m", "computer_bridge.command_entry", "install", "--home", str(home_dir)],
            env=env,
            error_message="刷新终端快捷命令失败",
        )
        return
    script = (
        "import sys; from pathlib import Path; "
        "from computer_bridge.command_entry import register_commands; "
        "register_commands(Path(sys.argv[1]), "
        "user_home=Path(sys.argv[2]) if sys.argv[2] else None, "
        "zdotdir=Path(sys.argv[3]) if sys.argv[3] else None)"
    )
    await _run_checked(
        [
            str(python_bin),
            "-c",
            script,
            str(home_dir),
            str(user_home or ""),
            str(zdotdir or ""),
        ],
        env=env,
        error_message="刷新终端快捷命令失败",
    )


async def install_client_release(
    home_dir: Path,
    release_info: Json,
    *,
    progress: Callable[[str], None] | None = None,
    cancelled: Callable[[], None] | None = None,
    on_switching: Callable[[], None] | None = None,
    verify_connection: bool = True,
    command_user_home: Path | None = None,
    command_zdotdir: Path | None = None,
    connection_timeout: float = 90.0,
    token: str | None = None,
) -> Json:
    def report(text: str) -> None:
        if progress:
            progress(text)

    destination = home_dir.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    config_path = destination / "device.json"
    has_config = config_path.is_file()
    old_config = load_device_settings(destination) if has_config else {}
    active_path = destination / "active.json"
    old_active: Json = {}
    if active_path.is_file():
        try:
            old_active = json.loads(active_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            old_active = {}
    old_python = str(old_active.get("python") or sys.executable)
    launcher_path = destination / "launcher.py"
    previous_launcher = launcher_path.read_bytes() if launcher_path.is_file() else None
    launcher_python_path = destination / "launcher-python.txt"
    previous_launcher_python = launcher_python_path.read_bytes() if launcher_python_path.is_file() else None

    identity = "update-" + uuid.uuid4().hex[:12]
    release_dir = destination / "releases" / identity
    source_dir = release_dir / "source"
    env_dir = release_dir / "env"
    python_bin = env_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    env = {**os.environ, "COMPUTER_BRIDGE_HOME": str(destination), "PYTHONUTF8": "1"}
    artifact = release_info["artifact"]
    target_version = str(release_info["version"])
    switched = False
    stopped = False
    launcher_replaced = False
    handoff: subprocess.Popen[str] | None = None
    signal_file = release_dir / "power-handoff.release"
    migration: Any = None

    try:
        _check_cancelled(cancelled)
        archive_path = release_dir / "client.zip"
        total_size = int(artifact.get("size") or 0)

        def download_progress(received: int, expected: int) -> None:
            if expected > 0:
                percent = min(100, int(received * 100 / expected))
                report(f"正在下载 v{target_version}（{percent}% · {received}/{expected} 字节）…")
            else:
                report(f"正在下载 v{target_version}（{received} 字节）…")

        report(f"正在下载 v{target_version}（0/{total_size} 字节）…")
        await download_github_artifact(
            old_config,
            artifact,
            archive_path,
            cancelled=cancelled,
            token=token,
            progress=download_progress,
        )

        _check_cancelled(cancelled)
        report("正在校验并解压客户端源码…")
        await asyncio.to_thread(_extract_client_zip, archive_path, source_dir)

        _check_cancelled(cancelled)
        report("正在创建独立 Python 虚拟环境…")
        await asyncio.to_thread(venv.EnvBuilder(with_pip=True).create, env_dir)

        report("正在安装依赖与客户端包…")
        await _run_checked(
            [str(python_bin), "-m", "pip", "install", "-c", str(source_dir / "constraints.txt"), str(source_dir)],
            env=env,
            cancelled=cancelled,
            error_message="安装新版本客户端依赖失败",
        )

        modules: Json = {}
        if has_config:
            report("正在迁移模块与运行时…")
            await _run_checked(
                [
                    str(python_bin),
                    "-m",
                    "computer_bridge.bootstrap",
                    "--source",
                    str(source_dir),
                    "--release",
                    str(release_dir),
                    "--old-python",
                    old_python,
                ],
                env=env,
                cancelled=cancelled,
                error_message="迁移已启用模块失败",
            )
            await _run_checked(
                [str(python_bin), "-m", "computer_bridge", "install-runtime", "--config", str(config_path)],
                env=env,
                cancelled=cancelled,
                error_message="安装本机 Node 运行时失败",
            )
            report("正在执行沙盒与文件读写自检…")
            await _run_checked(
                [str(python_bin), "-m", "computer_bridge", "verify", "--config", str(config_path)],
                env=env,
                cancelled=cancelled,
                error_message="新版本沙盒自检未通过",
            )
            modules_file = release_dir / "modules.json"
            if modules_file.is_file():
                modules = json.loads(modules_file.read_text(encoding="utf-8"))

        actual_version = (
            await _run_checked(
                [str(python_bin), "-m", "computer_bridge", "--version"],
                env=env,
                cancelled=cancelled,
                error_message="校验新版本失败",
            )
        ).strip()
        if parse_version(actual_version) != parse_version(target_version):
            raise Error("update_version", f"安装后的实际版本（{actual_version}）与目标版本（{target_version}）不符")

        old_running = False
        if has_config:
            await _wait_idle(destination, cancelled=cancelled, report=report)
            if Path(old_python).is_file():
                code, stdout, _ = await _run_subprocess(
                    [old_python, "-m", "computer_bridge", "status", "--config", str(config_path)],
                    env=env,
                    cancelled=cancelled,
                )
                if code == 0:
                    try:
                        status = json.loads(stdout)
                        old_running = bool(status.get("installed")) and (
                            os.name == "nt" or bool(status.get("running"))
                        )
                    except json.JSONDecodeError:
                        old_running = False

        _check_cancelled(cancelled)
        if on_switching:
            on_switching()
        report("正在接管防睡眠锁并切换后台服务…")

        if has_config:
            handoff = await asyncio.to_thread(
                lambda: subprocess.Popen(
                    [
                        str(python_bin),
                        "-m",
                        "computer_bridge.power_handoff",
                        "--config",
                        str(config_path),
                        "--release",
                        str(signal_file),
                        "--parent",
                        str(os.getpid()),
                    ],
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    creationflags=0x08000000 if os.name == "nt" else 0,
                )
            )
            handoff_stdout = handoff.stdout
            ready = await asyncio.to_thread(handoff_stdout.readline) if handoff_stdout else ""
            if not ready or not json.loads(ready).get("ready"):
                raise Error("update_handoff", "更新交接未能取得防睡眠请求，原程序保持运行")

        if os.name == "nt" and has_config and Path(old_python).is_file():
            sys.path.insert(0, str(source_dir / "src"))
            from .legacy_windows import LegacyWindowsMigration

            migration = LegacyWindowsMigration(destination, old_python, old_config.get("launcher_python"))
            migration.capture()
            stopped = old_running or bool(migration.handles)
        if old_running:
            await _run_checked(
                [old_python, "-m", "computer_bridge", "stop", "--config", str(config_path)],
                env=env,
                error_message="停止旧版本后台服务失败",
            )
            stopped = True
        if migration:
            migration.stop_and_wait()
            migration.close()
            migration = None

        shutil.copyfile(source_dir / "src/computer_bridge/launcher.py", launcher_path)
        launcher_replaced = True
        existing_launcher_python = str(old_config.get("launcher_python") or "")
        base_python = (
            existing_launcher_python
            if existing_launcher_python and Path(existing_launcher_python).is_file()
            else str(getattr(sys, "_base_executable", sys.executable))
        )
        launcher_python_path.write_text(base_python, encoding="utf-8")
        if has_config:
            updated_config = json.loads(config_path.read_text(encoding="utf-8"))
            updated_config["launcher_python"] = base_python
            save(config_path, updated_config)

        active: Json = {
            "id": identity,
            "python": str(python_bin),
            "source": str(source_dir),
            "version": actual_version,
            "modules": modules,
        }
        temporary = destination / "active.json.tmp"
        temporary.write_text(json.dumps(active), encoding="utf-8")
        os.replace(temporary, active_path)
        switched = True

        if old_running:
            previous_revision = _status_revision(destination)
            report("正在启动新版后台服务并验证连接…")
            await _run_checked(
                [str(python_bin), "-m", "computer_bridge", "install-service", "--config", str(config_path)],
                env=env,
                error_message="启动新版后台服务失败",
            )
            await _run_checked(
                [str(python_bin), "-m", "computer_bridge", "status", "--config", str(config_path)],
                env=env,
                error_message="查询新版服务状态失败",
            )
            if verify_connection:
                await _wait_connected(destination, active, previous_revision, seconds=connection_timeout)

        report("正在刷新 cs / closesi 终端命令…")
        await _register_shell_commands(
            python_bin,
            destination,
            env=env,
            user_home=command_user_home,
            zdotdir=command_zdotdir,
        )
        report(f"更新完成：{actual_version}（安装 ID: {identity}）")
        return {
            "id": identity,
            "version": actual_version,
            "python": str(python_bin),
            "source": str(source_dir),
            "home": str(destination),
            "service_restarted": old_running,
        }
    except BaseException:
        if migration:
            migration.close()
            migration = None
        if switched:
            if has_config:
                code, stdout, _ = await _run_subprocess(
                    [str(python_bin), "-m", "computer_bridge", "status", "--config", str(config_path)],
                    env=env,
                )
                if code == 0:
                    try:
                        running = os.name == "nt" or bool(json.loads(stdout).get("running"))
                    except json.JSONDecodeError:
                        running = False
                    if running:
                        await _run_subprocess(
                            [str(python_bin), "-m", "computer_bridge", "stop", "--config", str(config_path)],
                            env=env,
                        )
            if old_active:
                active_path.write_text(json.dumps(old_active), encoding="utf-8")
            else:
                active_path.unlink(missing_ok=True)
        if launcher_replaced:
            if previous_launcher is None:
                launcher_path.unlink(missing_ok=True)
            else:
                launcher_path.write_bytes(previous_launcher)
            if previous_launcher_python is None:
                launcher_python_path.unlink(missing_ok=True)
            else:
                launcher_python_path.write_bytes(previous_launcher_python)
            if has_config:
                restored_config = json.loads(config_path.read_text(encoding="utf-8"))
                if "launcher_python" in old_config:
                    restored_config["launcher_python"] = old_config["launcher_python"]
                else:
                    restored_config.pop("launcher_python", None)
                save(config_path, restored_config)
        if stopped and has_config and Path(old_python).is_file():
            previous_revision = _status_revision(destination)
            await _run_subprocess(
                [old_python, "-m", "computer_bridge", "install-service", "--config", str(config_path)],
                env=env,
            )
            if old_active and verify_connection:
                with contextlib.suppress(Error, OSError, TimeoutError):
                    await _wait_connected(destination, old_active, previous_revision, seconds=connection_timeout)
        if not switched:
            shutil.rmtree(release_dir, ignore_errors=True)
        raise
    finally:
        if handoff is not None:
            signal_file.touch()
            try:
                await asyncio.to_thread(handoff.wait, 10)
            except subprocess.TimeoutExpired:
                handoff.terminate()
                await asyncio.to_thread(handoff.wait)
