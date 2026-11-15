"""Markdown presentation and a TeXicode adapter; original messages stay unchanged."""

from __future__ import annotations

import asyncio
import atexit
import heapq
import itertools
import json
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import FunctionType
from typing import Any
from unicodedata import category, name

from markdown_it import MarkdownIt
from markdown_it.rules_inline import StateInline
from markdown_it.rules_inline.emphasis import tokenize as tokenize_emphasis
from markdown_it.token import Token
from mdit_py_plugins.amsmath import amsmath_block, amsmath_plugin
from mdit_py_plugins.texmath import texmath_plugin
from prompt_toolkit.formatted_text import PygmentsTokens, to_formatted_text
from pygments import lex  # type: ignore[import-untyped]
from pygments.lexers import TextLexer, get_lexer_by_name  # type: ignore[import-untyped]
from pygments.util import ClassNotFound  # type: ignore[import-untyped]

from .chat_cells import display_width, graphemes, split_lines
from .chat_math import MathResult
from .chat_math_compile import MathCompiler
from .chat_math_layout import layout as layout_math

_standalone_compiler = MathCompiler()
atexit.register(_standalone_compiler.close)

Fragment = tuple[str, str, tuple[str, str] | None]
Row = list[Fragment]


@dataclass
class Body:
    rows: list[Row]
    sources: list[int]
    formulas: tuple[str, ...]


def text_row(text: str, style: str = "") -> Row:
    return [(style, text, None)]


def width(text: str) -> int:
    return display_width(text)


def formula(tex: str) -> tuple[str | None, str]:
    document = _standalone_compiler.compile("$$\n" + tex + "\n$$", "formula")
    entry = document["formulas"][0]
    result = layout_math(entry["tree"]) if not entry.get("error") else MathResult(None, entry["error"], "invalid")
    return result.text, result.reason


def cjk_emphasis(state: StateInline, silent: bool) -> bool:
    start, first = state.pos, len(state.delimiters)
    accepted = tokenize_emphasis(state, silent)
    if accepted and not silent and state.src[start] == "*":
        before = state.src[start - 1] if start else " "
        after = state.src[state.pos] if state.pos < state.posMax else " "
        cjk_names = ("CJK ", "HIRAGANA ", "KATAKANA ", "HANGUL ", "BOPOMOFO ")
        can_open = category(after).startswith(("P", "S")) and name(before, "").startswith(cjk_names)
        can_close = category(before).startswith(("P", "S")) and name(after, "").startswith(cjk_names)
        for delimiter in state.delimiters[first:]:
            delimiter.open |= can_open
            delimiter.close |= can_close
    return accepted


def parser() -> MarkdownIt:
    md = (
        MarkdownIt("commonmark", {"html": False, "breaks": True})
        .enable(["table", "strikethrough"])
        .use(texmath_plugin, delimiters="dollars")
        .use(texmath_plugin, delimiters="brackets")
        .use(amsmath_plugin)
    )
    # Match the shared compiler's named environments, including custom ones.
    # The dependency's original function and global environment list stay intact.
    namespace = {**amsmath_block.__globals__, "RE_OPEN": r"\\begin\{([A-Za-z][A-Za-z0-9]*)(\*?)\}"}
    environment_rule = FunctionType(amsmath_block.__code__, namespace)
    md.block.ruler.at("amsmath", environment_rule)
    md.inline.ruler.at("emphasis", cjk_emphasis)

    def unclosed(state: StateInline, silent: bool) -> bool:
        rest = state.src[state.pos :]
        for opener, closer in [(r"\[", r"\]"), (r"\(", r"\)"), ("$$", "$$")]:
            if rest.startswith(opener) and closer not in rest[len(opener) :]:
                if not silent:
                    token = state.push("math_unclosed", "", 0)
                    token.content = rest
                state.pos = len(state.src)
                return True
        return False

    md.inline.ruler.before("escape", "bridge_unclosed_math", unclosed)
    return md


@lru_cache(maxsize=256)
def parse_message(text: str) -> list[Token]:
    tokens = parser().parse(text)
    for token in tokens:
        if token.type == "fence" and token.info.split()[:1] == ["math"]:
            token.type = "math_fence"
    return tokens


