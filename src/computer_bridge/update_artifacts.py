"""Stream software artifacts through the configured public connection and verify bytes."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from pathlib import Path

from .common import Error, Json
from .network import http_client


async def download(
    settings: Json, artifact: Json, target: Path, cancelled: Callable[[], None] | None = None
) -> None:
    url = artifact["download_url"]
    digest = hashlib.sha256()
    total = 0
    async with http_client({**settings, "server": url}) as http:
        async with http.stream(
            "GET", url, headers={"Authorization": "Bearer " + settings["device_key"]}, follow_redirects=True
        ) as response:
            response.raise_for_status()
            with target.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    if cancelled:
                        cancelled()
                    total += len(chunk)
                    digest.update(chunk)
                    output.write(chunk)
    if digest.hexdigest() != artifact["sha256"] or total != artifact["size"]:
        raise Error("update_checksum", "下载校验失败，原版本保持运行")
