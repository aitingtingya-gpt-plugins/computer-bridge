"""Anonymous web retrieval and bounded download chunks."""

from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from .common import Error, Json, uid
from .native_files import media_call_async


async def fetch(url: str, directory: Path, node_path: str | None = None) -> Json:
    directory.mkdir(parents=True, exist_ok=True)
    raw = directory / (uid("web") + ".html")
    return await media_call_async({
        "operation": "web", "url": url, "raw_path": str(raw), "content_path": str(raw.with_suffix(".md")),
    }, node_path)


def export_info(root: Path, path: str) -> Json:
    target = Path(path).expanduser()
    target = (target if target.is_absolute() else root / target).resolve(strict=True)
    if not target.is_file():
        raise Error("not_file", "只能交付实际文件")
    return {
        "path": str(target),
        "name": target.name,
        "size": target.stat().st_size,
        "media_type": mimetypes.guess_type(target.name)[0] or "application/octet-stream",
    }


def export_chunk(root: Path, path: str, offset: int) -> Json:
    info = export_info(root, path)
    with Path(info["path"]).open("rb") as source:
        source.seek(offset)
        chunk = source.read(256 * 1024)
    return {"data": base64.b64encode(chunk).decode(), "next": offset + len(chunk), "end": not chunk}
