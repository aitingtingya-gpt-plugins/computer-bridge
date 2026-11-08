"""In-memory FIFO sends with automatic confirmation after a lost receipt."""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass

import httpx2

from .chat_client import ChatClient
from .common import Error, Json

type Saved = Callable[[str, Json, Json], Awaitable[None]]
type Failed = Callable[[str, Json, Exception], Awaitable[None]]
type Status = Callable[[str, str, str], Awaitable[None]]
type QueueKey = tuple[str, str]


@dataclass
class PendingSend:
    body: Json
    headers: dict[str, str]


class DeliveryQueue:
    """One worker per identity/conversation; no timer exists when it is empty."""

    def __init__(self, client: ChatClient, *, saved: Saved, failed: Failed, status: Status):
        self.client, self.saved, self.failed, self.status = client, saved, failed, status
        self.identity = client.identity
        self.queues: dict[QueueKey, deque[PendingSend]] = {}
        self.tasks: dict[QueueKey, asyncio.Task[None]] = {}
        self.events: dict[QueueKey, asyncio.Event] = {}
        self.closed = False

    def enqueue(self, body: Json) -> None:
        if self.closed:
            raise RuntimeError("发送队列已关闭")
        if not self.client.authenticated:
            raise Error("chat_login_required", "聊天身份不可用，请重新登录。")
        key = self.client.identity, str(body["chat_id"])
        self.queues.setdefault(key, deque()).append(PendingSend(deepcopy(body), self.client.headers()))
        self.events.setdefault(key, asyncio.Event())
        if key not in self.tasks:
            self.tasks[key] = asyncio.create_task(self._run(key))

    def set_identity(self, identity: str) -> None:
        self.identity = identity
        # A renewed credential for the same principal may confirm its original
        # request. Replacing this dict never mutates an in-flight HTTP snapshot.
        if identity == self.client.identity and self.client.authenticated:
            for (owner, _), queue in self.queues.items():
                if owner == identity:
                    for pending in queue:
                        pending.headers = self.client.headers()
        for event in self.events.values():
            event.set()

    def wake(self, identity: str, chat_id: str) -> None:
        event = self.events.get((identity, chat_id))
        if event:
            event.set()

    async def _wait(self, event: asyncio.Event, seconds: float | None = None) -> None:
        try:
            if seconds is None:
                await event.wait()
            else:
                await asyncio.wait_for(event.wait(), seconds)
        except TimeoutError:
            pass

    async def _run(self, key: QueueKey) -> None:
        owner, chat_id = key
        queue, event = self.queues[key], self.events[key]
        delay = 1
        recovering = False
        try:
            while queue and not self.closed:
                event.clear()
                if owner != self.identity or not self.client.authenticated:
                    await self._wait(event)
                    continue
                pending = queue[0]
                await self.status(owner, chat_id, "正在确认发送结果…" if recovering else "正在发送…")
                try:
                    result = await self.client.send_snapshot(pending.body, identity=owner, headers=pending.headers)
                except Error as exc:
                    queue.popleft()
                    await self.failed(owner, pending.body, exc)
                except httpx2.HTTPStatusError as exc:
                    if exc.response.status_code < 500 and exc.response.status_code != 429:
                        queue.popleft()
                        await self.failed(owner, pending.body, exc)
                    else:
                        recovering = True
                        await self.status(owner, chat_id, "发送结果待确认，正在自动恢复…")
                        await self._wait(event, delay)
                        delay = min(delay * 2, 15)
                        continue
                except (httpx2.TransportError, OSError):
                    recovering = True
                    await self.status(owner, chat_id, "发送结果待确认，正在自动恢复…")
                    await self._wait(event, delay)
                    delay = min(delay * 2, 15)
                    continue
                else:
                    queue.popleft()
                    await self.saved(owner, pending.body, result)
                delay, recovering = 1, False
        finally:
            self.queues.pop(key, None)
            self.events.pop(key, None)
            self.tasks.pop(key, None)

    async def discard(self, identity: str, chat_id: str) -> None:
        """Stop this local queue before deleting its server conversation."""
        task = self.tasks.get((identity, chat_id))
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def close(self) -> None:
        self.closed = True
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
