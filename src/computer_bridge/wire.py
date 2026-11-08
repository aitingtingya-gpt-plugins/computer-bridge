"""Framing only: preserve complete JSON across WebSocket platform frame limits."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import cast

from .common import Json, uid

CHUNK = 128 * 1024
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class Sender:
    """Serialize data messages; control frames can run between bounded data frames."""

    def __init__(self, send: Callable[[str], Awaitable[None]]):
        self.raw = send
        self.lock = asyncio.Lock()
        self.confirmed = False
        self.acks: dict[tuple[str, int], asyncio.Future[None]] = {}

    async def control(self, value: Json) -> None:
        await self.raw(json.dumps(value))

    def acknowledge(self, value: Json) -> None:
        pending = self.acks.get((value["id"], value["sequence"]))
        if pending and not pending.done():
            pending.set_result(None)

    def close(self) -> None:
        for pending in self.acks.values():
            if not pending.done():
                pending.set_exception(ConnectionError("连接已结束"))

    async def send(self, value: Json) -> None:
        async with self.lock:
            text = json.dumps(value, ensure_ascii=True)
            if len(text) <= CHUNK:
                await self.raw(text)
                return
            identity = uid("frame")
            for sequence, offset in enumerate(range(0, len(text), CHUNK)):
                last = offset + CHUNK >= len(text)
                key = (identity, sequence)
                pending = None
                if self.confirmed and (sequence % 8 == 7 or last):
                    pending = asyncio.get_running_loop().create_future()
                    self.acks[key] = pending
                try:
                    await self.control({"type": "frame", "id": identity, "sequence": sequence,
                                        "data": text[offset:offset + CHUNK], "last": last})
                    if pending:
                        await asyncio.wait_for(pending, 10)
                    await asyncio.sleep(0)
                finally:
                    self.acks.pop(key, None)


class Frames:
    def __init__(self, max_bytes: int = MAX_REQUEST_BYTES, max_partial: int = 8) -> None:
        self.parts: dict[str, list[str]] = {}
        self.sizes: dict[str, int] = {}
        self.max_bytes, self.max_partial = max_bytes, max_partial

    def receive(self, text: str) -> Json | None:
        if len(text) > self.max_bytes or len(text.encode("utf-8")) > self.max_bytes:
            raise ConnectionError("Computer request exceeds bounded message limit")
        try:
            value: Json = json.loads(text)
        except (ValueError, TypeError) as exc:
            raise ConnectionError("Invalid computer request JSON") from exc
        if not isinstance(value, dict):
            raise ConnectionError("Computer request must be an object")
        if value.get("type") != "frame":
            return value
        identity, sequence, data = value.get("id"), value.get("sequence"), value.get("data")
        if (not isinstance(identity, str) or not 1 <= len(identity) <= 128 or type(sequence) is not int
                or not isinstance(data, str) or type(value.get("last")) is not bool):
            raise ConnectionError("Invalid computer message frame")
        parts = self.parts.get(identity, [])
        if sequence != len(parts):
            raise ConnectionError("Computer message frame is out of order")
        if identity not in self.parts and len(self.parts) >= self.max_partial:
            raise ConnectionError("Too many unfinished computer messages")
        size = self.sizes.get(identity, 0) + len(data.encode("utf-8"))
        if size > self.max_bytes:
            self.parts.pop(identity, None)
            self.sizes.pop(identity, None)
            raise ConnectionError("Computer request exceeds bounded message limit; use file transfer")
        self.parts.setdefault(identity, parts).append(data)
        self.sizes[identity] = size
        if not value["last"]:
            return None
        self.sizes.pop(identity, None)
        try:
            result = json.loads("".join(self.parts.pop(identity)))
        except (ValueError, TypeError) as exc:
            raise ConnectionError("Invalid reassembled computer request") from exc
        if not isinstance(result, dict):
            raise ConnectionError("Computer request must be an object")
        return cast(Json, result)
