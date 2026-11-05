"""Markdown presentation and a TeXicode adapter; original messages stay unchanged."""

from __future__ import annotations

import asyncio
import json
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from markdown_it import MarkdownIt
from markdown_it.rules_inline import StateInline
from markdown_it.token import Token
from mdit_py_plugins.amsmath import amsmath_plugin
from mdit_py_plugins.texmath import texmath_plugin
from prompt_toolkit.formatted_text import PygmentsTokens, to_formatted_text
from prompt_toolkit.layout.screen import Char
from pygments import lex  # type: ignore[import-untyped]
from pygments.lexers import TextLexer, get_lexer_by_name  # type: ignore[import-untyped]
from pygments.util import ClassNotFound  # type: ignore[import-untyped]
from texicode import arts, node_data, symbols_art  # type: ignore[import-untyped]
from texicode.lexer import lexer  # type: ignore[import-untyped]
from texicode.parser import parse  # type: ignore[import-untyped]
from texicode.renderer import render  # type: ignore[import-untyped]

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
    return sum(Char(c).width for c in text)


@lru_cache(maxsize=1024)
def formula(tex: str) -> tuple[str | None, str]:
    """Never accept TeXicode's '?' substitution as a successful formula."""
    tokens = lexer(tex, False)
    for kind, name in tokens:
        if kind == "cmnd" and not (
            (kind, name) in node_data.type_dict
            or name in symbols_art.symbols
            or name in arts.multi_line_leaf_commands
        ):
            return None, "终端不支持 \\" + name
        if kind in {"env_bgin", "env_end"} and name not in {
            "matrix",
            "pmatrix",
            "bmatrix",
            "Bmatrix",
            "vmatrix",
            "Vmatrix",
            "smallmatrix",
            "align",
            "align*",
            "aligned",
            "alignedat",
            "gather",
            "gathered",
            "cases",
            "array",
            "equation",
            "equation*",
            "split",
        }:
            return None, "终端不支持环境 " + name
    try:
        arts.font = arts.font_normal
        sketch = render(parse(tokens, False), False)
        return "\n".join("".join(row) for row in sketch), ""
    except (ValueError, IndexError, KeyError, TypeError) as error:
        return None, str(error)


def parser() -> MarkdownIt:
    md = (
        MarkdownIt("commonmark", {"html": False, "breaks": True})
        .enable(["table", "strikethrough"])
        .use(texmath_plugin, delimiters="dollars")
        .use(texmath_plugin, delimiters="brackets")
        .use(amsmath_plugin)
    )

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
    return parser().parse(text)


def has_math(text: str) -> bool:
    return any(
        token.type.startswith("math")
        or token.type == "amsmath"
        or any(child.type.startswith("math") for child in token.children or [])
        for token in parse_message(text)
    )


