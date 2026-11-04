"""Framing only: preserve complete JSON across WebSocket platform frame limits."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import cast

from .common import Json, uid

CHUNK = 128 * 1024


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
    def __init__(self) -> None:
        self.parts: dict[str, list[str]] = {}

    def receive(self, text: str) -> Json | None:
        value: Json = json.loads(text)
        if value.get("type") != "frame":
            return value
        self.parts.setdefault(value["id"], []).append(value["data"])
        if not value["last"]:
            return None
        return cast(Json, json.loads("".join(self.parts.pop(value["id"]))))
