"""MathJax presentation trees adapted to TeXicode's terminal canvases.

The parser, macro expansion and equation numbering belong to MathJax.  This
module translates presentation structures to the upstream concatenation,
stacking, fraction, root, delimiter and grid primitives without patching them.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal, cast

from texicode import arts, renderer  # type: ignore[import-untyped]

from .chat_cells import display_width, graphemes
from .chat_math import MathResult

Node = dict[str, Any]
Canvas = tuple[list[list[str]], int]
Fragment = tuple[str, str, None]


@dataclass(frozen=True, slots=True)
class LayoutResult(MathResult):
    rows: tuple[tuple[Fragment, ...], ...] = ()


class _Unsupported(Exception):
    pass


class _Invalid(Exception):
    pass


class Cell(str):
    """One display column; wide glyphs own empty continuation columns."""

    style: str

    def __new__(cls, value: str, style: str = "") -> Cell:
        result = str.__new__(cls, value)
        result.style = style
        return result

    def __add__(self, other: str) -> Cell:
        return Cell(str(self) + other, self.style)


def _attr(node: Node) -> dict[str, Any]:
    return {**node.get("inherited", {}), **node.get("attributes", {})}


def _children(node: Node) -> list[Node]:
    return cast(list[Node], node.get("childNodes", []))


def _plain(node: Node) -> str:
    if node["kind"] == "text":
        return str(node["text"])
    return "".join(_plain(child) for child in _children(node))


def _empty() -> Canvas:
    return [[]], 0


def _concat(parts: list[Canvas]) -> Canvas:
    return renderer.util_concat(parts)  # type: ignore[no-any-return]


def _pile(top: Canvas, center: Canvas, bottom: Canvas, align: str = "center") -> Canvas:
    return renderer.util_vert_pile(top[0], center[0], center[1], bottom[0], align)  # type: ignore[no-any-return]


def _font_char(character: str, variant: str) -> str:
    """Unicode math alphabets; styling preserves glyphs without Unicode variants."""
    if variant in {"normal", "italic"}:
        return character
    names = {
        "bold": "BOLD",
        "bold-italic": "BOLD ITALIC",
        "double-struck": "DOUBLE-STRUCK",
        "script": "SCRIPT",
        "bold-script": "BOLD SCRIPT",
        "fraktur": "FRAKTUR",
        "bold-fraktur": "BOLD FRAKTUR",
        "sans-serif": "SANS-SERIF",
        "bold-sans-serif": "SANS-SERIF BOLD",
        "sans-serif-italic": "SANS-SERIF ITALIC",
        "sans-serif-bold-italic": "SANS-SERIF BOLD ITALIC",
        "monospace": "MONOSPACE",
    }
    if variant not in names:
        raise _Unsupported("终端暂不支持数学字体 " + variant)
    prefix = names[variant]
    suffix = ""
    if character.isascii() and character.isalpha():
        suffix = ("CAPITAL " if character.isupper() else "SMALL ") + character.upper()
    elif character.isascii() and character.isdigit():
        suffix = "DIGIT " + unicodedata.name(character).removeprefix("DIGIT ")
    else:
        name = unicodedata.name(character, "")
        if name.startswith("GREEK "):
            suffix = name.removeprefix("GREEK ").replace(" LETTER", "")
        elif character in "∇∂":
            suffix = {"∇": "NABLA", "∂": "PARTIAL DIFFERENTIAL"}[character]
    if suffix:
        try:
            return unicodedata.lookup("MATHEMATICAL " + prefix + " " + suffix)
        except KeyError:
            # Unicode's mathematical alphabets have historical Letterlike holes.
            holes = {
                "SCRIPT CAPITAL B": "ℬ",
                "SCRIPT CAPITAL E": "ℰ",
                "SCRIPT CAPITAL F": "ℱ",
                "SCRIPT CAPITAL H": "ℋ",
                "SCRIPT CAPITAL I": "ℐ",
                "SCRIPT CAPITAL L": "ℒ",
                "SCRIPT CAPITAL M": "ℳ",
                "SCRIPT CAPITAL R": "ℛ",
                "SCRIPT SMALL E": "ℯ",
                "SCRIPT SMALL G": "ℊ",
                "SCRIPT SMALL O": "ℴ",
                "FRAKTUR CAPITAL C": "ℭ",
                "FRAKTUR CAPITAL H": "ℌ",
                "FRAKTUR CAPITAL I": "ℑ",
                "FRAKTUR CAPITAL R": "ℜ",
                "FRAKTUR CAPITAL Z": "ℨ",
                "DOUBLE-STRUCK CAPITAL C": "ℂ",
                "DOUBLE-STRUCK CAPITAL H": "ℍ",
                "DOUBLE-STRUCK CAPITAL N": "ℕ",
                "DOUBLE-STRUCK CAPITAL P": "ℙ",
                "DOUBLE-STRUCK CAPITAL Q": "ℚ",
                "DOUBLE-STRUCK CAPITAL R": "ℝ",
                "DOUBLE-STRUCK CAPITAL Z": "ℤ",
            }
            return holes.get(prefix + " " + suffix, character)
    return character


def _text(value: str, variant: str = "normal", style: str = "") -> Canvas:
    variant = {
        "-tex-calligraphic": "script",
        "-tex-bold-calligraphic": "bold-script",
        "-tex-mathit": "italic",
        "-tex-oldstyle": "normal",
        "-tex-bold-oldstyle": "bold",
        "-tex-variant": "normal",
    }.get(variant, variant)
    if "bold" in variant:
        style += " bold"
    if "italic" in variant:
        style += " italic"
    row: list[str] = []
    for _, cluster, _ in graphemes(value):
        glyph = "".join(_font_char(character, variant) for character in cluster)
        size = display_width(glyph)
        if size == 0:
            if row:
                at = len(row) - 1
                while at and not row[at]:
                    at -= 1
                row[at] = Cell(str(row[at]) + glyph, getattr(row[at], "style", style))
            else:
                raise _Unsupported("公式包含没有基底的组合字形")
        else:
            row.extend([Cell(glyph, style.strip()), *[Cell("")] * (size - 1)])
    return [row], 0


def _space(size: int) -> Canvas:
    return [[" "] * max(0, size)], 0


def _color_style(attrs: dict[str, Any]) -> str:
    if "mathcolor" not in attrs:
        return ""
    color = str(attrs["mathcolor"])
    if not re.fullmatch(
        r"#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?|(?:black|white|red|blue|green|yellow|cyan|magenta|gray|orange|purple)",
        color,
    ):
        raise _Unsupported("终端不能准确表示数学颜色 " + color)
    return "fg:" + color


def _style(attrs: dict[str, Any]) -> str:
    variant = str(attrs.get("mathvariant", "normal"))
    return " ".join(
        part
        for part in [
            "bold" if "bold" in variant else "",
            "italic" if "italic" in variant or variant == "-tex-mathit" else "",
            _color_style(attrs),
        ]
        if part
    )


def _decorate(canvas: Canvas, attrs: dict[str, Any]) -> Canvas:
    style = _style(attrs)
    return [
        [
            Cell(str(cell), (getattr(cell, "style", "") + " " + style).strip())
            for cell in row
        ]
        for row in canvas[0]
    ], canvas[1]


def _length(value: Any, default: float = 0) -> float:
    if value is None:
        return default
    text = str(value)
    match = re.fullmatch(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+))(em|ex|pt|px|mu|%)?", text)
    if not match:
        raise _Unsupported("终端暂不支持数学间距 " + text)
    amount = float(match[1])
    return (
        amount
        * {
            None: 1,
            "em": 2,
            "ex": 1,
            "pt": 2 / 12,
            "px": 1 / 8,
            "mu": 2 / 18,
            "%": 0.02,
        }[match[2]]
    )


_LARGE = {
    "∑": "sum",
    "∏": "prod",
    "∫": "int",
    "∬": "iint",
    "∭": "iiint",
    "∮": "oint",
    "∯": "oiint",
    "∰": "oiiint",
    "⋃": "cup",
    "⋂": "cap",
}
_ACCENT = {
    "^": "\u0302",
    "ˆ": "\u0302",
    "~": "\u0303",
    "˜": "\u0303",
    "¯": "\u0304",
    "ˉ": "\u0304",
    "‾": "\u0305",
    "_": "\u0332",
    "→": "\u20d7",
    "˙": "\u0307",
    ".": "\u0307",
    "¨": "\u0308",
    "ˊ": "\u0301",
    "´": "\u0301",
    "`": "\u0300",
    "ˋ": "\u0300",
    "˘": "\u0306",
    "ˇ": "\u030c",
    "˚": "\u030a",
}


def _delimiter(value: str, height: int, horizon: int) -> Canvas:
    if not value:
        return _empty()
    if height == 1:
        return _text(value)
    value = {"∣": "|", "∥": "‖"}.get(value, value)
    if value in arts.delimiter["sgl"]:
        return renderer.util_delimiter(value, height, horizon)  # type: ignore[no-any-return]
    if value in {"⟨", "⟩", "〈", "〉"}:
        left = value in {"⟨", "〈"}
        middle = min(height - 1, max(0, horizon))
        width = max(middle, height - middle - 1) + 1
        rows = []
        for row in range(height):
            distance = abs(row - middle)
            column = distance if left else width - distance - 1
            glyph = (
                ("⟨" if left else "⟩")
                if row == middle
                else ("╱" if (row < middle) == left else "╲")
            )
            rows.append([" "] * column + [glyph] + [" "] * (width - column - 1))
        return rows, horizon
    if value in {"↑", "↓", "↕", "⇑", "⇓", "⇕"}:
        stem = "║" if value in {"⇑", "⇓", "⇕"} else "│"
        rows = [[stem] for _ in range(height)]
        if value in {"↑", "↕", "⇑", "⇕"}:
            rows[0] = ["⇑" if stem == "║" else "↑"]
        if value in {"↓", "↕", "⇓", "⇕"}:
            rows[-1] = ["⇓" if stem == "║" else "↓"]
        return rows, horizon
    raise _Unsupported("终端没有此伸缩定界符的字符表示：" + value)


def _shrink(canvas: Canvas, position: Literal[0, 1]) -> Canvas | None:
    sketch, _ = canvas
    if len(sketch) != 1:
        return None
    row: list[str] = []
    for cell in sketch[0]:
        if cell not in arts.unicode_scripts:
            return None
        small = arts.unicode_scripts[cell][position]
        if small == " " and cell != " ":
            return None
        row.append(Cell(small, getattr(cell, "style", "")))
    return [row], 0


def _scripts(
    base: Canvas, sub: Canvas | None, sup: Canvas | None, *, left: bool = False
) -> Canvas:
    low, high = sub or _empty(), sup or _empty()
    small_low = _shrink(low, 1) if sub else None
    small_high = _shrink(high, 0) if sup else None
    if len(base[0]) == 1 and not (sub and sup):
        compact = small_low if sub else small_high
        if compact is not None:
            return _concat([compact, base] if left else [base, compact])
    # Keep a baseline gap so both scripts remain strictly above/below the base.
    sky, ocean = base[1], len(base[0]) - base[1] - 1
    center = [[" "]] * (sky + 1 + ocean)
    script = _pile(high, (center, sky), low, "right" if left else "left")
    return _concat([script, base] if left else [base, script])


def _accent(base: Canvas, mark: str, under: bool, style: str = "") -> Canvas:
    sketch, horizon = base
    width = len(sketch[0])
    if width == 0:
        return _text(mark, style=style)
    if len(sketch) == 1 and width == 1 and sketch[0][0] and mark in _ACCENT:
        cell = sketch[0][0]
        return [
            [
                Cell(
                    str(cell) + _ACCENT[mark],
                    (getattr(cell, "style", "") + " " + style).strip(),
                )
            ]
        ], horizon
    if mark in {"¯", "ˉ", "‾", "_"}:
        line = "─" * width
    elif mark in {"→", "⟶", "←", "⟵", "↔", "⟷"}:
        right, left = mark in {"→", "⟶", "↔", "⟷"}, mark in {"←", "⟵", "↔", "⟷"}
        line = (
            ("←" if left else "─") + "─" * max(0, width - 2) + ("→" if right else "─")
            if width > 1
            else mark
        )
    elif mark in {"^", "ˆ"}:
        line = "ˆ" if width == 1 else "╱" + "‾" * (width - 2) + "╲"
    elif mark in {"~", "˜"}:
        line = "~" * width
    elif mark in {"⏞", "⏟"}:
        if width == 1:
            line = mark
        else:
            middle = (width - 1) // 2
            line = (
                ("╭" if mark == "⏞" else "╰")
                + "─" * (width - 2)
                + ("╮" if mark == "⏞" else "╯")
            )
            if width > 2:
                line = (
                    line[:middle] + ("┴" if mark == "⏞" else "┬") + line[middle + 1 :]
                )
    elif mark in _ACCENT:
        # Dot and acute-like accents annotate the complete base from a centered row.
        line = " " * ((width - 1) // 2) + mark + " " * (width // 2)
    else:
        raise _Unsupported("终端没有此跨字符重音的字符表示：" + mark)
    accent = _text(line, style=style)
    return _pile(_empty() if under else accent, base, accent if under else _empty())


def _fence(node: Node) -> Node | None:
    if node["kind"] == "mo":
        attrs = _attr(node)
        return node if attrs.get("stretchy") and attrs.get("fence") else None
    children = _children(node)
    if children and (
        node["kind"] in {"msub", "msup", "msubsup"}
        or node["kind"] in {"TeXAtom", "mrow", "mstyle"}
        and len(children) == 1
    ):
        return _fence(children[0])
    return None


def _stretched(
    node: Node, height: int, horizon: int, context: dict[str, Any]
) -> Canvas:
    children = _children(node)
    if node["kind"] == "mo":
        canvas = _delimiter(_plain(node), height, horizon)
        return _decorate(canvas, {**context, **_attr(node)})
    if node["kind"] in {"msub", "msup", "msubsup"}:
        base = _stretched(children[0], height, horizon, context)
        sub = (
            _node(children[1], context) if node["kind"] in {"msub", "msubsup"} else None
        )
        sup = (
            _node(children[2 if node["kind"] == "msubsup" else 1], context)
            if node["kind"] in {"msup", "msubsup"}
            else None
        )
        return _scripts(base, sub, sup)
    return _stretched(children[0], height, horizon, context)


def _row(nodes: list[Node], context: dict[str, Any]) -> Canvas:
    parts = [_node(child, context) for child in nodes]
    ordinary = [part for child, part in zip(nodes, parts) if _fence(child) is None]
    if ordinary:
        inside = _concat(ordinary)
        for index, child in enumerate(nodes):
            fence = _fence(child)
            if fence is not None:
                attrs = _attr(fence)
                height = max(len(inside[0]), _minimum_height(attrs))
                horizon = inside[1] + (height - len(inside[0])) // 2
                parts[index] = _stretched(child, height, horizon, context)
    return _concat(parts)


def _minimum_height(attrs: dict[str, Any]) -> int:
    size = attrs.get("minsize")
    if size is None:
        return 1
    em = _length(size) / 2
    # MathJax's four explicit TeX delimiter sizes map to TeXicode's odd heights.
    for expected, height in [(1.2, 1), (1.623, 3), (2.047, 5), (2.47, 7)]:
        if abs(em - expected) < 0.01:
            return height
    return max(1, 2 * math.ceil(em - 1) + 1)


def _values(value: Any, count: int, default: str) -> list[str]:
    values = str(value).split() if value is not None else [default]
    return (values + [values[-1]] * count)[:count]


def _table(node: Node, context: dict[str, Any]) -> Canvas:
    attrs = _attr(node)
    entries: list[list[Canvas]] = []
    alignments: list[list[str]] = []
    labels: list[Canvas | None] = []
    for row in _children(node):
        children = _children(row)
        labels.append(
            _node(children[0], context) if row["kind"] == "mlabeledtr" else None
        )
        if row["kind"] == "mlabeledtr":
            children = children[1:]
        rendered, aligns = [], []
        for cell in children:
            cell_attrs = _attr(cell)
            if (
                int(cell_attrs.get("columnspan", 1)) != 1
                or int(cell_attrs.get("rowspan", 1)) != 1
            ):
                raise _Unsupported("终端暂不支持合并行列的数学表格")
            rendered.append(_node(cell, context))
            aligns.append(str(cell_attrs.get("columnalign", "center"))[0])
        entries.append(rendered)
        alignments.append(aligns)
    if not entries:
        return _empty()
    columns = max(map(len, entries))
    widths = [
        max((len(row[index][0][0]) for row in entries if index < len(row)), default=0)
        for index in range(columns)
    ]
    spacing = [
        max(0, math.ceil(_length(value)))
        for value in _values(attrs.get("columnspacing"), columns - 1, "1em")
    ]
    vertical = _values(attrs.get("columnlines"), columns - 1, "none")
    horizontal = _values(attrs.get("rowlines"), len(entries) - 1, "none")
    rowspacing = _values(attrs.get("rowspacing"), len(entries) - 1, "0")
    result: Canvas | None = None
    for index, cells in enumerate(entries):
        sky = max((canvas[1] for canvas in cells), default=0)
        ocean = max((len(canvas[0]) - canvas[1] - 1 for canvas in cells), default=0)
        pieces: list[Canvas] = []
        for column in range(columns):
            cell_canvas = cells[column] if column < len(cells) else _empty()
            padded = renderer.util_pad_cell(
                cell_canvas,
                widths[column],
                alignments[index][column] if column < len(cells) else "c",
                sky,
                ocean,
            )
            if column:
                amount = spacing[column - 1]
                if vertical[column - 1] != "none":
                    glyph = "┆" if vertical[column - 1] == "dashed" else "│"
                    pieces.extend(
                        [
                            _space(amount // 2),
                            ([[glyph]] * (sky + 1 + ocean), sky),
                            _space(amount - amount // 2),
                        ]
                    )
                else:
                    pieces.append(_space(amount))
            pieces.append(padded)
        rendered_row = _concat(pieces)
        label = labels[index]
        if label is not None:
            rendered_row = _concat([rendered_row, _space(2), label])
        if result is None:
            result = rendered_row
        else:
            rule = horizontal[index - 1]
            gap = int(_length(rowspacing[index - 1]) >= 0.5)
            if rule != "none":
                width = max(len(result[0][0]), len(rendered_row[0][0]))
                line = list(("┄" if rule == "dashed" else "─") * width)
                cursor = 0
                for column in range(columns - 1):
                    cursor += widths[column]
                    if vertical[column] != "none":
                        line[cursor + spacing[column] // 2] = "┼"
                        cursor += 1
                    cursor += spacing[column]
                separator = _text("".join(line))
            else:
                separator = _text(" " if gap else "")
            if rule != "none" or gap:
                result = _pile(_empty(), result, separator)
            result = _pile(_empty(), result, rendered_row)
    assert result is not None
    return result[0], len(result[0]) // 2


def _enclosure(base: Canvas, notation: str) -> Canvas:
    shapes = set(notation.split())
    if "box" in shapes:
        shapes.remove("box")
        shapes.update({"top", "bottom", "left", "right"})
    if not shapes <= {"top", "bottom", "left", "right"}:
        raise _Unsupported("终端暂不支持此数学装饰：" + notation)
    canvas, horizon = base
    left, right = "left" in shapes, "right" in shapes
    rows = []
    for row in canvas:
        ruled = bool(row) and all(character in {"─", "┄", "┼"} for character in row)
        rows.append(
            (["├" if ruled else "│"] if left else [])
            + row
            + (["┤" if ruled else "│"] if right else [])
        )
    width = len(canvas[0])
    if "top" in shapes:
        rows.insert(
            0, (["┌"] if left else []) + ["─"] * width + (["┐"] if right else [])
        )
        horizon += 1
    if "bottom" in shapes:
        rows.append((["└"] if left else []) + ["─"] * width + (["┘"] if right else []))
    return rows, horizon


def _node(node: Node, context: dict[str, Any]) -> Canvas:
    canvas = _render(node, context)
    attrs = {**context, **_attr(node)}
    color = _color_style(attrs)
    if not color:
        return canvas
    # Drawn fraction rules, radical strokes and grid lines inherit color too;
    # child nodes that chose their own foreground keep that narrower scope.
    return [
        [
            Cell(str(cell), (getattr(cell, "style", "") + " " + color).strip())
            if "fg:" not in getattr(cell, "style", "")
            else cell
            for cell in row
        ]
        for row in canvas[0]
    ], canvas[1]


def _render(node: Node, context: dict[str, Any]) -> Canvas:
    kind, children = node["kind"], _children(node)
    attrs = {
        **{
            key: value
            for key, value in context.items()
            if key
            in {
                "mathvariant",
                "mathcolor",
                "mathbackground",
                "mathsize",
                "displaystyle",
                "scriptlevel",
            }
        },
        **_attr(node),
    }
    for name in ("mathsize", "mathbackground"):
        if name in node.get("attributes", {}) and attrs[name] not in {
            "normal",
            "100%",
            "transparent",
        }:
            raise _Unsupported("终端不能准确表示数学属性 " + name)
    if kind in {"math", "mrow", "TeXAtom", "mstyle", "mtd", "semantics"}:
        return _row(children, attrs)
    if kind in {"mi", "mn", "mo", "mtext", "ms", "text"}:
        text = _plain(node)
        if kind == "mo" and text in {"\u2061", "\u2062", "\u2063", "\u2064"}:
            # MathML names these operators explicitly: function application,
            # invisible multiplication, invisible separator and invisible plus.
            return _space(1 if text in {"\u2061", "\u2063"} else 0)
        if (
            kind == "mo"
            and attrs.get("fence")
            and attrs.get("stretchy")
            and "minsize" in attrs
        ):
            height = _minimum_height(attrs)
            return _decorate(_delimiter(text, height, height // 2), attrs)
        if kind == "mo" and attrs.get("largeop") and attrs.get("displaystyle"):
            art = _LARGE.get(text)
            if art in arts.multi_line_leaf_commands:
                sketch, horizon = arts.multi_line_leaf_commands[art]
                return _decorate(([row[:] for row in sketch], horizon), attrs)
        return _text(text, str(attrs.get("mathvariant", "normal")), _color_style(attrs))
    if kind == "mspace":
        width = max(0, math.ceil(_length(attrs.get("width"))))
        sky = max(0, math.ceil(_length(attrs.get("height")) / 2))
        ocean = max(0, math.ceil(_length(attrs.get("depth")) / 2))
        return [[" "] * width for _ in range(sky + 1 + ocean)], sky
    if kind == "mfrac":
        numerator, denominator = [_node(child, attrs) for child in children]
        thickness = attrs.get("linethickness")
        if thickness is not None and _length(thickness) == 0:
            return _pile(numerator, _empty(), denominator)
        width = max(len(numerator[0][0]), len(denominator[0][0]))
        numerator = renderer.util_pad_cell(
            numerator,
            width,
            str(attrs.get("numalign", "center"))[0],
            numerator[1],
            len(numerator[0]) - numerator[1] - 1,
        )
        denominator = renderer.util_pad_cell(
            denominator,
            width,
            str(attrs.get("denomalign", "center"))[0],
            denominator[1],
            len(denominator[0]) - denominator[1] - 1,
        )
        return renderer.render_fraction([numerator, denominator])  # type: ignore[no-any-return]
    if kind in {"msqrt", "mroot"}:
        radicand = (
            _row(children, attrs) if kind == "msqrt" else _node(children[0], attrs)
        )
        if kind == "msqrt":
            return renderer.render_square_root([radicand])  # type: ignore[no-any-return]
        degree = _node(children[1], attrs)
        root: Canvas = renderer.render_square_root([radicand])
        degree = _shrink(degree, 0) or degree
        # The degree's bottom line meets the radical's top line.  Padding it
        # below preserves the root's baseline without asking the old scalar
        # font/shrink code to split combined or wide index glyphs.
        sketch, _ = degree
        height = len(root[0])
        column = sketch + [[" "] * len(sketch[0]) for _ in range(height - 1)]
        return _concat([(column, len(sketch) - 1 + root[1]), root])
    if kind in {"msub", "msup", "msubsup"}:
        base = _node(children[0], attrs)
        sub = _node(children[1], attrs) if kind in {"msub", "msubsup"} else None
        sup = (
            _node(children[2 if kind == "msubsup" else 1], attrs)
            if kind in {"msup", "msubsup"}
            else None
        )
        return _scripts(base, sub, sup)
    if kind in {"mover", "munder", "munderover"}:
        base = _node(children[0], attrs)
        lower = children[1] if kind in {"munder", "munderover"} else None
        upper = (
            children[2 if kind == "munderover" else 1]
            if kind in {"mover", "munderover"}
            else None
        )
        if lower and attrs.get("accentunder"):
            base = _accent(base, _plain(lower), True, _style(_attr(lower)))
            lower = None
        if upper and attrs.get("accent"):
            base = _accent(base, _plain(upper), False, _style(_attr(upper)))
            upper = None
        return _pile(
            _node(upper, attrs) if upper else _empty(),
            base,
            _node(lower, attrs) if lower else _empty(),
        )
    if kind == "mmultiscripts":
        base = _node(children[0], attrs)
        before: list[tuple[Canvas, Canvas]] = []
        after: list[tuple[Canvas, Canvas]] = []
        target = after
        index = 1
        while index < len(children):
            if children[index]["kind"] == "mprescripts":
                target = before
                index += 1
            else:
                target.append(
                    (_node(children[index], attrs), _node(children[index + 1], attrs))
                )
                index += 2
        # Left and right pairs attach to the same original base, not to the
        # growing canvas that already includes the opposite side's scripts.
        sky, ocean = base[1], len(base[0]) - base[1] - 1
        center: Canvas = ([[" "]] * (sky + 1 + ocean), sky)
        left = [_pile(sup, center, sub, "right") for sub, sup in reversed(before)]
        right = [_pile(sup, center, sub, "left") for sub, sup in after]
        return _concat([*left, base, *right])
    if kind in {"none", "mprescripts", "annotation", "annotation-xml"}:
        return _empty()
    if kind == "mtable":
        return _table(node, attrs)
    if kind == "mphantom":
        canvas, horizon = _row(children, attrs)
        return [[" "] * len(row) for row in canvas], horizon
    if kind == "menclose":
        return _enclosure(_row(children, attrs), str(attrs.get("notation", "longdiv")))
    if kind == "merror":
        raise _Invalid("公式语法错误：" + _plain(node))
    raise _Unsupported("终端暂不支持数学结构 " + kind)


def layout(tree: Node) -> LayoutResult:
    """Return native styled rows only when the complete tree has a representation."""
    try:
        canvas, _ = _node(tree, {})
        rows: list[tuple[Fragment, ...]] = []
        for row in canvas:
            fragments: list[Fragment] = []
            for cell in row:
                if not cell:
                    continue
                style = ("class:md.math " + getattr(cell, "style", "")).strip()
                if fragments and fragments[-1][0] == style:
                    previous = fragments[-1]
                    fragments[-1] = style, previous[1] + cell, None
                else:
                    fragments.append((style, str(cell), None))
            rows.append(tuple(fragments))
        text = "\n".join("".join(fragment[1] for fragment in row) for row in rows)
        widths = [display_width("".join(row)) for row in canvas]
        if len(set(widths)) > 1:
            raise _Unsupported("公式的字形不能保持二维列宽")
        return LayoutResult(text, "", "native", tuple(rows))
    except _Unsupported as issue:
        return LayoutResult(None, str(issue), "unsupported")
    except _Invalid as issue:
        return LayoutResult(None, str(issue), "invalid")
