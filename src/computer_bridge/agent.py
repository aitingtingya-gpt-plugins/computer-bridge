"""Outbound device connection; network tasks do not own command lifetime."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
from pathlib import Path

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import WebSocketException

from .common import Json, save, uid
from .network import failure_kind, proxy_for
from .network_events import NetworkEvents
from .service import Computer
from .wire import Frames, Sender

log = logging.getLogger(__name__)


class Connection:
    def __init__(self, socket: ClientConnection, computer: Computer, tasks: set[asyncio.Task[None]],
                 ready: asyncio.Event | None = None):
        self.socket, self.computer, self.tasks = socket, computer, tasks
        self.answers: dict[str, asyncio.Future[bool]] = {}
        self.sender = Sender(socket.send)
        self.ready = ready if ready is not None else asyncio.Event()
        self.heartbeat: dict[str, asyncio.Future[None]] = {}

    async def send(self, value: Json) -> None:
        await self.sender.send(value)

    async def human_confirm(self, message: str, parent: str) -> bool:
        identity = uid("human")
        result: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self.answers[identity] = result
        await self.send({"type": "human", "id": identity, "parent": parent, "message": message})
        try:
            return await result
        finally:
            self.answers.pop(identity, None)

    async def execute(self, value: Json) -> None:
        if self.computer.draining and not value["method"].startswith("bridge."):
            return  # The same request will arrive on the replacement connection before execution.
        try:

            async def confirm(message: str) -> bool:
                if value.get("confirmed") is True:
                    return True
                return await self.human_confirm(message, value["id"])

            async def perform() -> Json:
                return await self.computer.execute(value["method"], value["params"], confirm)

            async def received() -> None:
                if not self.sender.confirmed:
                    return
                try:
                    await self.sender.control({"type": "request_received", "id": value["id"],
                                               **({"request_id": value["request_id"]}
                                                  if value.get("request_id") else {})})
                except (OSError, WebSocketException):
                    # The durable task is already registered; its result survives this socket.
                    log.info("request acknowledgement interrupted request=%s", value.get("request_id"))

            if not value.get("request_id"):
                await received()
            if value["method"] == "bridge.ping":
                answer: Json = {"result": {}}
            elif value["method"] == "bridge.update":
                answer = {"result": self.computer.updates.start(value["params"])}
            elif value["method"] == "bridge.update.cancel":
                answer = {"result": self.computer.updates.cancel(value["params"]["id"])}
            elif value["method"] == "bridge.update.status":
                answer = {"result": {"jobs": self.computer.updates.states()}}
            elif value["method"] == "bridge.recover":
                answer = {
                    "result": await self.computer.requests.recover(
                        value["params"].get("request_id"), value["params"].get("seconds", 0)
                    )
                }
            elif value.get("request_id"):
                answer = await self.computer.requests.execute(value, perform, received)
            else:
                answer = {"result": await perform()}
            response = {"type": "response", "id": value["id"], **answer}
            if value.get("request_id") and not value["method"].startswith("bridge."):
                # Only execute() returning proves that both receipt writes committed.
                response["receipt"] = {"request_id": value["request_id"], "state": "completed"}
        except Exception as exc:
            response = {
                "type": "response",
                "id": value["id"],
                "error": {"code": getattr(exc, "code", type(exc).__name__), "message": str(exc)},
            }
        try:
            await self.send(response)
        except (OSError, TimeoutError, WebSocketException):
            self.socket.transport.abort()
            log.info("response delivery interrupted request=%s; receipt retained", value.get("request_id"))

    async def run(self) -> None:
        await self.send({"type": "hello", "info": self.computer.info()})
        await self.send({"type": "update_status", "jobs": self.computer.updates.states()})
        frames = Frames()
        changed = asyncio.Event()
        self.computer.power.changed = changed.set
        updates_changed = asyncio.Event()
        self.computer.updates.report = updates_changed.set

        async def report_updates() -> None:
            while True:
                await updates_changed.wait()
                updates_changed.clear()
                await self.send({"type": "update_status", "jobs": self.computer.updates.states()})

        async def report_power() -> None:
            while True:
                await changed.wait()
                changed.clear()
                await self.send({"type": "power_status", "status": self.computer.power.status()})

        async def monitor() -> None:
            try:
                await asyncio.wait_for(self.ready.wait(), 10)
                if not self.sender.confirmed:
                    return
                while True:
                    await asyncio.sleep(15)
                    identity = str(asyncio.get_running_loop().time())
                    pending = asyncio.get_running_loop().create_future()
                    self.heartbeat[identity] = pending
                    try:
                        async with asyncio.timeout(10):
                            await self.sender.control({"type": "heartbeat", "id": identity})
                            await pending
                    finally:
                        self.heartbeat.pop(identity, None)
            except (OSError, TimeoutError, WebSocketException):
                log.warning("connection application_health_timeout device=%s",
                            self.computer.settings["device_id"])
                self.socket.transport.abort()

        monitoring = asyncio.create_task(monitor())
        reporting = asyncio.create_task(report_power())
        updating = asyncio.create_task(report_updates())
        try:
            async for raw in self.socket:
                text = raw.decode() if isinstance(raw, bytes) else raw
                frame = json.loads(text)
                if frame.get("type") == "heartbeat_ack":
                    pending = self.heartbeat.get(frame["id"])
                    if pending and not pending.done():
                        pending.set_result(None)
                    continue
                if frame.get("type") == "frame_ack":
                    self.sender.acknowledge(frame)
                    continue
                if frame.get("type") == "frame" and "sequence" in frame:
                    if frame["sequence"] % 8 == 7 or frame["last"]:
                        # Control acknowledgements must not wait behind a large outgoing response.
                        await self.socket.send(
                            json.dumps(
                                {"type": "frame_ack", "id": frame["id"], "sequence": frame["sequence"]}
                            )
                        )
                value = frames.receive(text)
                if value is None:
                    continue
                if value["type"] == "request":
                    task = asyncio.create_task(self.execute(value))
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)
                elif value["type"] == "human_response" and value["id"] in self.answers:
                    self.answers[value["id"]].set_result(value["accepted"])
                elif value["type"] == "receipt_ack":
                    self.computer.requests.acknowledge(value["request_id"])
                elif value["type"] == "hello_ack":
                    self.sender.confirmed = "transport_v2" in value.get("capabilities", [])
                    self.ready.set()
                    print(json.dumps({"connected": True, "device_id": self.computer.settings["device_id"],
                                      "name": self.computer.settings["name"]}), flush=True)
                    save(
                        self.computer.directory / "agent-status.json",
                        {
                            "pid": os.getpid(),
                            "connected": True,
                            "version": self.computer.info()["version"],
                            "install_id": os.environ.get("COMPUTER_BRIDGE_INSTALL_ID"),
                            "lock_mode": self.computer.power.status(),
                        },
                    )
        finally:
            save(
                self.computer.directory / "agent-status.json",
                {
                    "pid": os.getpid(),
                    "connected": False,
                    "version": self.computer.info()["version"],
                    "install_id": os.environ.get("COMPUTER_BRIDGE_INSTALL_ID"),
                },
            )
            self.computer.power.changed = lambda: None
            self.computer.updates.report = lambda: None
            self.sender.close()
            monitoring.cancel()
            reporting.cancel()
            updating.cancel()
            await asyncio.gather(reporting, updating, monitoring, return_exceptions=True)
            for answer in self.answers.values():
                if not answer.done():
                    answer.set_result(False)


async def serve(config: Path) -> None:
    computer = Computer(config)
    settings = computer.settings
    endpoint = settings["server"].rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
    endpoint += "/device/connect?id=" + settings["device_id"]
    tasks: set[asyncio.Task[None]] = set()
    retry = 1
    await computer.power.start()
    save(
        computer.directory / "power-handoff-status.json",
        {
            "pid": os.getpid(),
            "install_id": os.environ.get("COMPUTER_BRIDGE_INSTALL_ID"),
            "lock_mode": computer.power.status(),
        },
    )
    loop = asyncio.get_running_loop()
    network_changed = asyncio.Event()

    def network_event() -> None:
        loop.call_soon_threadsafe(network_changed.set)

    network = await asyncio.to_thread(NetworkEvents, network_event)
    current = asyncio.current_task()
    if sys.platform != "win32" and current:
        loop.add_signal_handler(signal.SIGTERM, current.cancel)
    update_watch = asyncio.create_task(computer.updates.watch(computer, current.cancel)) if current else None

    async def resumed() -> None:
        waits = [asyncio.create_task(event.wait()) for event in (computer.power.resume, network_changed)]
        try:
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for waiting in waits:
                waiting.cancel()
            await asyncio.gather(*waits, return_exceptions=True)
        computer.power.resume.clear()
        network_changed.clear()

    async def connection_cycle(ready: asyncio.Event) -> None:
        nonlocal retry
        log.info("connection opening device=%s", settings["device_id"])
        network_settings = json.loads(config.read_text(encoding="utf-8"))
        async with connect(
            endpoint,
            additional_headers={"Authorization": "Bearer " + settings["device_key"]},
            max_size=None,
            proxy=proxy_for(network_settings),
            open_timeout=30,
            ping_interval=30,
            ping_timeout=60,
        ) as socket:
            retry = 1
            log.info("connection established device=%s connection=%s", settings["device_id"], socket.id)
            try:
                await Connection(socket, computer, tasks, ready).run()
            except asyncio.CancelledError:
                socket.transport.abort()
                raise

    try:
        while True:
            try:
                ready = asyncio.Event()
                running = asyncio.create_task(connection_cycle(ready))
                wake = asyncio.create_task(resumed())
                try:
                    while True:
                        done, _ = await asyncio.wait({running, wake}, return_when=asyncio.FIRST_COMPLETED)
                        if running in done:
                            break
                        if not ready.is_set():
                            # Changes during opening are already reflected by this connection attempt.
                            # Finish its bounded handshake instead of repeatedly cancelling it.
                            wake = asyncio.create_task(resumed())
                            continue
                        log.info("connection refreshing after wake/network change device=%s",
                                 settings["device_id"])
                        running.cancel()
                        await asyncio.gather(running, return_exceptions=True)
                        retry = 1
                        break
                    if not running.cancelled():
                        await running
                finally:
                    for task in (running, wake):
                        task.cancel()
                    await asyncio.gather(running, wake, return_exceptions=True)
            except (OSError, TimeoutError, WebSocketException) as exc:
                log.warning(
                    "connection unavailable device=%s phase=%s error=%s retry_seconds=%s",
                    settings["device_id"],
                    failure_kind(exc),
                    type(exc).__name__,
                    retry,
                )
            try:
                await asyncio.wait_for(resumed(), retry)
                retry = 1
            except TimeoutError:
                pass
            retry = min(retry * 2, 30)
    except asyncio.CancelledError:
        pass
    finally:
        log.info("device stopping device=%s", settings["device_id"])
        if update_watch:
            update_watch.cancel()
            await asyncio.gather(update_watch, return_exceptions=True)
        await asyncio.to_thread(network.close)
        await computer.close()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
