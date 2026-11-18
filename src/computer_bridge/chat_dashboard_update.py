"""Read-only release status for the terminal startup dashboard."""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx2

from . import github_update
from .common import Error

_UPDATE_CHECK_TIMEOUT = 60.0
_UPDATE_ROUTE_TIMEOUT = 10.0
_UPDATE_RETRY_DELAY = 1.0


async def read_dashboard_update(home_dir: Path, current: str) -> tuple[str, str, str, str]:
    """Return source, default channel, latest version (if known), and display status."""
    source = github_update.DEFAULT_REPOSITORY
    channel = github_update.normalize_channel(None)
    label = github_update.CHANNEL_LABELS[channel]
    settings = github_update.load_device_settings(home_dir)
    last_failure = "检查更新超时。"
    try:
        async with asyncio.timeout(_UPDATE_CHECK_TIMEOUT):
            while True:
                retry_delay = _UPDATE_RETRY_DELAY
                try:
                    release = await github_update.fetch_latest_release(
                        settings, channel=channel, repository=source, dashboard_route_timeout=_UPDATE_ROUTE_TIMEOUT,
                    )
                    if release is None:
                        return source, label, "", "此渠道暂无可用发布版本。"
                    latest = str(release["version"])
                    if github_update.is_newer_version(latest, current):
                        result = "有新版本，可使用 /update 查看。"
                    elif github_update.is_newer_version(current, latest):
                        result = "本机版本高于此渠道最新版本。"
                    else:
                        result = "本机已是此渠道最新版本。"
                    return source, label, latest, result
                except (TimeoutError, httpx2.TimeoutException):
                    last_failure = "检查更新超时。"
                except github_update.ReleaseHTTPError as exc:
                    if exc.retry_after is not None:
                        retry_delay = max(retry_delay, exc.retry_after)
                    last_failure = f"无法查询发布版本（HTTP {exc.status_code}）。"
                except Error as exc:
                    if exc.code == "github_network":
                        last_failure = "无法连接更新来源。"
                    elif exc.code == "github_http":
                        last_failure = "无法查询发布版本（来源不可用或无访问权限）。"
                    else:
                        last_failure = "无法获取更新信息。"
                except (OSError, httpx2.HTTPError):
                    last_failure = "无法连接更新来源。"
                except (ValueError, KeyError, TypeError):
                    last_failure = "无法获取更新信息。"
                await asyncio.sleep(retry_delay)
    except TimeoutError:
        return source, label, "", last_failure
