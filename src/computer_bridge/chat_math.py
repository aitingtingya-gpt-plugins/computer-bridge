"""Shared mathematical layout result; syntax is compiled by MathJax."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MathKind = Literal["native", "unsupported", "invalid"]


@dataclass(frozen=True, slots=True)
class MathResult:
    text: str | None
    reason: str
    kind: MathKind