def has_math(text: str) -> bool:
    return any(
        token.type.startswith("math")
        or token.type == "amsmath"
        or any(child.type.startswith("math") for child in token.children or [])
        for token in parse_message(text)
    )


def render_body(text: str, identifier: str, columns: int, document: dict[str, Any] | None = None) -> Body:
    if document is None:
        try:
            document = _standalone_compiler.compile(text, identifier) if has_math(text) else {"formulas": []}
        except (OSError, ValueError, RuntimeError) as error:
            document = {"formulas": [], "error": str(error)}
    rows: list[Row] = []
    sources: list[int] = []
    formulas: list[str] = []
    raw_lines = text.splitlines(keepends=True)
    offsets = [0]
    for line in raw_lines:
        offsets.append(offsets[-1] + len(line))
    source = quote = 0
    heading = False
    ordered: list[int | None] = []
    items: list[tuple[str, bool]] = []
    table: list[list[Token]] | None = None
    cells: list[Token] = []
    table_range = (0, 0)
    table_positions: list[int] = []
    row_position = 0

    def append(row: Row, position: int) -> None:
        rows.append(row)
        sources.append(max(sources[-1] if sources else 0, position))

    def prefix() -> str:
        leading = "│ " * quote
        if items:
            leading += " " * sum(width(marker) for marker, _ in items[:-1])
            marker, pending = items[-1]
            leading += marker if pending else " " * width(marker)
        return leading

    def content(row: Row, position: int) -> None:
        leading = prefix()
        append(([("class:md.quote" if quote else "", leading, None)] if leading else []) + row, position)
        if items:
            items[-1] = items[-1][0], False

    def point(token: Token, local: int) -> int:
        if not token.map:
            return source
        before = token.content[:local]
        line_index = token.map[0] + before.count("\n")
        if line_index >= len(raw_lines):
            return len(text)
        column = len(before.rsplit("\n", 1)[-1])
        parts = token.content.splitlines()
        part = parts[min(before.count("\n"), len(parts) - 1)] if parts else ""
        inset = raw_lines[line_index].find(part)
        return offsets[line_index] + max(0, inset) + column

    def math_rows(
        tex: str, inline: bool, available: int, position: int, record: bool
    ) -> list[tuple[Row, int]]:
        if record:
            formulas.append(tex)
        entries = [entry for entry in document.get("formulas", []) if entry["tex"].strip() == tex.strip()]
        if entries:
            entry = min(entries, key=lambda item: abs(item["start"] - position))
            result = (MathResult(None, entry["error"], "invalid") if entry.get("error")
                      else layout_math(entry["tree"]))
        else:
            result = MathResult(None, str(document.get("error") or "此公式未取得可靠的数学编译结果"), "unsupported")
        if result.text is None or any(
            width(line) > available for line in result.text.split("\n")
        ):
            reason = result.reason or "公式超出当前可用宽度"
            original = [
                (text_row(line, "class:md.code"), position)
                for line in split_lines(tex.expandtabs(8))
            ]
            return [
                *original,
                (
                    text_row(
                        reason + f" · /math {identifier} 完整查看", "class:md.math_hint"
                    ),
                    position,
                ),
            ]
        styled = getattr(result, "rows", ())
        rendered = ([(list(row), position) for row in styled] if styled else [
            (text_row(line, "class:md.math"), position)
            for line in result.text.split("\n")
        ])
        if not inline:
            rendered.append(
                (
                    text_row(f"/math {identifier} 完整查看", "class:md.math_hint"),
                    position,
                )
            )
        return rendered

    def inline_rows(
        token: Token, available: int, record: bool = True
    ) -> list[tuple[Row, int]]:
        available = max(1, available)
        result: list[tuple[Row, int]] = [([], point(token, 0))]
        styles: list[str] = []
        links: list[str] = []
        cursor = 0

        def put(value: str, style: str = "", position: int | None = None) -> None:
            location = point(token, cursor) if position is None else position
            for i, line in enumerate(split_lines(value.expandtabs(8))):
                if i:
                    result.append(([], location))
                for offset, cluster, size in graphemes(line):
                    row, _ = result[-1]
                    if row and width("".join(t for _, t, _ in row)) + size > available:
                        result.append(([], location + offset))
                        row = result[-1][0]
                    style_value = " ".join([*styles, style])
                    if row and row[-1][0] == style_value:
                        old = row[-1]
                        row[-1] = (old[0], old[1] + cluster, None)
                    else:
                        row.append((style_value, cluster, None))

        for child in token.children or []:
            kind = child.type
            located = token.content.find(child.content, cursor) if child.content else -1
            if located >= 0:
                cursor = located
            location = point(token, cursor)
            if kind in {"strong_open", "em_open", "s_open"}:
                styles.append(
                    {"strong_open": "class:md.strong bold", "em_open": "italic", "s_open": "strike"}[
                        kind
                    ]
                )
            elif kind in {"strong_close", "em_close", "s_close"}:
                styles.pop()
            elif kind == "code_inline":
                put(child.content, "class:md.code", location)
            elif kind in {"softbreak", "hardbreak"}:
                newline = token.content.find("\n", cursor)
                cursor = newline + 1 if newline >= 0 else cursor
                result.append(([], point(token, cursor)))
            elif kind.startswith("math"):
                if kind == "math_unclosed":
                    rendered = [
                        (text_row(line, "class:md.code"), location)
                        for line in split_lines(child.content.expandtabs(8))
                    ]
                    rendered.append(
                        (
                            text_row(
                                f"公式未闭合 · /math {identifier} 完整查看",
                                "class:md.math_hint",
                            ),
                            location,
                        )
                    )
                    if record:
                        formulas.append(child.content)
                else:
                    rendered = math_rows(
                        child.content, True, available, location, record
                    )
                if len(rendered) == 1:
                    row = result[-1][0]
                    formula_width = width("".join(t for _, t, _ in rendered[0][0]))
                    if (
                        row
                        and width("".join(t for _, t, _ in row)) + formula_width
                        > available
                    ):
                        result.append(([], location))
                    result[-1][0].extend(rendered[0][0])
                else:
                    if not result[-1][0]:
                        result.pop()
                    result.extend(rendered)
                    result.append(([], location + len(child.content)))
            elif kind == "image":
                put(
                    "[图片：" + child.content + "] " + str(child.attrGet("src") or ""),
                    "class:md.link",
                    location,
                )
            elif kind == "link_open":
                styles.append("class:md.link")
                links.append(str(child.attrGet("href") or ""))
            elif kind == "link_close":
                styles.pop()
                put(" (" + links.pop() + ")", "class:md.link", location)
            elif kind in {"text", "html_inline"}:
                put(child.content, position=location)
            if child.content and located >= 0:
                cursor = located + len(child.content)
        while len(result) > 1 and not result[-1][0]:
            result.pop()
        return result

    def fit(row: Row, available: int) -> list[Row]:
        # Mathematical rows already fit as a whole. Only source text and hints wrap here.
        if any(
            "class:md.math" in style and "math_hint" not in style for style, _, _ in row
        ):
            return [row]
        result: list[Row] = [[]]
        for style, value, action in row:
            for _, cluster, size in graphemes(value):
                current = result[-1]
                if current and width("".join(t for _, t, _ in current)) + size > max(
                    1, available
                ):
                    result.append([])
                    current = result[-1]
                if current and current[-1][0] == style and current[-1][2] == action:
                    old = current[-1]
                    current[-1] = (style, old[1] + cluster, action)
                else:
                    current.append((style, cluster, action))
        return result

    for token in parse_message(text):
        if token.map:
            source = offsets[min(token.map[0], len(offsets) - 1)]
        kind = token.type
        if (kind.startswith("math") or kind == "amsmath") and not token.map:
            located = text.find(token.content, source)
            if located >= 0:
                source = located
        if kind == "table_open":
            table = []
            table_positions = []
            table_range = tuple(token.map or [0, len(raw_lines)])  # type: ignore[assignment]
        elif kind == "tr_open":
            cells = []
            row_position = source
        elif kind == "tr_close" and table is not None:
            table.append(cells)
            table_positions.append(row_position)
        elif kind == "table_close" and table is not None:
            count = max(map(len, table), default=1)
            available = columns - width(prefix()) - 3 * count - 1
            if available < 3 * count:
                for i in range(*table_range):
                    content(
                        text_row(raw_lines[i].rstrip("\r\n"), "class:md.code"),
                        offsets[i],
                    )
                content(
                    text_row(
                        f"表格超出当前可用宽度 · /math {identifier} 完整查看",
                        "class:md.math_hint",
                    ),
                    source,
                )
            else:
                desired = [
                    max(
                        3,
                        max(
                            (
                                width("".join(t for _, t, _ in row))
                                for entry in table
                                if i < len(entry)
                                for row, _ in inline_rows(
                                    entry[i], max(1, available), False
                                )
                            ),
                            default=3,
                        ),
                    )
                    for i in range(count)
                ]
                widths = [3] * count
                while sum(widths) < available:
                    growing = [i for i in range(count) if widths[i] < desired[i]]
                    if not growing:
                        break
                    for i in growing:
                        if sum(widths) >= available:
                            break
                        widths[i] += 1
                for index, entry in enumerate(table):
                    laid_out = []
                    for i, cell in enumerate(entry):
                        laid_out.append(
                            [
                                part
                                for row, _ in inline_rows(cell, widths[i])
                                for part in fit(row, widths[i])
                            ]
                        )
                    for screen_line in range(max(map(len, laid_out), default=1)):
                        combined: Row = [("", "│ ", None)]
                        for i in range(count):
                            cell_row = (
                                laid_out[i][screen_line]
                                if i < len(laid_out) and screen_line < len(laid_out[i])
                                else []
                            )
                            used = width("".join(t for _, t, _ in cell_row))
                            combined.extend(
                                (("bold " if index == 0 else "") + style, value, action)
                                for style, value, action in cell_row
                            )
                            combined.append(
                                (
                                    "",
                                    " " * (widths[i] - used)
                                    + " │"
                                    + (" " if i < count - 1 else ""),
                                    None,
                                )
                            )
                        content(combined, table_positions[index])
            table = None
        elif kind == "heading_open":
            heading = True
        elif kind == "heading_close":
            heading = False
            append(text_row(""), source)
        elif kind == "blockquote_open":
            quote += 1
        elif kind == "blockquote_close":
            quote -= 1
        elif kind in {"bullet_list_open", "ordered_list_open"}:
            ordered.append(
                int(token.attrGet("start") or 1)
                if kind == "ordered_list_open"
                else None
            )
        elif kind in {"bullet_list_close", "ordered_list_close"}:
            ordered.pop()
        elif kind == "list_item_open":
            marker = f"{ordered[-1]}. " if ordered[-1] is not None else "• "
            items.append((marker, True))
            if ordered[-1] is not None:
                ordered[-1] += 1
        elif kind == "list_item_close":
            items.pop()
        elif kind == "inline":
            if table is not None:
                cells.append(token)
                continue
            available = max(1, columns - width(prefix()))
            for row, position in inline_rows(token, available):
                styled = [
                    (("class:md.heading " if heading else "class:md.quote " if quote else "") + style, value, action)
                    for style, value, action in row
                ]
                content(styled, position)
        elif kind in {"fence", "code_block"}:
            language = token.info.strip().split()[0] if token.info.strip() else ""
            content(text_row("── " + (language or "代码"), "class:md.code"), source)
            try:
                highlight = (
                    get_lexer_by_name(language, stripnl=False, ensurenl=False)
                    if language
                    else TextLexer(stripnl=False, ensurenl=False)
                )
            except ClassNotFound:
                highlight = TextLexer(stripnl=False, ensurenl=False)
            highlighted = to_formatted_text(
                PygmentsTokens(list(lex(token.content, highlight)))
            )
            code_row: Row = []
            line_number = (token.map or [0])[0] + int(kind == "fence")
            for fragment in highlighted:
                style, value = fragment[:2]
                for i, part in enumerate(value.split("\n")):
                    if i:
                        content(code_row, offsets[min(line_number, len(offsets) - 1)])
                        code_row = []
                        line_number += 1
                    if part:
                        column = width("".join(t for _, t, _ in code_row))
                        for char in part:
                            expanded = " " * (8 - column % 8) if char == "\t" else char
                            code_row.append((style, expanded, None))
                            column += width(expanded)
            if code_row:
                content(code_row, offsets[min(line_number, len(offsets) - 1)])
        elif kind.startswith("math") or kind == "amsmath":
            available = max(1, columns - width(prefix()))
            if kind == "math_unclosed":
                rendered = [
                    (text_row(line, "class:md.code"), source)
                    for line in split_lines(token.content.expandtabs(8))
                ]
                rendered.append(
                    (
                        text_row(
                            f"公式未闭合 · /math {identifier} 完整查看",
                            "class:md.math_hint",
                        ),
                        source,
                    )
                )
            else:
                rendered = math_rows(token.content, False, available, source, True)
            for row, position in rendered:
                content(row, position)
        elif kind == "hr":
            content(
                text_row(
                    "─" * min(max(1, columns - width(prefix())), 40), "class:hint"
                ),
                source,
            )
        elif kind == "paragraph_close" and not token.hidden:
            append(text_row(""), source)
    while rows and not any(part[1] for part in rows[-1]):
        rows.pop()
        sources.pop()
    return Body(rows, sources, tuple(formulas))


