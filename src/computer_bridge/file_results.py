"""Read original bytes by explicit range and describe completed file mutations."""

from __future__ import annotations

import base64
import codecs
import hashlib
import mimetypes
from datetime import UTC, datetime
from pathlib import Path

from .common import Error, Json
from .native_files import file_call


def read_original(
    path: Path,
    *,
    offset: int = 0,
    length: int | None = None,
    binary: bool = False,
    version: str | None = None,
    node_path: str | None = None,
) -> Json:
    media = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if offset < 0 or length is not None and length < 1:
        raise Error("read_range", "offset 必须非负，length 必须为正数")
    request: Json = {"offset": offset}
    if length is not None:
        request["length"] = length
    if version is not None:
        request["version"] = version
    window = file_call("read", path, request, node_path)
    size, current, end = window["size"], window["version"], window["next_offset"]
    info: Json = {"size": size, "version": current, "next_offset": offset, "eof": offset >= size}
    if binary:
        return {"media_type": media, "version": current, "base64": window["base64"],
                "size": size, "next_offset": end, "eof": end >= size}
    sample = base64.b64decode(window["sample"])
    if (b"\0" in sample or media.startswith(("image/", "audio/", "video/"))
            or media in {"application/zip", "application/pdf", "application/gzip", "application/x-7z-compressed"}):
        return {**info, "media_type": media, "binary": True}
    # The public Bridge byte-window transport predates DSH's line-window tool.
    # Reads and versions come from DSH; this only aligns a UTF-8 wire boundary.
    decoder = codecs.getincrementaldecoder("utf-8")()
    try:
        text = decoder.decode(base64.b64decode(window["base64"]), final=end >= size)
        pending = decoder.getstate()[0]
        if pending and text:
            end -= len(pending)
        elif pending:
            while decoder.getstate()[0]:
                extra = file_call("read", path, {"offset": end, "length": 1, "version": current}, node_path)
                data = base64.b64decode(extra["base64"])
                end = extra["next_offset"]
                text += decoder.decode(data, final=end >= size)
    except UnicodeDecodeError:
        return {**info, "media_type": media, "binary": True}
    return {"text": text, "version": current, "size": size, "next_offset": end, "eof": end >= size}


def mutation_info(path: Path, *, sha256: bool = False) -> Json:
    stat = path.stat()
    result: Json = {"size": stat.st_size, "mtime": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat()}
    if sha256:
        with path.open("rb") as source:
            result["sha256"] = hashlib.file_digest(source, "sha256").hexdigest()
    return result
