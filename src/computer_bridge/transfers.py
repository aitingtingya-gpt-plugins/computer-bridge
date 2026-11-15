"""Bounded, resumable computer I/O; file bodies never enter model tool results.

Only fsynced data plus its fsynced journal advance an upload offset. The gateway
owns account/device authorization; this store additionally binds the original
session, exact file, permission revision and one-transfer tool approval.

One computer service owns this directory. Per-transfer locks and bounded I/O
slots isolate slow transfers without serializing permission changes. POSIX
operations pin the destination directory; Windows additionally rejects reparse
points but its directory-rename/power-loss guarantees require platform tests.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import stat
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Callable

from .common import Error, Json

_auto_grant: ContextVar[str | None] = ContextVar("transfer_auto_grant", default=None)


@contextmanager
def transfer_auto_grant(grant: str | None):
    token = _auto_grant.set(grant)
    try:
        yield
    finally:
        _auto_grant.reset(token)

CHUNK_SIZE = 256 * 1024
MAX_TRANSFERS = 128
MAX_TEMP_BYTES = 20 * 1024**3
TRANSFER_TTL = 24 * 60 * 60
MAX_ACTIVE_IO = 8
_ID = re.compile(r"[a-f0-9]{32}\Z")
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_TERMINAL = {"completed", "cancelled", "expired", "revoked"}


def _fail(code: str, message: str) -> None:
    raise Error(code, message)


def _sync_dir(path: Path) -> None:
    # Windows file fsync is available; Python cannot fsync a directory there.
    # Do not claim POSIX power-loss durability for that platform.
    if os.name != "nt":
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _fingerprint(info: os.stat_result) -> list[int]:
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def _inode(info: os.stat_result) -> list[int]:
    return [info.st_dev, info.st_ino]


def _reparse(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def _hash(file, checkpoint: Callable[[], None] = lambda: None) -> str:
    digest = hashlib.sha256()
    file.seek(0)
    before = os.fstat(file.fileno())
    remaining = before.st_size
    while remaining:
        checkpoint()
        block = file.read(min(CHUNK_SIZE, remaining))
        if not block:
            _fail("transfer_changed", "File changed during hashing")
        digest.update(block)
        remaining -= len(block)
    checkpoint()
    if _fingerprint(before) != _fingerprint(os.fstat(file.fileno())):
        _fail("transfer_changed", "File changed during hashing")
    return digest.hexdigest()


class _Entry:
    def __init__(self):
        self.lock = threading.RLock()
        self.cancel = threading.Event()


class _Directory:
    """Pin a canonical parent; never follow a replaced leaf or staging symlink."""
    def __init__(self, path: Path, expected: list[int] | None = None):
        self.path, self.fd = path, None
        if path.resolve() != path or _reparse(path.lstat()):
            _fail("transfer_changed", "Transfer directory changed")
        if os.open in os.supports_dir_fd:
            self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
            info = os.fstat(self.fd)
        else:
            info = path.stat()
        self.identity = _inode(info)
        if expected is not None and self.identity != expected:
            self.close()
            _fail("transfer_changed", "Transfer directory changed")

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def check(self):
        try:
            info = self.path.lstat()
        except FileNotFoundError:
            _fail("transfer_changed", "Transfer directory changed")
        if _reparse(info) or _inode(info) != self.identity or self.path.resolve() != self.path:
            _fail("transfer_changed", "Transfer directory changed")

    def info(self, name: str):
        self.check()
        try:
            return os.stat(name, dir_fd=self.fd, follow_symlinks=False) if self.fd is not None else (self.path / name).lstat()
        except FileNotFoundError:
            return None

    def open(self, name: str, flags: int):
        self.check()
        before = self.info(name)
        if before is not None and (_reparse(before) or not stat.S_ISREG(before.st_mode)):
            _fail("transfer_changed", "Transfer file is not an original regular file")
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        fd = os.open(name, flags, 0o600, dir_fd=self.fd) if self.fd is not None else os.open(self.path / name, flags, 0o600)
        try:
            info = os.fstat(fd)
            after = self.info(name)
            if not stat.S_ISREG(info.st_mode) or after is None or _reparse(after) or _inode(after) != _inode(info):
                _fail("transfer_changed", "Transfer file changed while opening")
            return os.fdopen(fd, "r+b" if flags & os.O_RDWR else "rb")
        except BaseException:
            os.close(fd)
            raise

    def unlink(self, name: str):
        self.check()
        if self.fd is not None:
            os.unlink(name, dir_fd=self.fd)
        else:
            (self.path / name).unlink()

    def publish(self, temporary: str, target: str, overwrite: bool, identity: list[int]):
        self.check()
        source = self.info(temporary)
        if source is None or _reparse(source) or _inode(source) != identity or source.st_nlink != 1:
            _fail("transfer_changed", "Staging file changed before commit")
        if self.fd is not None:
            if overwrite:
                os.replace(temporary, target, src_dir_fd=self.fd, dst_dir_fd=self.fd)
            else:
                os.link(temporary, target, src_dir_fd=self.fd, dst_dir_fd=self.fd, follow_symlinks=False)
                os.unlink(temporary, dir_fd=self.fd)
        elif overwrite:
            os.replace(self.path / temporary, self.path / target)
        else:
            os.link(self.path / temporary, self.path / target, follow_symlinks=False)
            os.unlink(self.path / temporary)
        self.sync()

    def sync(self):
        if self.fd is not None:
            os.fsync(self.fd)
        else:
            _sync_dir(self.path)


class Transfers:
    def __init__(self, directory: Path, authorize: Callable[[str, str, bool], Path],
                 max_transfers: int = MAX_TRANSFERS, max_temp_bytes: int = MAX_TEMP_BYTES,
                 revision: Callable[[], int] = lambda: 0,
                 permission: Callable[[bool], None] = lambda approved: None,
                 ttl: float = TRANSFER_TTL, clock: Callable[[], float] = time.time):
        self.directory = directory
        self.authorize, self.revision, self.permission = authorize, revision, permission
        self.max_transfers, self.max_temp_bytes, self.ttl, self.clock = max_transfers, max_temp_bytes, ttl, clock
        self.lock = threading.RLock()
        # Configuration updates share this short critical section, not I/O hashes.
        self.permission_lock = threading.RLock()
        self.entries: dict[str, _Entry] = {}
        self.io_slots = threading.BoundedSemaphore(MAX_ACTIVE_IO)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if directory.is_symlink():
            _fail("transfer_invalid", "Transfer state must not be a symbolic link")

    def _entry(self, identity: str, *, create: bool = False) -> _Entry:
        if not isinstance(identity, str) or not _ID.fullmatch(identity):
            _fail("transfer_missing", "Unknown transfer")
        with self.lock:
            if identity not in self.entries and not create and not (self.directory / (identity + ".json")).exists():
                _fail("transfer_missing", "Unknown transfer")
            return self.entries.setdefault(identity, _Entry())

    @contextmanager
    def _locked(self, identity: str, *, io: bool = True, create: bool = False):
        entry = self._entry(identity, create=create)
        if not entry.lock.acquire(blocking=False):
            _fail("transfer_busy", "Transfer is already processing a request; retry its status")
        acquired = False
        try:
            if io:
                acquired = self.io_slots.acquire(blocking=False)
                if not acquired:
                    _fail("transfer_busy", "Computer transfer concurrency limit reached")
            yield entry
        finally:
            if acquired:
                self.io_slots.release()
            with self.lock:
                if not (self.directory / (identity + ".json")).exists() and self.entries.get(identity) is entry:
                    self.entries.pop(identity, None)
            entry.lock.release()

    def _save(self, value: Json) -> None:
        path = self.directory / (value["transfer_id"] + ".json")
        temporary = path.with_suffix(".new")
        try:
            with temporary.open("w", encoding="utf-8") as file:
                os.chmod(temporary, 0o600)
                json.dump(value, file)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
            _sync_dir(path.parent)
        finally:
            temporary.unlink(missing_ok=True)

    def _record(self, identity: str) -> Json:
        if not isinstance(identity, str) or not _ID.fullmatch(identity):
            _fail("transfer_missing", "Unknown transfer")
        try:
            return json.loads((self.directory / (identity + ".json")).read_text())
        except FileNotFoundError:
            _fail("transfer_missing", "Unknown transfer")

    def _touch(self, value: Json):
        value["updated_at"] = self.clock()
        value["expires_at"] = self.clock() + self.ttl
        self._save(value)

    def _check(self, value: Json, *, cancel: bool = True):
        with self.permission_lock:
            self._check_locked(value, cancel=cancel)

    def _check_locked(self, value: Json, *, cancel: bool = True):
        if value["revision"] != self.revision():
            _fail("approval_invalidated", "Transfer permission revision changed")
        if value.get("auto_grant"):
            if value["auto_grant"] != _auto_grant.get():
                _fail("chat_auto_ended", "Transfer belongs to another Chat mode revision")
        else:
            self.permission(value.get("permission_approved", False))
        if value.get("expires_at", 0) <= self.clock() and value["state"] not in _TERMINAL:
            _fail("transfer_expired", "Transfer expired; start a new authorized transfer")
        self._path(value["session"], value["path"], value["kind"] == "upload")
        if value["kind"] == "upload":
            self._path(value["session"], value["temporary"], True)
        if cancel and value["state"] not in _TERMINAL and self._entry(value["transfer_id"]).cancel.is_set():
            _fail("transfer_cancelled", "Transfer cancellation requested")

    def _path(self, session: str, path: str, write: bool) -> Path:
        result = self.authorize(session, path, write)
        if str(result.resolve()) != path:
            _fail("transfer_changed", "Transfer path changed")
        return result

    def _load(self, session: str, identity: str, kind: str, *, cancel: bool = True) -> Json:
        value = self._record(identity)
        if value["session"] != session or value["kind"] != kind:
            _fail("transfer_missing", "Unknown transfer")
        self._check(value, cancel=cancel)
        return value

    def validate_receipt(self, result: Json):
        """A cached body is not permission to read after revocation."""
        value = self._record(result.get("transfer_id"))
        self._check(value, cancel=False)

    @staticmethod
    def _status(value: Json) -> Json:
        return {key: value[key] for key in ("transfer_id", "offset", "size", "sha256", "state")} | {
            "max_chunk_size": CHUNK_SIZE, "expires_at": value.get("expires_at"),
            **({"etag": value["etag"]} if value.get("etag") else {}),
        }

    def _identity(self, session: str, kind: str, request_key: str | None) -> str:
        if request_key is None:
            return secrets.token_hex(16)
        if not isinstance(request_key, str) or not 1 <= len(request_key) <= 256:
            _fail("transfer_invalid", "Invalid transfer retry key")
        return hashlib.sha256(json.dumps([session, kind, request_key]).encode()).hexdigest()[:32]

    def _begin_permission(self, session: str, identity: str, kind: str, approved: bool):
        if (self.directory / (identity + ".json")).exists():
            # Resume only that original authorized transfer, never infer a new
            # grant from a retry key supplied for a different session or file.
            self._load(session, identity, kind)
        else:
            self._new_permission(approved)

    def _new_permission(self, approved: bool):
        if not _auto_grant.get():
            self.permission(approved)

    def _quota(self, size: int):
        records = [json.loads(path.read_text()) for path in self.directory.glob("*.json")]
        # Preserve retry receipts for their whole TTL rather than evicting one
        # and accidentally accepting the same begin as a new upload.
        if len(records) >= max(512, self.max_transfers * 4):
            _fail("transfer_limit", "Transfer receipt quota exceeded; retry after expiration")
        active = [r for r in records if r["state"] not in _TERMINAL]
        if len(active) >= self.max_transfers or sum(r["size"] for r in active if r["kind"] == "upload") + size > self.max_temp_bytes:
            _fail("transfer_limit", "Transfer quota exceeded; cancel unused transfers")

    def reap(self):
        """Clean only our verified staging inode, including after revoked access.

        Cleanup has no authority to delete final user files or a replaced path.
        Busy transfers observe revocation/cancellation at the next hash block.
        """
        now = self.clock()
        for path in list(self.directory.glob("*.json")):
            identity = path.stem
            try:
                with self._locked(identity, io=False):
                    value = self._record(identity)
                    if value["state"] in _TERMINAL:
                        if value.get("expires_at", 0) <= now:
                            path.unlink(missing_ok=True)
                        continue
                    reason = "revoked" if value["revision"] != self.revision() else (
                        "expired" if value.get("expires_at", 0) <= now else None)
                    if reason:
                        self._discard(value, reason)
            except (Error, OSError, ValueError):
                # A replaced staging path is not ours to delete. Keep its quota
                # reservation and journal for inspection instead of erasing it.
                continue
        with self.lock:
            for identity, entry in list(self.entries.items()):
                if not (self.directory / (identity + ".json")).exists() and entry.lock.acquire(blocking=False):
                    try:
                        self.entries.pop(identity, None)
                    finally:
                        entry.lock.release()

    def _parent(self, value: Json):
        return _Directory(Path(value["path"]).parent, value.get("parent"))

    def _discard(self, value: Json, state: str):
        if value["kind"] == "upload":
            with self._parent(value) as parent:
                name = Path(value["temporary"]).name
                info = parent.info(name)
                if info is not None:
                    if value.get("inode") is None and value["state"] == "allocating":
                        self._allocation_inode(value, info)
                    if _reparse(info) or _inode(info) != value.get("inode") or not stat.S_ISREG(info.st_mode):
                        _fail("transfer_changed", "Staging file changed; cleanup refused")
                    # Never unlink a final file, even in the link/unlink crash window.
                    parent.unlink(name)
                    parent.sync()
        value["state"] = state
        self._touch(value)

    def upload_begin(self, session: str, path: str, size: int, sha256: str, overwrite: bool = False,
                     request_key: str | None = None, *, permission_approved: bool = False,
                     expected_revision: int | None = None) -> Json:
        if type(overwrite) is not bool or type(size) is not int or size < 0 or not isinstance(sha256, str) or not _HASH.fullmatch(sha256):
            _fail("transfer_invalid", "Expected nonnegative size and lowercase SHA256")
        identity = self._identity(session, "upload", request_key)
        with self.permission_lock:
            self._begin_permission(session, identity, "upload", permission_approved)
            revision = self.revision() if expected_revision is None else expected_revision
            if revision != self.revision():
                _fail("approval_invalidated", "Transfer permission revision changed")
            target = self.authorize(session, path, True).resolve()
        self.reap()
        with self._locked(identity, create=True):
            if (self.directory / (identity + ".json")).exists():
                value = self._load(session, identity, "upload")
                if (value["path"], value["size"], value["sha256"], value["overwrite"]) != (str(target), size, sha256, overwrite):
                    _fail("request_conflict", "Transfer retry key was used with different parameters")
                with self._parent(value) as parent:
                    self._recover_allocation(value, parent)
                    self._recover_commit(value, parent)
                return self._status(value)
            with self.permission_lock, _Directory(target.parent) as parent:
                self._new_permission(permission_approved)
                if revision != self.revision():
                    _fail("approval_invalidated", "Transfer permission revision changed")
                if parent.info(target.name) is not None and not overwrite:
                    _fail("file_exists", "Destination already exists")
                temporary = target.parent / (".computer-bridge-upload-" + identity)
                self._path(session, str(temporary), True)
                value = dict(transfer_id=identity, session=session, revision=revision, kind="upload", path=str(target),
                             temporary=str(temporary), size=size, sha256=sha256, offset=0, state="allocating",
                             overwrite=overwrite, inode=None, parent=parent.identity,
                             permission_approved=permission_approved, auto_grant=_auto_grant.get(), created_at=self.clock())
                with self.lock:
                    self._quota(size)
                    self._touch(value)
                # Journal first reserves quota. A crash before recording the
                # staging inode leaves an allocation requiring safe inspection.
                with parent.open(temporary.name, os.O_RDWR | os.O_CREAT | os.O_EXCL) as file:
                    os.fsync(file.fileno())
                    value["inode"] = _inode(os.fstat(file.fileno()))
                parent.sync()
                value["state"] = "active"
                self._touch(value)
                self._check(value)
                return self._status(value)

    def _allocation_inode(self, value: Json, info: os.stat_result):
        # An interrupted allocation has acknowledged no bytes. Only a private,
        # empty, unlinked regular staging file may be adopted; never user data.
        if (_reparse(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != 0
                or (hasattr(os, "getuid") and info.st_uid != os.getuid())):
            _fail("transfer_changed", "Interrupted staging allocation was replaced")
        value["inode"] = _inode(info)

    def _recover_allocation(self, value: Json, parent: _Directory):
        if value["state"] != "allocating":
            return
        self._check(value)
        name = Path(value["temporary"]).name
        info = parent.info(name)
        if info is None:
            with parent.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL) as file:
                os.fsync(file.fileno())
                info = os.fstat(file.fileno())
            parent.sync()
        self._allocation_inode(value, info)
        value["state"] = "active"
        self._touch(value)

    def _staging(self, value: Json, parent: _Directory):
        file = parent.open(Path(value["temporary"]).name, os.O_RDWR)
        info = os.fstat(file.fileno())
        if info.st_nlink != 1 or _inode(info) != value["inode"]:
            file.close()
            _fail("transfer_changed", "Staging file changed")
        if info.st_size < value["offset"]:
            file.close()
            _fail("transfer_corrupt", "Acknowledged transfer bytes are missing")
        if info.st_size > value["offset"]:
            file.truncate(value["offset"])
            file.flush()
            os.fsync(file.fileno())
        return file

    def _recover_commit(self, value: Json, parent: _Directory):
        if value["state"] != "committing":
            return
        target, temporary = Path(value["path"]).name, Path(value["temporary"]).name
        info = parent.info(target)
        if info is not None and not _reparse(info) and _inode(info) == value["inode"]:
            with parent.open(target, os.O_RDONLY) as file:
                if _hash(file, lambda: self._check(value)) != value["sha256"]:
                    _fail("transfer_changed", "Committed destination changed")
            stage = parent.info(temporary)
            if stage is not None:
                if _reparse(stage) or _inode(stage) != value["inode"]:
                    _fail("transfer_changed", "Staging file changed")
                parent.unlink(temporary)
            parent.sync()
            value["state"] = "completed"
            self._touch(value)
        elif parent.info(temporary) is None:
            _fail("transfer_changed", "Committed destination changed")

    def upload_status(self, session: str, transfer_id: str) -> Json:
        with self._locked(transfer_id):
            value = self._load(session, transfer_id, "upload", cancel=False)
            with self._parent(value) as parent:
                self._recover_allocation(value, parent)
                self._recover_commit(value, parent)
                if value["state"] in ("active", "committing"):
                    with self._staging(value, parent):
                        pass
            return self._status(value)

    def upload_write(self, session: str, transfer_id: str, offset: int, data_base64: str) -> Json:
        with self._locked(transfer_id):
            value = self._load(session, transfer_id, "upload")
            if value["state"] != "active" or type(offset) is not int or offset != value["offset"]:
                _fail("transfer_offset", "Offset or transfer state mismatch; query durable status")
            if not isinstance(data_base64, str) or len(data_base64) > 4 * ((CHUNK_SIZE + 2) // 3):
                _fail("transfer_chunk", "Chunk exceeds limit")
            try:
                data = base64.b64decode(data_base64, validate=True)
            except (ValueError, TypeError):
                _fail("transfer_chunk", "Invalid base64 chunk")
            if not data or len(data) > CHUNK_SIZE or offset + len(data) > value["size"]:
                _fail("transfer_chunk", "Invalid chunk size")
            with self.permission_lock:
                with self._parent(value) as parent, self._staging(value, parent) as file:
                    self._check(value)
                    file.seek(offset)
                    file.write(data)
                    file.flush()
                    os.fsync(file.fileno())
                self._check(value)
                value["offset"] += len(data)
                self._touch(value)
            return self._status(value)

    def upload_commit(self, session: str, transfer_id: str) -> Json:
        with self._locked(transfer_id):
            value = self._load(session, transfer_id, "upload")
            with self._parent(value) as parent:
                self._recover_commit(value, parent)
                if value["state"] == "completed":
                    return self._status(value)
                if value["state"] not in ("active", "committing") or value["offset"] != value["size"]:
                    _fail("transfer_incomplete", "Upload is not complete")
                with self._staging(value, parent) as file:
                    if _hash(file, lambda: self._check(value)) != value["sha256"]:
                        _fail("transfer_checksum", "SHA256 mismatch")
                    os.fsync(file.fileno())
                with self.permission_lock:
                    self._check(value)
                    value["state"] = "committing"
                    self._touch(value)
                    self._check(value)
                    parent.publish(Path(value["temporary"]).name, Path(value["path"]).name, value["overwrite"], value["inode"])
                    value["state"] = "completed"
                    self._touch(value)
                return self._status(value)

    def _cancel(self, session: str, identity: str, kind: str) -> Json:
        # Verify caller/revision before signalling the running worker.
        value = self._load(session, identity, kind, cancel=False)
        entry = self._entry(identity)
        if value["state"] not in _TERMINAL:
            entry.cancel.set()
        with self._locked(identity, io=False):
            value = self._load(session, identity, kind, cancel=False)
            if value["state"] not in _TERMINAL:
                if kind == "upload":
                    with self._parent(value) as parent:
                        # Do not turn an already committed upload into cancellation.
                        # Recovery hashes are allowed despite this cancel signal.
                        entry.cancel.clear()
                        self._recover_commit(value, parent)
                if value["state"] not in _TERMINAL:
                    self._discard(value, "cancelled")
            return self._status(value)

    def upload_cancel(self, session: str, transfer_id: str) -> Json:
        return self._cancel(session, transfer_id, "upload")

    def download_begin(self, session: str, path: str, request_key: str | None = None,
                       *, permission_approved: bool = False, expected_revision: int | None = None) -> Json:
        identity = self._identity(session, "download", request_key)
        with self.permission_lock:
            self._begin_permission(session, identity, "download", permission_approved)
            revision = self.revision() if expected_revision is None else expected_revision
            if revision != self.revision():
                _fail("approval_invalidated", "Transfer permission revision changed")
            target = self.authorize(session, path, False).resolve()
        self.reap()
        with self._locked(identity, create=True):
            if (self.directory / (identity + ".json")).exists():
                value = self._load(session, identity, "download")
                if value["path"] != str(target):
                    _fail("request_conflict", "Transfer retry key was used with a different path")
                if value["state"] != "preparing":
                    return self._status(value)
            else:
                with self.permission_lock, _Directory(target.parent) as parent, parent.open(target.name, os.O_RDONLY) as file:
                    self._new_permission(permission_approved)
                    if revision != self.revision():
                        _fail("approval_invalidated", "Transfer permission revision changed")
                    before = os.fstat(file.fileno())
                    value = dict(transfer_id=identity, session=session, revision=revision, kind="download", path=str(target),
                                 size=before.st_size, sha256="", offset=0, state="preparing", fingerprint=_fingerprint(before),
                                 parent=parent.identity, permission_approved=permission_approved,
                                 auto_grant=_auto_grant.get(), created_at=self.clock())
                    with self.lock:
                        self._quota(0)
                        self._touch(value)
            with self._parent(value) as parent, parent.open(target.name, os.O_RDONLY) as file:
                if _fingerprint(os.fstat(file.fileno())) != value["fingerprint"]:
                    _fail("transfer_changed", "Download source changed")
                value["sha256"] = _hash(file, lambda: self._check(value))
            value.update(etag='"' + value["sha256"] + '"', state="active")
            self._check(value)
            self._touch(value)
            return self._status(value)

    def download_status(self, session: str, transfer_id: str) -> Json:
        with self._locked(transfer_id, io=False):
            value = self._load(session, transfer_id, "download", cancel=False)
            with self._parent(value) as parent, parent.open(Path(value["path"]).name, os.O_RDONLY) as file:
                if _fingerprint(os.fstat(file.fileno())) != value["fingerprint"]:
                    _fail("transfer_changed", "Download source changed")
            return self._status(value)

    def download_read(self, session: str, transfer_id: str, offset: int, length: int, etag: str) -> Json:
        with self._locked(transfer_id):
            value = self._load(session, transfer_id, "download")
            if value["state"] != "active" or etag != value["etag"]:
                _fail("transfer_changed", "Download identity mismatch")
            if type(offset) is not int or type(length) is not int or offset < 0 or offset > value["size"] or not 0 < length <= CHUNK_SIZE:
                _fail("transfer_range", "Invalid download range")
            with self.permission_lock:
                self._check(value)
                with self._parent(value) as parent, parent.open(Path(value["path"]).name, os.O_RDONLY) as file:
                    if _fingerprint(os.fstat(file.fileno())) != value["fingerprint"]:
                        _fail("transfer_changed", "Download source changed")
                    file.seek(offset)
                    data = file.read(min(length, value["size"] - offset))
                    if _fingerprint(os.fstat(file.fileno())) != value["fingerprint"] or len(data) != min(length, value["size"] - offset):
                        _fail("transfer_changed", "Download source changed")
                self._check(value)
                self._touch(value)
            return {"transfer_id": transfer_id, "offset": offset, "data_base64": base64.b64encode(data).decode("ascii"),
                    "size": value["size"], "etag": value["etag"]}

    def download_cancel(self, session: str, transfer_id: str) -> Json:
        return self._cancel(session, transfer_id, "download")