class MarkdownWorker:
    """One background worker per TUI; drawing never parses or typesets messages."""

    def __init__(self, settings: dict[str, Any] | None = None) -> None:
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="bridge-markdown"
        )
        self.tasks: dict[tuple[int, str, str, int], asyncio.Task[None]] = {}
        self.compiler = MathCompiler(settings)
        self.queue: list[tuple[int, int, str, str, int, asyncio.Future[Body]]] = []
        self.sequence = itertools.count()
        self.runner: asyncio.Task[None] | None = None

    def _body(self, text: str, identifier: str, columns: int) -> Body:
        try:
            document = self.compiler.compile(text, identifier) if has_math(text) else {"formulas": []}
        except (OSError, ValueError, RuntimeError) as error:
            document = {"formulas": [], "error": str(error)}
        return render_body(text, identifier, columns, document)

    async def body(self, text: str, identifier: str, columns: int, *, priority: int = 0) -> Body:
        future: asyncio.Future[Body] = asyncio.get_running_loop().create_future()
        heapq.heappush(self.queue, (priority, next(self.sequence), text, identifier, columns, future))
        if self.runner is None or self.runner.done():
            self.runner = asyncio.create_task(self._drain())
        return await future

    async def _drain(self) -> None:
        while self.queue:
            _, _, text, identifier, columns, future = heapq.heappop(self.queue)
            if future.cancelled():
                continue
            try:
                body = await asyncio.get_running_loop().run_in_executor(
                    self.executor, self._body, text, identifier, columns
                )
            except Exception as error:
                if not future.done():
                    future.set_exception(error)
            else:
                if not future.done():
                    future.set_result(body)

    def close(self) -> None:
        for task in self.tasks.values():
            task.cancel()
        if self.runner:
            self.runner.cancel()
        for *_, future in self.queue:
            future.cancel()
        self.queue.clear()
        self.executor.shutdown(wait=True, cancel_futures=True)
        self.compiler.close()


async def preview(
    settings: dict[str, Any], message: dict[str, Any], directory: Path
) -> Path:
    """Self-contained local HTML: SVG paths need no fonts, network or login."""
    import shutil

    node = settings.get("native_node") or shutil.which("node")
    if not node:
        raise ValueError("本机 Node 环境缺失，请重新运行安装程序。")
    process = await asyncio.create_subprocess_exec(
        node,
        str(Path(__file__).parent / "native/chat-math.mjs"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        output, error = await process.communicate(
            json.dumps(
                {
                    "text": message["text"],
                    "id": message["id"],
                    "title": "科研公式完整查看",
                },
                ensure_ascii=False,
            ).encode()
        )
    except asyncio.CancelledError:
        process.terminate()
        await process.wait()
        raise
    if process.returncode:
        raise ValueError("公式排版失败：" + error.decode(errors="replace"))
    path = directory / (str(message["id"]) + ".html")
    path.write_bytes(output)
    await asyncio.to_thread(webbrowser.open, path.as_uri())
    return path