def render_body(text: str, identifier: str, columns: int) -> Body:
    rows: list[Row] = []
    sources: list[int] = []
    formulas: list[str] = []
    offsets = [0]
    for line in text.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    source = 0
    nesting = 0
    quote = 0
    heading = False
    ordered: list[int | None] = []
    bullet = ""
    table: list[list[str]] | None = None
    cells: list[str] = []

    def append(row: Row, position: int | None = None) -> None:
        rows.append(row)
        point = source if position is None else position
        sources.append(max(sources[-1] if sources else 0, point))

    def math_rows(tex: str, inline: bool) -> list[Row]:
        formulas.append(tex)
        try:
            result, error = formula(tex)
        except ValueError as exc:
            result, error = None, str(exc)
        if result is None or any(
            width(line) > max(1, columns - 2) for line in result.split("\n")
        ):
            return [
                text_row(tex, "class:md.code"),
                text_row(
                    (error or "公式超出终端宽度") + f" · /math {identifier} 完整查看",
                    "class:md.math_hint",
                ),
            ]
        rendered = [text_row(line, "class:md.math") for line in result.split("\n")]
        if not inline:
            rendered.append(
                text_row(f"  /math {identifier} 完整查看", "class:md.math_hint")
            )
        return rendered

    def inline_rows(children: list[Token]) -> list[Row]:
        result: list[Row] = [[]]
        styles: list[str] = []
        links: list[str] = []

        def put(value: str, style: str = "") -> None:
            parts = value.split("\n")
            for i, part in enumerate(parts):
                if i:
                    result.append([])
                result[-1].append((" ".join([*styles, style]), part, None))

        for child in children:
            kind = child.type
            if kind in {"strong_open", "em_open", "s_open"}:
                styles.append(
                    {"strong_open": "bold", "em_open": "italic", "s_open": "strike"}[
                        kind
                    ]
                )
            elif kind in {"strong_close", "em_close", "s_close"}:
                styles.pop()
            elif kind == "code_inline":
                put(child.content, "class:md.code")
            elif kind in {"softbreak", "hardbreak"}:
                result.append([])
            elif kind.startswith("math"):
                rendered = math_rows(child.content, True)
                if len(rendered) == 1:
                    result[-1].extend(rendered[0])
                else:
                    if result[-1]:
                        result.append([])
                    result[-1:] = rendered + [[]]
            elif kind == "image":
                put(
                    "[图片：" + child.content + "] " + str(child.attrGet("src") or ""),
                    "class:md.link",
                )
            elif kind == "link_open":
                styles.append("class:md.link")
                links.append(str(child.attrGet("href") or ""))
            elif kind == "link_close":
                styles.pop()
                put(" (" + links.pop() + ")", "class:md.link")
            elif kind in {"text", "html_inline"}:
                put(child.content)
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
        elif kind == "tr_open":
            cells = []
        elif kind == "tr_close" and table is not None:
            table.append(cells)
        elif kind == "table_close" and table is not None:
            count = max(map(len, table), default=1)
            available = max(count * 3, columns - 3 * count - 1)
            widths = [
                min(
                    max(width(row[i]) for row in table if i < len(row)),
                    max(3, available // count),
                )
                for i in range(count)
            ]
            for row_index, table_row in enumerate(table):
                # Cell wrapping uses character widths, including Chinese and emoji.
                split = []
                for i, cell in enumerate(table_row):
                    lines = [""]
                    used = 0
                    for char in cell:
                        if used + width(char) > widths[i] and lines[-1]:
                            lines.append("")
                            used = 0
                        lines[-1] += char
                        used += width(char)
                    split.append(lines)
                for line_index in range(max(map(len, split), default=1)):
                    cell_values = [
                        parts[line_index] if line_index < len(parts) else ""
                        for parts in split
                    ]
                    append(
                        text_row(
                            "│ "
                            + " │ ".join(
                                value + " " * (widths[i] - width(value))
                                for i, value in enumerate(cell_values)
                            )
                            + " │",
                            "bold" if row_index == 0 else "",
                        )
                    )
            table = None
        elif kind == "heading_open":
            heading = True
        elif kind == "heading_close":
            heading = False
            append(text_row(""))
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
            nesting += 1
        elif kind in {"bullet_list_close", "ordered_list_close"}:
            ordered.pop()
            nesting -= 1
        elif kind == "list_item_open":
            bullet = ("  " * max(0, nesting - 1)) + (
                f"{ordered[-1]}. " if ordered[-1] is not None else "• "
            )
            if ordered[-1] is not None:
                ordered[-1] += 1
        elif kind == "inline":
            formatted_rows = inline_rows(token.children or [])
            if table is not None:
                cells.append(
                    " ".join("".join(part[1] for part in row) for row in formatted_rows)
                )
                continue
            for i, inline_row in enumerate(formatted_rows):
                prefix = ("│ " * quote) + (bullet if i == 0 else " " * len(bullet))
                styled: Row = [
                    ("class:md.heading " + s if heading else s, t, a)
                    for s, t, a in inline_row
                ]
                prefix_row: Row = [("", prefix, None)] if prefix else []
                original_lines = token.content.splitlines(keepends=True)
                position = source + sum(
                    len(line)
                    for line in original_lines[: min(i, len(original_lines) - 1)]
                )
                append(prefix_row + styled, position)
            bullet = ""
        elif kind in {"fence", "code_block"}:
            language = token.info.strip().split()[0] if token.info.strip() else ""
            append(text_row("── " + (language or "代码"), "class:md.code"))
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
            code_line = source + 1
            for fragment in highlighted:
                style, value = fragment[:2]
                for i, part in enumerate(value.split("\n")):
                    if i:
                        append(code_row, code_line)
                        code_row = []
                        code_line += 1
                    code_row.append((style, part, None))
            if code_row:
                append(code_row, code_line)
        elif kind.startswith("math") or kind == "amsmath":
            for math_row in math_rows(token.content, False):
                append(math_row)
        elif kind == "hr":
            append(text_row("─" * min(columns, 40), "class:hint"))
        elif kind == "paragraph_close" and not token.hidden:
            append(text_row(""))
    while rows and not any(part[1] for part in rows[-1]):
        rows.pop()
        sources.pop()
    return Body(rows, sources, tuple(formulas))


class MarkdownWorker:
    """One background worker per TUI; drawing never parses or typesets messages."""

    def __init__(self) -> None:
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="bridge-markdown"
        )
        self.tasks: dict[tuple[str, int], asyncio.Task[None]] = {}

    async def body(self, text: str, identifier: str, columns: int) -> Body:
        return await asyncio.get_running_loop().run_in_executor(
            self.executor, render_body, text, identifier, columns
        )

    def close(self) -> None:
        for task in self.tasks.values():
            task.cancel()
        self.executor.shutdown(wait=True, cancel_futures=True)


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
