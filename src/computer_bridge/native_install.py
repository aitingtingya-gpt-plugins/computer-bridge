"""Install official Node LTS when needed, then the pinned native tool dependencies."""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path

import httpx2

from .common import Error, Json, save


def install(config: Path) -> Json:
    node = os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    if (
        node
        and int(subprocess.check_output([node, "--version"], text=True).strip().lstrip("v").split(".")[0])
        < 24
    ):
        node = None
    if not node:
        system = "win" if os.name == "nt" else "darwin"
        architecture = "arm64" if platform.machine().lower() in {"arm64", "aarch64"} else "x64"
        extension = "zip" if os.name == "nt" else "tar.gz"
        base = "https://nodejs.org/dist/latest-v24.x/"
        directory = config.parent / "node-runtime"
        directory.mkdir(parents=True, exist_ok=True)
        with httpx2.Client(trust_env=False, timeout=120, follow_redirects=True) as http:
            checksum = http.get(base + "SHASUMS256.txt")
            checksum.raise_for_status()
            matched = re.search(
                rf"^([a-f0-9]+)\s+(node-v[^\s]+-{system}-{architecture}\.{extension})$", checksum.text, re.M
            )
            if matched is None:
                raise Error("node_release", "官方 Node.js 发布清单缺少当前平台")
            expected, name = matched.groups()
            archive = directory / name
            digest = hashlib.sha256()
            with http.stream("GET", base + name) as response:
                response.raise_for_status()
                with archive.open("wb") as output:
                    for chunk in response.iter_bytes():
                        digest.update(chunk)
                        output.write(chunk)
            if digest.hexdigest() != expected:
                raise Error("node_checksum", "Node.js 下载校验失败")
        if extension == "zip":
            with zipfile.ZipFile(archive) as source:
                source.extractall(directory)
        else:
            with tarfile.open(archive) as source:
                source.extractall(directory, filter="data")
        archive.unlink()
        folder = directory / name.removesuffix(".zip").removesuffix(".tar.gz")
        node = str(folder / ("node.exe" if os.name == "nt" else "bin/node"))
    # Resolve runtime managers (including Volta) through Node itself; their shim
    # directory need not contain npm or the actual executable's dependencies.
    executable = Path(subprocess.check_output(
        [node, "-p", "process.execPath"], text=True, encoding="utf-8"
    ).strip()).resolve()
    candidates = [
        executable.parent / "node_modules/npm/bin/npm-cli.js",
        executable.parent.parent / "lib/node_modules/npm/bin/npm-cli.js",
    ]
    npm = shutil.which("npm")
    if npm and os.name != "nt":
        candidates.append(Path(npm).resolve())
    entry = next((p for p in candidates if p.is_file()), None)
    if entry is None:
        raise Error("npm_missing", "请安装包含 npm 的 Node.js 24+ 发行版")
    runtime = Path(__file__).parent / "native"
    subprocess.run(
        [str(executable), str(entry), "ci", "--omit=dev", "--no-audit", "--no-fund"],
        cwd=runtime,
        env={**os.environ, "PATH": str(executable.parent) + os.pathsep + os.environ.get("PATH", "")},
        check=True,
    )
    import json

    settings = json.loads(config.read_text(encoding="utf-8"))
    settings["native_node"] = str(executable)
    save(config, settings)
    return {"installed": True, "node": str(executable), "sandbox_source": "DeepSeek Harness"}
