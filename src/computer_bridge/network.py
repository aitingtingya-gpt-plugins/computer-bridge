"""One explicit proxy policy for registration and the outbound device connection."""

from __future__ import annotations

import ipaddress
import socket
import ssl
from urllib.parse import urlsplit

import httpx2
from websockets.proxy import get_proxy
from websockets.uri import parse_uri

from .common import Error, Json


def proxy_for(settings: Json) -> str | None:
    server = settings["server"]
    host = urlsplit(server).hostname or ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host.lower() == "localhost"
    if local:
        return None
    network = settings.get("network", {"mode": "auto"})
    mode = network.get("mode", "auto")
    if mode == "direct":
        return None
    if mode == "proxy":
        value = network.get("proxy_url", "")
        if urlsplit(value).scheme not in {"http", "https", "socks5", "socks5h"}:
            raise Error("proxy_config", "请设置 HTTP、HTTPS 或 SOCKS5 代理地址")
        return str(value)
    if mode != "auto":
        raise Error("proxy_config", "网络模式必须为 auto、direct 或 proxy")
    return get_proxy(parse_uri(server.replace("https://", "wss://").replace("http://", "ws://")))


def http_client(settings: Json) -> httpx2.AsyncClient:
    # Resolve the system proxy explicitly. Never let NO_PROXY syntax affect httpx2 parsing.
    proxy = proxy_for(settings)
    if proxy and proxy.startswith("socks5h://"):
        proxy = "socks5://" + proxy[len("socks5h://") :]
    return httpx2.AsyncClient(trust_env=False, proxy=proxy, timeout=30)


def failure_kind(error: BaseException) -> str:
    if isinstance(error, socket.gaierror):
        return "dns"
    if isinstance(error, ssl.SSLError):
        return "tls"
    if "proxy" in type(error).__name__.lower():
        return "proxy"
    if isinstance(error, TimeoutError):
        return "handshake_timeout"
    if "keepalive ping timeout" in str(error):
        return "heartbeat_timeout"
    return "transport"
