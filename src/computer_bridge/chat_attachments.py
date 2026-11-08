"""File input and explicit attachment markers for terminal drafts."""

from __future__ import annotations

import os
import re
import shlex
from collections.abc import Sequence
from dataclasses import dataclass
from io import StringIO
from pathlib import Path
from typing import BinaryIO
from urllib.parse import unquote, urlsplit
from urllib.request import url2pathname

from .common import Error

_MARKER = re.compile(r"［附件 d\d+：[^］\n]*］")


def _path_start(text: str) -> bool:
    value = text[1:] if text.startswith(('"', "'")) else text
    return value.startswith(("/", "~/", "./", "../", "file://")) or os.name == "nt" and (
        bool(re.match(r"[A-Za-z]:[\\/]", value)) or value.startswith("\\\\")
    )


def _path(value: str) -> Path:
    if value.startswith("file://"):
        uri = urlsplit(value)
        value = url2pathname(uri.path)
        if uri.netloc and uri.netloc != "localhost":
            value = "//" + unquote(uri.netloc) + value
    return Path(value).expanduser()


def attachment_prefix(text: str) -> tuple[list[Path], str]:
    """Consume leading native file paths; the remaining Markdown is verbatim.

    Terminal.app uses shell quotes/escapes, Windows terminals quote spaced
    paths, and some drag sources insert file:// URLs. A bare slash word such
    as /help stays available to the command dispatcher.
    """
    paths: list[Path] = []
    offset = 0
    while True:
        start = offset + len(text[offset:]) - len(text[offset:].lstrip())
        if not _path_start(text[start:]):
            break
        source = StringIO(text[start:])
        lexer = shlex.shlex(source, posix=os.name != "nt")
        lexer.whitespace_split = True
        lexer.commenters = ""
        try:
            value = str(lexer.get_token())
        except ValueError as exc:
            raise Error("chat_attachment_path", "附件路径的引号没有闭合。") from exc
        if os.name == "nt" and value[:1] in {"'", '"'}:
            value = value[1:-1]
        path = _path(value)
        # Unknown single slash words are commands, not missing attachments.
        if not path.exists() and re.fullmatch(r"/[^/\\.\s]+", value):
            break
        if not path.is_file():
            raise Error("chat_attachment", "附件文件不存在或不是普通文件：" + str(path))
        path = path.resolve()
        if path not in paths:
            paths.append(path)
        offset = start + source.tell()
    return paths, text[offset:] if paths else text


def pasted_paths(text: str, prefix: str) -> list[Path]:
    """Only an inserted, complete path list can register file attachments."""
    if not _path_start(text.lstrip()):
        return []
    # A literal path pasted into an existing Markdown code span stays literal.
    fence = ""
    for line in prefix.splitlines():
        match = re.match(r"^\s*(`{3,}|~{3,})(.*)$", line)
        if match:
            token, tail = match.groups()
            if not fence:
                fence = token
            elif token.startswith(fence) and not tail.strip():
                fence = ""
    inline = 0
    for match in re.finditer(r"(?<!\\)`+", prefix.rsplit("\n\n", 1)[-1]):
        count = len(match[0])
        if not inline:
            inline = count
        elif count == inline:
            inline = 0
    if fence or inline:
        return []
    try:
        paths, remainder = attachment_prefix(text)
    except Error:
        return []
    return paths if not remainder.strip() else []


@dataclass(eq=False)
class DroppedAttachment:
    name: str
    stream: BinaryIO


AttachmentSource = Path | DroppedAttachment


class AttachmentDraft:
    """A marker points to a registered file, never to an address in the message."""

    def __init__(self) -> None:
        self.sequence = 0
        self.files: dict[str, AttachmentSource] = {}

    def insert(self, paths: Sequence[AttachmentSource]) -> str:
        markers = []
        for path in paths:
            self.sequence += 1
            name = " ".join(path.name.replace("］", "]").splitlines())
            marker = f"［附件 d{self.sequence}：{name}］"
            self.files[marker] = path
            markers.append(marker)
        return "".join(markers)

    def parse(self, text: str) -> tuple[list[AttachmentSource], str]:
        paths: list[AttachmentSource] = []
        def replace(match: re.Match[str]) -> str:
            path = self.files.get(match[0])
            if path is None:
                return match[0]
            if path not in paths:
                paths.append(path)
            return ""
        body = _MARKER.sub(replace, text)
        return paths, (body if body.strip() else "") if paths else text

    def marker_at(self, text: str, position: int) -> tuple[int, int] | None:
        for match in _MARKER.finditer(text):
            if match[0] in self.files and match.start() <= position < match.end():
                return match.span()
        return None
