"""Pin an explicitly supplied module dependency as a local installation artifact."""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import tempfile
from pathlib import Path

from packaging.utils import canonicalize_name, parse_wheel_filename

from .common import Error, Json


async def pin(python: Path, directory: Path, name: str, source: str) -> str:
    root = directory / "module-dependencies"
    path = Path(source).expanduser()
    if path.is_file() and path.resolve().is_relative_to(root.resolve()):
        return str(path)
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="prepare-", dir=root))
    try:
        options: Json = {"creationflags": 0x08000000} if os.name == "nt" else {}
        process = await asyncio.create_subprocess_exec(
            str(python), "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(stage), source, **options
        )
        if await process.wait():
            raise Error("module_dependency", "无法准备指定的模块依赖：" + name)
        wheel = next(
            p for p in stage.glob("*.whl") if parse_wheel_filename(p.name)[0] == canonicalize_name(name)
        )
        with wheel.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        target = root / canonicalize_name(name) / digest / wheel.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(wheel, target)
        return str(target)
    finally:
        shutil.rmtree(stage)
