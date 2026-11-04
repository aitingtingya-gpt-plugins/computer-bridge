"""Administrator-owned directory grants; reads and network follow DSH semantics."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import cast

from .common import Error, Json, save
from .workspace_paths import inspect_access, usable_roots


def canonical(value: str) -> Path:
    return Path(value).expanduser().resolve(strict=True)


def validate_access(value: Json) -> Json:
    return inspect_access(value)


class Access:
    def __init__(self, value: Json):
        self.value = value

    def workspace(self, identity: str) -> Json:
        for entry in self.value.get("workspaces", []):
            if entry["id"] == identity:
                return cast(Json, entry)
        raise Error("workspace_missing", "请从 computer.workspaces 返回的工作区中选择")

    def roots(self, session: Json) -> list[Path] | None:
        if self.value["full_access"]:
            entry = next((w for w in self.value["workspaces"] if w["id"] == session.get("workspace")), None)
            if entry is not None:
                usable_roots(entry)
            return None
        entry = self.workspace(session.get("workspace", ""))
        return usable_roots(entry)

    def open(self, path: str | None, workspace: str | None) -> Json:
        if workspace:
            entry = self.workspace(workspace)
            usable_roots(entry)
            selected = Path(path).expanduser() if path else Path(entry["path"])
            root = canonical(str(selected if selected.is_absolute() else Path(entry["path"]) / selected))
        elif self.value["full_access"]:
            root = canonical(path or str(Path.home()))
        else:
            raise Error("workspace_required", "完全访问已关闭，请先选择已配置的工作区 ID")
        session = {"path": str(root), "workspace": workspace}
        roots = self.roots(session)
        if roots is not None and not any(root.is_relative_to(p) for p in roots):
            raise Error("workspace_directory", "打开目录不属于所选工作区")
        if not root.is_dir():
            raise Error("not_directory", str(root))
        return session


def check_write(path: Path, roots: list[Path] | None) -> None:
    if roots is None:
        return
    # Same application-level fence as DSH fs-sandbox; actual shell code is kernel-confined.
    target = path.resolve()
    allowed = [*roots, Path(tempfile.gettempdir()).resolve(), Path("/tmp").resolve()]
    if not any(target.is_relative_to(root) for root in allowed):
        raise Error("FS_SANDBOX_DENIED", f"沙盒不允许写入：{target}")


def command_argv(
    argv: list[str],
    roots: list[Path] | None,
    directory: Path,
    node_path: str | None = None,
    grant_base: Path | None = None,
) -> list[str]:
    if roots is None:
        return argv
    runtime = Path(__file__).parent / "native/runner.mjs"
    node = node_path or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    if not node or not runtime.is_file():
        raise Error("SANDBOX_UNAVAILABLE", "请运行新版安装程序，安装 Node.js 24+ 和沙盒运行组件")
    policy = directory / "sandbox.json"
    values = sorted({str(root) for root in roots})
    key = hashlib.sha256(json.dumps(values).encode()).hexdigest()
    grant = (grant_base or directory.parent / "sandbox-grants") / key
    grant.mkdir(parents=True, exist_ok=True)
    info = {"roots": values, "grant_key": str(grant.resolve())}
    save(grant / "policy.json", info)
    save(policy, info)
    return [node, str(runtime), str(policy), *argv]


async def cleanup_sandbox(directory: Path, node_path: str | None) -> None:
    state = directory / "sandbox.json.grants"
    if not state.exists():
        return
    node = node_path or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    process = await asyncio.create_subprocess_exec(
        str(node),
        str(Path(__file__).parent / "native/runner.mjs"),
        "cleanup",
        str(state),
        stderr=asyncio.subprocess.PIPE,
    )
    _, error = await process.communicate()
    if process.returncode:
        raise Error("sandbox_cleanup", error.decode(errors="replace"))


async def reclaim_grants(
    base: Path, keep: set[frozenset[str]], active: set[str], node_path: str | None
) -> None:
    node = node_path or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    for path in base.glob("*/policy.json"):
        value = json.loads(path.read_text(encoding="utf-8"))
        if frozenset(value["roots"]) in keep or value["grant_key"] in active:
            continue
        process = await asyncio.create_subprocess_exec(
            str(node),
            str(Path(__file__).parent / "native/runner.mjs"),
            "revoke",
            str(path),
            stderr=asyncio.subprocess.PIPE,
        )
        _, error = await process.communicate()
        if process.returncode:
            raise Error("sandbox_revoke", error.decode(errors="replace"))
