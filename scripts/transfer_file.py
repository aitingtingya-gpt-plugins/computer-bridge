#!/usr/bin/env python3
"""Transfer a file directly between this executor and a registered computer.

No account/device credentials are needed. Pass the short-lived JSON result of
computer.transfer begin in a private file, or on stdin using --ticket -.
Only progress and checksums are printed. File data never passes through a model.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import sys
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

CHUNK = 8 * 1024 * 1024
RETRIES = 6
USER_AGENT = "computer-bridge/0.2.6-beta transfer-helper"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Transfer redirects are not allowed")


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(256 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def ticket(path: str) -> dict:
    if path == "-":
        value = json.load(sys.stdin)
    else:
        source = Path(path)
        if os.name != "nt" and source.stat().st_mode & 0o077:
            raise RuntimeError("The ticket file must be private (chmod 600)")
        value = json.loads(source.read_text(encoding="utf-8"))
    if "result" in value and "http" not in value:
        value = value["result"]
    http = value["http"]
    url = urllib.parse.urlsplit(http["url"])
    local = url.hostname == "localhost"
    try:
        local = local or ipaddress.ip_address(url.hostname or "").is_loopback
    except ValueError:
        pass
    if (url.scheme != "https" and not (url.scheme == "http" and local)) or url.username or url.password or url.query or url.fragment:
        raise RuntimeError("Expected a private HTTPS transfer endpoint")
    if not url.path.startswith("/transfers/") or "/" in url.path[len("/transfers/"):]:
        raise RuntimeError("Invalid transfer endpoint")
    if not isinstance(value.get("size"), int) or value["size"] < 0 or not isinstance(value.get("sha256"), str) or len(value["sha256"]) != 64:
        raise RuntimeError("Invalid transfer metadata")
    auth = http["headers"]["Authorization"]
    if not auth.startswith("Bearer ") or "\n" in auth or "\r" in auth:
        raise RuntimeError("Invalid scoped transfer credential")
    return value


def explicit_proxy(value: str | None) -> dict:
    """Use only a deliberately supplied trusted proxy; never ambient settings."""
    if value is None:
        return {}
    parsed = urllib.parse.urlsplit(value)
    try:
        parsed.port  # Validate the optional port without printing the URL.
    except ValueError as error:
        raise RuntimeError("Invalid explicit proxy") from error
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
            or any(char.isspace() for char in value)):
        raise RuntimeError("Expected an explicit trusted HTTP(S) proxy without embedded credentials")
    return {"http": value, "https": value}


def network_failure(error: Exception) -> str | None:
    cause = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(cause, socket.gaierror):
        return "transfer_dns_error"
    if isinstance(cause, ssl.SSLError):
        return "transfer_tls_error"
    if isinstance(cause, (TimeoutError, socket.timeout)):
        return "transfer_timeout"
    if isinstance(cause, (ConnectionError, OSError, http.client.HTTPException)):
        return "transfer_connection_error"
    return None


class Client:
    def __init__(self, value: dict, proxy: str | None = None):
        self.value = value
        self.url = value["http"]["url"]
        self.headers = {"Authorization": value["http"]["headers"]["Authorization"], "User-Agent": USER_AGENT}
        # Do not forward credentials through arbitrary environment proxy settings.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler(explicit_proxy(proxy)), NoRedirect())

    def request(self, method: str, headers=None, data=None, suffix=""):
        request = urllib.request.Request(self.url + suffix, method=method, data=data,
                                         headers={**self.headers, **(headers or {})})
        return self.opener.open(request, timeout=330 if method == "PATCH" else 60)

    def head(self):
        with self.request("HEAD") as response:
            if response.headers.get("X-Content-SHA256") != self.value["sha256"]:
                raise RuntimeError("Transfer checksum identity changed")
            return response.headers


def retryable(error: Exception) -> bool:
    # Do not repeatedly retry permanent name-resolution or TLS trust failures.
    kind = network_failure(error)
    if kind in {"transfer_dns_error", "transfer_tls_error"}:
        return False
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (408, 409, 429, 500, 502, 503, 504)
    return isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException))


def progress(offset: int, size: int):
    print(json.dumps({"offset": offset, "size": size}), flush=True)


def upload(client: Client, path: Path):
    value = client.value
    if value["http"]["direction"] != "upload":
        raise RuntimeError("This ticket is not an upload")
    if not path.is_file() or path.stat().st_size != value["size"] or digest(path) != value["sha256"]:
        raise RuntimeError("Source does not match the approved size and SHA256")
    failures = 0
    chunk_size = min(CHUNK, int(value["http"].get("max_patch_size", CHUNK)))
    if chunk_size <= 0:
        raise RuntimeError("Invalid maximum PATCH size")
    with path.open("rb") as source:
        while True:
            try:
                headers = client.head()
                offset = int(headers["Upload-Offset"])
                if int(headers["Upload-Length"]) != value["size"] or not 0 <= offset <= value["size"]:
                    raise RuntimeError("Invalid acknowledged upload offset")
                if offset == value["size"]:
                    with client.request("POST", data=b"", suffix="/commit") as response:
                        result = json.load(response)
                    if result.get("state") != "completed" or result.get("sha256") != value["sha256"] or result.get("size") != value["size"]:
                        raise RuntimeError("Destination did not confirm atomic commit")
                    return result
                source.seek(offset)
                data = source.read(min(chunk_size, value["size"] - offset))
                if not data:
                    raise RuntimeError("Source changed during upload")
                with client.request("PATCH", {"Content-Type": "application/octet-stream", "Upload-Offset": str(offset)}, data) as response:
                    acknowledged = int(response.headers["Upload-Offset"])
                    if acknowledged != offset + len(data):
                        raise RuntimeError("Unexpected acknowledged offset")
                progress(acknowledged, value["size"])
                failures = 0
            except Exception as error:
                if not retryable(error) or failures >= RETRIES:
                    raise
                time.sleep(min(2 ** failures, 10))
                failures += 1
                # The next HEAD decides which durable prefix exists. Never replay
                # a failed PATCH using a guessed offset or create another upload.


def download(client: Client, path: Path, overwrite: bool):
    value = client.value
    if value["http"]["direction"] != "download":
        raise RuntimeError("This ticket is not a download")
    if path.exists() and not overwrite:
        raise RuntimeError("Destination exists; use --overwrite only when authorized")
    if path.is_symlink():
        raise RuntimeError("Refusing a symlink destination")
    part = path.with_name(path.name + ".bridge-part")
    sidecar = path.with_name(path.name + ".bridge-part.json")
    if part.is_symlink() or sidecar.is_symlink():
        raise RuntimeError("Refusing symlink resume files")
    identity = {"size": value["size"], "sha256": value["sha256"]}
    if part.exists():
        if not sidecar.is_file() or json.loads(sidecar.read_text()) != identity:
            raise RuntimeError("Existing partial file belongs to another download")
    else:
        with part.open("xb") as file:
            os.chmod(part, 0o600)
        with sidecar.open("w", encoding="utf-8") as file:
            json.dump(identity, file)
    headers = client.head()
    if int(headers["Content-Length"]) != value["size"]:
        raise RuntimeError("Download size changed")
    etag = headers["ETag"]
    failures = 0
    with part.open("r+b") as output:
        while output.seek(0, os.SEEK_END) < value["size"]:
            offset = output.tell()
            try:
                with client.request("GET", {"Range": f"bytes={offset}-", "If-Range": etag}) as response:
                    if response.status != 206 or response.headers.get("ETag") != etag or response.headers.get("Content-Range") != f"bytes {offset}-{value['size']-1}/{value['size']}":
                        raise RuntimeError("Server did not honor the pinned resume range")
                    while True:
                        block = response.read(256 * 1024)
                        if not block:
                            break
                        if output.tell() + len(block) > value["size"]:
                            raise RuntimeError("Download exceeds approved size")
                        output.write(block)
                    output.flush()
                    os.fsync(output.fileno())
                if output.tell() < value["size"]:
                    raise ConnectionError("Download interrupted")
                failures = 0
                progress(output.tell(), value["size"])
            except Exception as error:
                output.flush()
                os.fsync(output.fileno())
                if not retryable(error) or failures >= RETRIES:
                    raise
                time.sleep(min(2 ** failures, 10))
                failures += 1
    if part.stat().st_size != value["size"] or digest(part) != value["sha256"]:
        raise RuntimeError("Downloaded SHA256 differs; partial file retained for inspection")
    if overwrite:
        os.replace(part, path)
    else:
        os.link(part, path)  # Atomic no-clobber even if a file appeared meanwhile.
        part.unlink()
    sidecar.unlink()
    if os.name != "nt":
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    return {"state": "completed", "size": value["size"], "sha256": value["sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["prepare-upload", "upload", "download"])
    parser.add_argument("file", type=Path)
    parser.add_argument("--ticket", help="Private begin-result JSON file, or - for stdin")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--proxy", help="Explicit trusted HTTP(S) proxy. Never inferred from environment; no credentials in URL.")
    args = parser.parse_args()
    try:
        if args.operation == "prepare-upload":
            result = {"size": args.file.stat().st_size, "sha256": digest(args.file)}
        else:
            if not args.ticket:
                raise RuntimeError("--ticket is required")
            client = Client(ticket(args.ticket), proxy=args.proxy)
            result = upload(client, args.file) if args.operation == "upload" else download(client, args.file, args.overwrite)
        print(json.dumps(result))
    except urllib.error.HTTPError as error:
        print(json.dumps({"error": "transfer_http_error", "status": error.code}), file=sys.stderr)
        return 1
    except Exception as error:
        # Never print urllib request objects, URLs, headers or credential contents.
        message = network_failure(error) or (str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        print(json.dumps({"error": message}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
