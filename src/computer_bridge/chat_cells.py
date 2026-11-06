"""Unicode display cells shared by mathematical layout and styled chat rows."""
from __future__ import annotations

import re
from collections.abc import Iterator
from functools import lru_cache

from prompt_toolkit.layout.screen import Char
from wcwidth import iter_graphemes, wcswidth


@lru_cache(maxsize=4096)
def cell_width(cluster: str) -> int:
    """Measure an entire user-visible character, including combining marks."""
    measured = wcswidth(cluster)
    if measured >= 0:
        return measured
    # Match prompt_toolkit's visible notation for literal control characters.
    return sum(Char(character).width for character in cluster)


def display_width(text: str) -> int:
    measured = wcswidth(text)
    return measured if measured >= 0 else sum(size for _, _, size in graphemes(text))


def graphemes(text: str) -> Iterator[tuple[int, str, int]]:
    """Yield source-codepoint offset, intact grapheme and terminal cell width."""
    offset = 0
    for cluster in iter_graphemes(text):
        yield offset, cluster, cell_width(cluster)
        offset += len(cluster)


def split_lines(text: str) -> list[str]:
    """Preserve blank lines while removing actual newline controls from rows."""
    return [line for _, line in source_lines(text)]


def source_lines(text: str) -> Iterator[tuple[int, str]]:
    """Yield each literal source line and its original codepoint offset."""
    start = 0
    for match in re.finditer(r"\r\n|\r|\n", text):
        yield start, text[start:match.start()]
        start = match.end()
    yield start, text[start:]
