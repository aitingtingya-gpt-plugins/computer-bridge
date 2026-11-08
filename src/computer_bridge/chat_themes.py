"""Local terminal color preferences and reusable semantic palettes."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from prompt_toolkit.styles import (
    BaseStyle,
    Style,
    merge_styles,
    style_from_pygments_cls,
)
from pygments.styles import get_style_by_name  # type: ignore[import-untyped]

from .common import save

names = {"dark": "深色", "light": "浅色", "contrast": "高对比"}


def preference_path(config: Path) -> Path:
    return config.with_name(config.stem + "-tui.json")


def load_theme(config: Path) -> str:
    path = preference_path(config)
    if not path.exists():
        return "dark"
    name = json.loads(path.read_text(encoding="utf-8")).get("theme", "dark")
    return str(name) if name in names else "dark"


def save_theme(config: Path, name: str) -> None:
    if name not in names:
        raise ValueError("未知主题")
    save(preference_path(config), {"theme": name})


@lru_cache(maxsize=3)
def theme_style(name: str) -> BaseStyle:
    palettes = {
        "dark": ("native", "#191c24", "#e3e7ef", "#929caf", "#88b7ff", "#f2bd77", "#c7a8ef", "#83c6b7", "#272d3b", "#344d74", "#526077"),
        "light": ("friendly", "#fafbfe", "#273142", "#657185", "#1a549b", "#92510c", "#70439d", "#22695e", "#edf0f7", "#cbdcf6", "#b3bfce"),
        "contrast": ("monokai", "#000000", "#ffffff", "#c5c5c5", "#56dfff", "#ffe36c", "#eda6ff", "#8dffb2", "#161616", "#234963", "#aaaaaa"),
    }
    syntax, background, foreground, muted, assistant, user, heading, accent, panel, selection, border = palettes[name]
    return merge_styles([style_from_pygments_cls(get_style_by_name(syntax)), Style.from_dict({
        "": f"bg:{background} {foreground}",
        "text-area": f"bg:{background} {foreground}",
        "sender.user": f"{user} bold", "sender.assistant": f"{assistant} bold",
        "metadata": muted, "hint": muted,
        "header": f"bg:{panel} {foreground} bold", "status": accent,
        "latency.good": "#2fa66d", "latency.warning": "#c99a28",
        "latency.poor": "#e45b58", "latency.offline": muted,
        "frame.label": f"{accent} bold", "frame.border": border,
        "completion-menu.completion": f"bg:{panel} {foreground}",
        "completion-menu.completion.current": f"bg:{selection} {foreground} bold",
        "completion-menu.meta.completion": f"bg:{panel} {muted}",
        "completion-menu.meta.completion.current": f"bg:{selection} {foreground}",
        "approval.heading": f"{heading} bold", "approval.button": f"bg:{panel} {foreground}",
        "approval.selected": f"bg:{selection} {foreground} bold",
        "text-selection": f"bg:{selection} {foreground}",
        "dialog": f"bg:{panel} {foreground}", "dialog.body": f"bg:{panel} {foreground}",
        "dialog.body text-area": f"bg:{panel} {foreground}",
        "dialog frame.label": f"{accent} bold", "dialog frame.border": border,
        "button": f"bg:{panel} {foreground}", "button.focused": f"bg:{selection} {foreground} bold",
        "chat-choice": f"bg:{panel} {foreground}", "chat-choice.selected": f"bg:{selection} {foreground} bold",
        "chat-choice.time": muted,
        "md.heading": f"{heading} bold", "md.strong": f"{user} bold", "md.quote": muted,
        "md.code": user, "md.math": assistant, "md.math_hint": muted,
        "md.link": f"{accent} underline",
    })])
