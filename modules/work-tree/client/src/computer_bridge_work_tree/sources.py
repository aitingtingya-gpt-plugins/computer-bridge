"""Host transport metadata and original-file references, never business records."""

from __future__ import annotations

import json
from pathlib import Path

from work_tree.contracts import Error, Json
from work_tree.integration_files import atomic_text
from work_tree.process_lock import process_lock


def directory(root: Path) -> Path:
    return root / ".work-tree/runtime/computer-bridge"


def load(root: Path) -> Json:
    path = directory(root) / "sessions.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save(root: Path, sessions: Json) -> None:
    atomic_text(directory(root) / "sessions.json", json.dumps(sessions, ensure_ascii=False))


def update(root: Path, session: str, fields: Json) -> Json:
    with process_lock(directory(root) / "sessions.lock", blocking=True):
        records = load(root)
        records = {
            key: row
            for key, row in records.items()
            if not row.get("journal") or (root / row["journal"]).parent.exists()
        }
        record = {**records.get(session, {}), **fields}
        records[session] = record
        save(root, records)
        return record


def originals(root: Path, session_id: str, section: str) -> Json:
    sessions = load(root)
    entry = sessions.get(session_id) or next(
        (row for row in sessions.values() if row.get("host_id") == session_id), None
    )
    if entry is None:
        raise Error("source_unavailable", "尚未登记这个宿主会话的原始记录")
    supplied = [root / path for path in entry.get("originals", [])]
    if section == "dialogue" and not supplied:
        raise Error("source_unavailable", "尚未取得主对话原件，不能用插件日志启动规范整理")
    plugin = root / entry["journal"] if entry.get("journal") else None
    paths = supplied or ([plugin] if plugin is not None and plugin.is_file() else [])
    return {
        "files": [{"path": str(path), "size": path.stat().st_size} for path in paths],
        "source": {
            "session_id": session_id,
            "provider": "computer-bridge",
            "operator_import": bool(supplied),
            "files": [
                {"path": str(path), "size": path.stat().st_size, "mtime_ns": path.stat().st_mtime_ns}
                for path in supplied
            ],
        },
        "complete": False,
        "missing": ["导入原件与宿主全部记录的完整性尚未核实"]
        if supplied
        else ["原始上下文、公开回复及插件以外的工具记录尚未取得"],
    }
