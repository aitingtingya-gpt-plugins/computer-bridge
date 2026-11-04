"""Original user/project instructions. Reading never initializes .work."""

import hashlib
from pathlib import Path

from .common import Json


def instructions(root: Path | None, stamps: Json | None = None) -> tuple[list[Json], Json]:
    sources = [("user", Path.home() / ".work/AGENTS.md")]
    if root is not None:
        sources.append(("project", root / "AGENTS.md"))
    result: list[Json] = []
    current: Json = {}
    for scope, path in sources:
        key = str(path)
        if path.is_file():
            stat = path.stat()
            identity = [stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_ino]
            previous = (stamps or {}).get(key) or {}
            if previous.get("stat") == identity:
                current[key] = previous
            else:
                original = path.read_bytes()
                digest = hashlib.sha256(original).hexdigest()
                current[key] = {"stat": identity, "content": digest}
                if previous.get("content") != digest:
                    result.append({"scope": scope, "path": key, "text": original.decode("utf-8")})
        elif stamps and key in stamps:
            if stamps[key] is not None:
                result.append({"scope": scope, "path": key, "removed": True})
            current[key] = None
        else:
            current[key] = None
    return result, current
