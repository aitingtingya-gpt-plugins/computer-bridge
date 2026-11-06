"""A private TeXicode compatibility instance for terminal mathematics.

TeXicode owns parsing and two-dimensional layout. This adapter fixes its
single-cell character operations and identifies constructs that its layout
cannot preserve. Original Markdown and the MathJax viewer are unaffected.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from functools import lru_cache
from types import FunctionType, SimpleNamespace
from typing import Any, Literal
from unicodedata import category

from prompt_toolkit.layout.screen import Char
from texicode import arts, node_data, symbols_art  # type: ignore[import-untyped]
from texicode.lexer import lexer  # type: ignore[import-untyped]

MathKind = Literal["native", "unsupported", "invalid"]


@dataclass(frozen=True, slots=True)
class MathResult:
    text: str | None
    reason: str
    kind: MathKind


_ACCENTS = {
    "acute": "\u0301",
    "bar": "\u0304",
    "breve": "\u0306",
    "check": "\u030c",
    "ddot": "\u0308",
    "dot": "\u0307",
    "grave": "\u0300",
    "hat": "\u0302",
    "mathring": "\u030a",
    "tilde": "\u0303",
    "vec": "\u20d7",
    "widehat": "\u0302",
    "widetilde": "\u0303",
}
_ENVIRONMENTS = frozenset(
    {
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
        "gather",
        "gathered",
        "cases",
        "array",
        "equation",
        "equation*",
        "split",
    }
)
_COMMANDS = frozenset(
    {name for kind, name in node_data.type_dict if kind == "cmnd"}
    | set(symbols_art.symbols)
    | set(arts.multi_line_leaf_commands)
) - {"limits", "pmod", "not"}
_SYMBOL_OVERRIDES = {"bmod": ["m", "o", "d"], "rhd": ["▷"], "iff": ["⟺", " "]}
_DELIMITER_COMMANDS = frozenset(
    {
        "{",
        "}",
        "|",
        "vert",
        "Vert",
        "lvert",
        "rvert",
        "lVert",
        "rVert",
        "langle",
        "rangle",
        "lbrace",
        "rbrace",
        "lbrack",
        "rbrack",
        "lfloor",
        "rfloor",
        "lceil",
        "rceil",
        "backslash",
        "uparrow",
        "downarrow",
        "updownarrow",
        "Uparrow",
        "Downarrow",
        "Updownarrow",
    }
)
_MISSING_ARGUMENT_PREFIXES = tuple(
    {
        f"Expected {node_data.type_info_dict[name][0][1]!r}, got cls_"
        for name in (
            "cmd_sqrt",
            "cmd_sbstk",
            "cmd_frac",
            "cmd_binom",
            "cmd_acnt",
            "cmd_font",
            "cmd_text",
            "big_dlim",
            "sup_scrpt",
            "sub_scrpt",
        )
    }
)


def capabilities() -> dict[str, tuple[str, ...]]:
    """Names are available subject to argument/layout checks in ``formula``."""
    return {
        "commands": tuple(sorted(_COMMANDS)),
        "environments": tuple(sorted(_ENVIRONMENTS)),
        "single_cell_accents": tuple(_ACCENTS),
        "unsupported_commands": ("limits", "not", "pmod"),
        "unsupported_environments": ("alignedat",),
    }


class _MathIssue(Exception):
    def __init__(self, kind: Literal["unsupported", "invalid"], reason: str):
        self.kind, self.reason = kind, reason
        super().__init__(reason)


def _columns(value: str) -> int:
    return sum(Char(char).width for char in value)


def _normalize(tex: str) -> str:
    """Remove TeX comments while preserving escaped percent and word boundaries."""
    result: list[str] = []
    index = 0
    control_word = False
    while index < len(tex):
        char = tex[index]
        if char == "\\":
            end = index + 1
            if end == len(tex):
                raise _MathIssue("invalid", "公式末尾的反斜杠缺少命令")
            if tex[end].isascii() and tex[end].isalpha():
                while end < len(tex) and tex[end].isascii() and tex[end].isalpha():
                    end += 1
                control_word = True
            else:
                end += 1
                control_word = False
            result.append(tex[index:end])
            index = end
        elif char == "%":
            if control_word:
                result.append(" ")
            while index < len(tex) and tex[index] not in "\r\n":
                index += 1
            if index < len(tex) and tex[index : index + 2] == "\r\n":
                index += 2
            elif index < len(tex):
                index += 1
            control_word = False
        else:
            if char in "\t\r\n":
                char = " "
            elif category(char) == "Cc":
                raise _MathIssue("invalid", f"公式包含控制字符 U+{ord(char):04X}")
            result.append(char)
            control_word = False
            index += 1
    return "".join(result)


def _structure(tokens: list[tuple[str | None, str]]) -> None:
    stack: list[tuple[str, str]] = []
    expecting_delimiter = False

    def close(kind: str, label: str, reason: str) -> None:
        if not stack or stack[-1] != (kind, label):
            raise _MathIssue("invalid", reason)
        stack.pop()

    for kind, value in tokens:
        if (kind, value) in {("meta", "start"), ("meta", "end"), ("symb", " ")}:
            continue
        if expecting_delimiter:
            if kind == "cmnd" and value not in _COMMANDS:
                raise _MathIssue("unsupported", "终端暂不支持定界符 " + chr(92) + value)
            if not (
                kind == "symb"
                and value in "()[]|./<>"
                or kind == "cmnd"
                and value in _DELIMITER_COMMANDS
            ):
                raise _MathIssue("invalid", "左右定界符缺少括号参数")
            expecting_delimiter = False
            continue
        if kind == "env_bgin":
            stack.append(("environment", value))
        elif kind == "env_end":
            close("environment", value, "公式环境的开始与结束不匹配")
        elif kind == "symb" and value == "{":
            stack.append(("brace", "{"))
        elif kind == "symb" and value == "}":
            close("brace", "{", "公式花括号不匹配")
        elif kind == "cmnd" and value == "left":
            stack.append(("delimiter", "left"))
            expecting_delimiter = True
        elif kind == "cmnd" and value == "right":
            close("delimiter", "left", "\\right 缺少对应的 \\left")
            expecting_delimiter = True
        elif kind == "cmnd" and value in {"[", "("}:
            stack.append(("wrapper", value))
        elif kind == "cmnd" and value in {"]", ")"}:
            close("wrapper", {"]": "[", ")": "("}[value], "公式分隔符不匹配")
        elif kind == "symb" and value in {"$", "$$"}:
            marker = ("dollar", value)
            if stack and stack[-1] == marker:
                stack.pop()
            else:
                stack.append(marker)
    if expecting_delimiter:
        raise _MathIssue("invalid", "左右定界符缺少括号参数")
    if stack:
        raise _MathIssue("invalid", "公式的花括号、环境或定界符未闭合")


def _supported(tokens: list[tuple[str | None, str]]) -> None:
    for kind, value in tokens:
        if kind is None or any(_columns(char) > 1 for char in value):
            raise _MathIssue(
                "unsupported", "此公式包含终端二维排版暂不支持的 Unicode 字形"
            )
        if kind == "cmnd" and value not in _COMMANDS:
            raise _MathIssue("unsupported", "终端暂不支持 " + chr(92) + value)
        if kind in {"env_bgin", "env_end"} and value not in _ENVIRONMENTS:
            raise _MathIssue("unsupported", "终端暂不支持环境 " + value)


def _private_functions(name: str) -> dict[str, Any]:
    """Clone function globals, so fixes never monkey-patch an installed module."""
    original = importlib.import_module(name)
    namespace = dict(vars(original))
    for name, value in vars(original).items():
        if isinstance(value, FunctionType) and value.__module__ == original.__name__:
            cloned = FunctionType(
                value.__code__, namespace, name, value.__defaults__, value.__closure__
            )
            cloned.__kwdefaults__ = value.__kwdefaults__
            namespace[name] = cloned
    return namespace


def _private_parser() -> Any:
    namespace = _private_functions("texicode.parser")
    original_can_add = namespace["can_add"]

    def can_add(parent: str, node: str) -> bool:
        # The original parser already handles nesting; its root-only environment
        # admission check blocks otherwise valid bracketed/grouped matrices.
        if node == "cmd_bgin" and parent in {"opn_dlim", "opn_brac"}:
            return True
        return bool(original_can_add(parent, node))

    namespace["can_add"] = can_add
    return SimpleNamespace(**namespace)


def _private_renderer() -> Any:
    namespace = _private_functions("texicode.renderer")
    private_arts = SimpleNamespace(**vars(arts))
    private_arts.font = {**arts.font_normal, "operatorname": arts.alphabets["normal"]}
    namespace["arts"] = private_arts
    namespace["symbols_art"] = SimpleNamespace(
        **{**vars(symbols_art), "symbols": {**symbols_art.symbols, **_SYMBOL_OVERRIDES}}
    )
    revert_one = namespace["util_revert_font"]
    delimiter = namespace["util_delimiter"]

    def revert(cell: str) -> str:
        return "".join(revert_one(char) for char in cell)

    def font(name: str, children: Any) -> Any:
        sketch, horizon = children[0]
        normal, mapping = arts.alphabets["normal"], private_arts.font[name]
        return [
            [
                "".join(
                    mapping[normal.index(char)] if char in normal else char
                    for char in revert(cell)
                )
                for cell in row
            ]
            for row in sketch
        ], horizon

    def accent(token: tuple[str, str], children: Any) -> Any:
        sketch, horizon = children[0]
        if len(sketch) != 1 or len(sketch[0]) != 1 or _columns(sketch[0][0]) != 1:
            raise _MathIssue(
                "unsupported", "终端暂不支持跨字符或多行的 " + chr(92) + token[1]
            )
        return [[sketch[0][0] + _ACCENTS[token[1]]]], horizon

    def delimit(glyph: Any, height: int, horizon: int) -> Any:
        value = "".join(glyph) if isinstance(glyph, list) else glyph
        if value == ".":
            return [[]], 0
        if _columns(value) != 1:
            raise _MathIssue("unsupported", "终端暂不支持此定界符")
        if height == 1:
            return [[value]], 0
        if value not in arts.delimiter["sgl"]:
            raise _MathIssue("unsupported", "终端暂不支持此多行大定界符")
        return delimiter(value, height, horizon)

    namespace.update(
        util_revert_font=revert,
        util_font=font,
        render_accents=accent,
        util_delimiter=delimit,
    )
    return SimpleNamespace(**namespace)


_RENDERER = _private_renderer()
_PARSER = _private_parser()


def _nodes_valid(nodes: Any) -> None:
    for node_type, token, children, scripts in nodes:
        positions = [
            nodes[script][0] in {"sup_scrpt", "top_scrpt"} for script in scripts
        ]
        if len(positions) != len(set(positions)):
            raise _MathIssue("invalid", "同一位置不能重复指定上标或下标")
        if node_type == "cmd_bgin" and token[1] == "array":
            if not children or nodes[children[0]][0] != "opn_brac":
                raise _MathIssue("invalid", "array 缺少列格式参数")
            spec = "".join(nodes[index][1][1] for index in nodes[children[0]][2])
            if not spec:
                raise _MathIssue("invalid", "array 的列格式参数不能为空")
            if any(char not in "clr" for char in spec):
                raise _MathIssue("unsupported", "终端 array 列格式仅支持 c、l、r")
            columns = 1
            for child in children[1:]:
                if nodes[child][0] == "row_sep":
                    columns = 1
                elif nodes[child][1] == ("symb", "&"):
                    columns += 1
                    if columns > len(spec):
                        raise _MathIssue("invalid", "array 内容超出声明的列数")


@lru_cache(maxsize=1024)
def formula(tex: str) -> MathResult:
    """Render trusted capabilities; unsupported/invalid input keeps its original source."""
    try:
        normalized = _normalize(tex)
        if not normalized.strip():
            return MathResult("", "", "native")
        tokens = lexer(normalized, False)
        _structure(tokens)
        _supported(tokens)
        try:
            nodes = _PARSER.parse(tokens, False)
        except ValueError as error:
            # can_add emits this exact shape when a required argument slot
            # meets a closing node. Other parser failures may be valid TeX that
            # lies outside this renderer's grammar, so remain unsupported.
            if str(error).startswith(_MISSING_ARGUMENT_PREFIXES):
                raise _MathIssue("invalid", "公式命令或上下标缺少必需参数") from error
            raise
        _nodes_valid(nodes)
        sketch = _RENDERER.render(nodes, False)
        # Every upstream canvas cell denotes one terminal column. Combining
        # marks remain in their base cell; wide or multi-base cells cannot fit.
        sizes = [_columns("".join(row)) for row in sketch]
        if len(set(sizes)) > 1 or any(
            _columns("".join(row)) != len(row) for row in sketch
        ):
            raise _MathIssue("unsupported", "此公式超出终端二维字符布局的能力")
        return MathResult("\n".join("".join(row) for row in sketch), "", "native")
    except _MathIssue as issue:
        return MathResult(None, issue.reason, issue.kind)
    except (ValueError, IndexError, KeyError, TypeError, RecursionError):
        return MathResult(None, "终端排版器无法可靠处理此表达式", "unsupported")
