"""Small transport/runtime primitives, independent of every optional module."""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import Any

type Json = dict[str, Any]


class Error(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

    def as_dict(self) -> Json:
        return {"code": self.code, "message": str(self)}


def uid(prefix: str) -> str:
    return prefix + "_" + secrets.token_hex(16)


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + secrets.token_hex(8))
    try:
        temporary.write_text(text, encoding="utf-8")
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def save(path: Path, data: Json) -> None:
    atomic_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def home() -> Path:
    return (
        Path(os.environ.get("COMPUTER_BRIDGE_HOME", Path.home() / ".computer-bridge")).expanduser().resolve()
    )


def background_options() -> Json:
    return {"creationflags": 0x08000000} if os.name == "nt" else {"start_new_session": True}
