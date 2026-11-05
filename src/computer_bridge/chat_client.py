"""Device-native or explicitly account-authorized human chat transport."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import secrets
import time
import webbrowser
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path, PureWindowsPath
from types import TracebackType
from typing import Self
from urllib.parse import urlencode

import httpx2
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import InvalidStatus

from .common import Error, Json, save
from .network import http_client, proxy_for


class ChatClient:
    def __init__(self, config: Path):
        self.config = config
        self.settings: Json = json.loads(config.read_text(encoding="utf-8"))
        if not self.settings.get("device_key"):
            raise Error("chat_not_registered", "请先注册这台电脑，再打开聊天。")
        self.server = str(self.settings["server"]).rstrip("/")
        self.credential_file = config.with_name(config.stem + "-chat.json")
        self.credential: str | None = None
        self.mode = "device"
        self.connected = False
        self.device: Json = {"id": "", "name": self.settings.get("name", "本机")}
        self.account: Json = {}
        self.http = http_client(self.settings)

    async def __aenter__(self) -> Self:
        await self.http.__aenter__()
        return self

    async def __aexit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                        traceback: TracebackType | None) -> None:
        await self.http.__aexit__(exc_type, exc, traceback)

    @property
    def authenticated(self) -> bool:
        return self.connected and (self.mode == "device" or bool(self.credential))

    @property
    def identity(self) -> str:
        return "account:" + str(self.account["id"]) if self.mode == "account" else "device:" + str(self.settings["device_id"])

    def headers(self) -> dict[str, str]:
        if self.mode == "device":
            return {"Authorization": "Bearer " + str(self.settings["device_key"]),
                    "X-Computer-Bridge-Device": str(self.settings["device_id"])}
        return {"Authorization": "Bearer " + str(self.credential)}

    async def _post(self, path: str, body: Json, *, authenticated: bool = True,
                    headers: dict[str, str] | None = None) -> Json:
        headers = headers if headers is not None else self.headers() if authenticated else {}
        response = await self.http.post(self.server + path, json=body, headers=headers)
        if response.status_code >= 500:
            response.raise_for_status()
        if response.headers.get("content-type", "").startswith("application/json"):
            result = response.json()
            if not response.is_success or "error" in result:
                error = result.get("error", {})
                if isinstance(error, dict):
                    code = str(error.get("code", result.get("code", "chat_error")))
                    message = str(error.get("message", "聊天请求失败"))
                else:
                    code, message = str(result.get("code", "chat_error")), str(error)
                if response.status_code == 401 and authenticated:
                    if self.mode == "account":
                        self.credential_file.unlink(missing_ok=True)
                        self.credential = None
                        message += "；请使用 /login 重新登录，或 /logout 返回本机身份。"
                    else:
                        self.connected = False
                        message += "；请检查本机注册是否有效。"
                raise Error(code, message)
            return result
        response.raise_for_status()
        raise Error("chat_response", "服务器没有返回聊天数据，请确认服务器已安装聊天功能。")

    async def action(self, action: str, **parameters: object) -> Json:
        if not self.authenticated:
            raise Error("chat_login_required", "聊天身份不可用；账号模式可使用 /login 重新登录。")
        return await self._post("/chat/api/" + action, parameters)

    @asynccontextmanager
    async def live(self, chat_id: str) -> AsyncIterator[ClientConnection]:
        """Receive human-chat notifications without occupying the device/model connection."""
        if not self.authenticated:
            raise Error("chat_login_required", "聊天身份不可用；账号模式可使用 /login 重新登录。")
        url = self.server.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        try:
            async with connect(url + "/chat/live?" + urlencode({"chat_id": chat_id}),
                additional_headers=self.headers(),
                proxy=proxy_for(self.settings), open_timeout=30, ping_interval=30,
                ping_timeout=60, close_timeout=5, max_size=65536) as socket:
                yield socket
        except InvalidStatus as exc:
            if exc.response.status_code == 403:
                raise Error("device_forbidden", "这段对话不可访问；使用 /resume 选择有权访问的对话。") from exc
            if exc.response.status_code == 401:
                if self.mode == "account":
                    self.credential_file.unlink(missing_ok=True)
                    self.credential = None
                raise Error("chat_login_required", "聊天访问已失效；账号模式可用 /login 重新登录，或 /logout 返回本机身份。") from exc
            raise

    async def connect(self, *, browser: bool = True, login: bool = False, notice: Callable[[str], None] = print) -> None:
        await self.use_device()
        if login:
            await self.login_account(browser=browser, notice=notice)

    async def use_device(self) -> None:
        result = await self._post("/chat/device/session", {}, authenticated=False, headers={
            "Authorization": "Bearer " + str(self.settings["device_key"]),
            "X-Computer-Bridge-Device": str(self.settings["device_id"]),
        })
        self.device = result["device"]
        self.mode, self.credential, self.account, self.connected = "device", None, {}, True

    async def logout(self) -> None:
        await self.use_device()
        self.credential_file.unlink(missing_ok=True)

    async def login_account(self, *, browser: bool = True, notice: Callable[[str], None] = print) -> None:
        if self.credential_file.exists():
            saved = json.loads(self.credential_file.read_text(encoding="utf-8"))
            if saved.get("server") == self.server and saved.get("scope") == "account" and saved.get("device_id") == self.settings["device_id"]:
                try:
                    await self._post("/chat/api/devices", {}, authenticated=False,
                        headers={"Authorization": "Bearer " + str(saved["credential"])})
                except Error as exc:
                    if exc.code not in {"chat_login_required", "account_access_expired", "account_unavailable", "unauthorized", "auth_required", "chat_credential_invalid"}:
                        raise
                    self.credential_file.unlink(missing_ok=True)
                else:
                    self.credential, self.account = str(saved["credential"]), saved["account"]
                    self.mode, self.connected = "account", True
                    return
        pending = await self._post("/chat/device/start", {
            "device_id": self.settings["device_id"], "device_key": self.settings["device_key"], "scope": "account",
        }, authenticated=False)
        notice("请在浏览器登录账号：\n" + str(pending["verification_url"]) + "\n配对码：" + str(pending["code"]))
        if browser:
            webbrowser.open(str(pending["verification_url"]))
        expires = float(pending["expires_at"])
        if expires > 10_000_000_000:
            expires /= 1000
        while time.time() < expires:
            result = await self._post("/chat/device/poll", {
                "request_id": pending["request_id"], "poll_token": pending["poll_token"],
            }, authenticated=False)
            if result["state"] == "approved":
                self.credential, self.account = str(result["credential"]), result["account"]
                self.mode, self.connected = "account", True
                save(self.credential_file, {
                    "server": self.server, "device_id": self.settings["device_id"], "scope": "account",
                    "credential": self.credential, "account": self.account,
                })
                return
            if result["state"] == "expired":
                break
            if result["state"] == "denied":
                raise Error("chat_login_denied", "已取消账号登录；当前身份保持不变。")
            await asyncio.sleep(2)
        raise Error("chat_login_expired", "账号登录已过期，请重新使用 /login。")

    async def upload(self, chat_id: str, path: Path, progress: Callable[[int, int], None] | None = None) -> Json:
        path = path.expanduser().resolve(strict=True)
        if not path.is_file():
            raise Error("chat_attachment", "附件必须是文件。")
        with path.open("rb") as source:
            before = os.fstat(source.fileno())
            def checksum() -> str:
                digest = hashlib.sha256()
                while block := source.read(1024 * 1024):
                    digest.update(block)
                return digest.hexdigest()
            digest = await asyncio.to_thread(checksum)
            source.seek(0)
            started = await self.action("upload-start", chat_id=chat_id, name=path.name,
                mime_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                size=before.st_size, sha256=digest, request_key=secrets.token_hex(12))
            attachment = started["attachment"]
            offset = int(attachment["offset"])
            source.seek(offset)
            while block := source.read(int(started["chunk_size"])):
                body = {"chat_id": chat_id, "attachment_id": attachment["id"], "offset": offset,
                        "data": base64.b64encode(block).decode("ascii")}
                # Each offset is idempotent; a dropped response may be requested again.
                try:
                    result = await self.action("upload-chunk", **body)
                except httpx2.TransportError:
                    result = await self.action("upload-chunk", **body)
                offset = int(result["next_offset"])
                if progress:
                    progress(offset, before.st_size)
            after = os.fstat(source.fileno())
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise Error("file_changed", "上传期间文件发生变化，请重新添加附件。")
        return (await self.action("upload-complete", chat_id=chat_id, attachment_id=attachment["id"]))["attachment"]

    async def download(self, chat_id: str, attachment_id: str, destination: Path | None = None) -> Path:
        attachment = (await self.action("attachment", chat_id=chat_id, attachment_id=attachment_id))["attachment"]
        filename = Path(PureWindowsPath(attachment["name"]).name).name
        destination = (destination or Path.cwd() / filename).expanduser().resolve()
        if destination.exists():
            raise Error("file_exists", "目标文件已存在，请指定新文件名：" + str(destination))
        temporary = destination.with_name(destination.name + "." + secrets.token_hex(6) + ".part")
        digest = hashlib.sha256()
        offset = 0
        try:
            with temporary.open("xb") as target:
                while True:
                    result = await self.action("read-attachment", chat_id=chat_id, attachment_id=attachment_id,
                        offset=offset, length=262144, encoding="base64")
                    block = base64.b64decode(result["data"], validate=True)
                    target.write(block)
                    digest.update(block)
                    offset = int(result["next_offset"])
                    if result["eof"]:
                        break
            if offset != attachment["size"] or digest.hexdigest() != attachment["sha256"]:
                raise Error("chat_checksum", "附件校验失败，未保存为目标文件。")
            os.rename(temporary, destination)
            return destination
        finally:
            temporary.unlink(missing_ok=True)
