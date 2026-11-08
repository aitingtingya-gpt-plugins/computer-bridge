"""One modal surface for local terminal information and input."""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from typing import Any, TypeVar

from prompt_toolkit.application import Application
from prompt_toolkit.application.current import get_app
from prompt_toolkit.key_binding import KeyBindings, merge_key_bindings
from prompt_toolkit.key_binding.key_processor import KeyPressEvent
from prompt_toolkit.layout import Float, FloatContainer, HSplit
from prompt_toolkit.layout.controls import BufferControl, FormattedTextControl
from prompt_toolkit.layout.dimension import Dimension
from prompt_toolkit.widgets import Button, Dialog, Label, TextArea

from .chat_input import InputNavigator

T = TypeVar('T')


def bind_keys(control: BufferControl | FormattedTextControl, keys: KeyBindings) -> None:
    """Keep widget defaults (including button Space/Enter) when adding keys."""
    existing = control.get_key_bindings()
    control.key_bindings = merge_key_bindings([existing, keys] if existing else [keys])


def text_navigation(field: TextArea, *, previous: Callable[[], None] | None = None,
                    following: Callable[[], None] | None = None) -> None:
    """Move through displayed rows; optional exits apply only at their edges."""
    navigator = InputNavigator(field.buffer, lambda: (
        field.window.render_info.window_width if field.window.render_info
        else max(1, min(96, get_app().output.get_size().columns) - 8)))
    keys = KeyBindings()

    def move(direction: int, event: KeyPressEvent) -> None:
        # A plain arrow ends selection but must not also leave the editor.
        selecting = field.buffer.selection_state is not None
        field.buffer.exit_selection()
        navigator.layout()
        source = max(position for position in navigator.positions if position <= field.buffer.cursor_position)
        row = navigator.positions[source][0]
        leave = (previous if direction < 0 and row == 0 else
                 following if direction > 0 and row == len(navigator.rows)-1 else None)
        if leave and not selecting:
            leave()
        else:
            navigator.move(direction, event.arg)

    keys.add('up')(lambda event: move(-1, event))
    keys.add('down')(lambda event: move(1, event))
    keys.add('s-up')(lambda event: navigator.select(-1, event.arg))
    keys.add('s-down')(lambda event: navigator.select(1, event.arg))
    for name, direction in (('pageup', -1), ('pagedown', 1)):
        def page(event: KeyPressEvent, direction: int = direction) -> None:
            field.buffer.exit_selection()
            height = field.window.render_info.window_height if field.window.render_info else 4
            navigator.move(direction, max(1, height - 1) * event.arg)
        keys.add(name)(page)
    bind_keys(field.control, keys)


def form_navigation(fields: Sequence[TextArea], buttons: Sequence[Button], *, advance: bool = False) -> None:
    """Arrows navigate fields without stealing horizontal editing or letters."""
    for index, field in enumerate(fields):
        before = fields[max(0, index - 1)]
        after = fields[index + 1] if index + 1 < len(fields) else buttons[0]
        previous = lambda target=before: get_app().layout.focus(target)
        following = lambda target=after: get_app().layout.focus(target)
        if field.buffer.multiline():
            text_navigation(field, previous=previous, following=following)
        else:
            keys = KeyBindings()
            keys.add('up')(lambda event, focus=previous: focus())
            keys.add('down')(lambda event, focus=following: focus())
            if advance:
                keys.add('enter')(lambda event, focus=following: focus())
            bind_keys(field.control, keys)
    for button in buttons:
        keys = KeyBindings()
        keys.add('up')(lambda event: get_app().layout.focus(fields[-1]))
        bind_keys(button.control, keys)


class ChatDialogs:
    def __init__(self, application: Application[None], layout: FloatContainer):
        self.application, self.layout = application, layout
        self.lock = asyncio.Lock()
        self.active: asyncio.Future[Any] | None = None
        self.key: str | None = None

    def dismiss(self, key: str) -> None:
        if self.key == key and self.active and not self.active.done():
            self.active.set_result(None)

    async def present(self, dialog: Dialog, focus: Any, result: asyncio.Future[T], *,
                      key: str | None = None, valid: Callable[[], bool] | None = None) -> T | None:
        async with self.lock:
            if valid and not valid():
                return None
            previous = self.application.layout.current_control
            floating = Float(content=dialog)
            self.active, self.key = result, key
            self.layout.floats.append(floating)
            self.application.layout.focus(focus)
            self.application.invalidate()
            try:
                return await result
            finally:
                self.layout.floats.remove(floating)
                self.active, self.key = None, None
                self.application.layout.focus(previous)
                self.application.invalidate()

    async def message(self, title: str, text: str, *, key: str | None = None,
                      valid: Callable[[], bool] | None = None) -> None:
        result: asyncio.Future[None] = asyncio.get_running_loop().create_future()

        def close() -> None:
            if not result.done():
                result.set_result(None)

        keys = KeyBindings()
        for name in ('escape', 'enter'):
            keys.add(name, eager=True)(lambda event: close())
        content = TextArea(text=text, read_only=True, scrollbar=True, wrap_lines=True,
            height=Dimension(min=3, preferred=min(16, text.count('\n') + 4), max=20))
        bind_keys(content.control, keys)
        text_navigation(content)
        button = Button('关闭', handler=close)
        bind_keys(button.control, keys)
        back = KeyBindings()
        back.add('up')(lambda event: self.application.layout.focus(content))
        bind_keys(button.control, back)
        hint = '正文 ↑↓ / PageUp/PageDown 阅读 · Tab/Shift+Tab 切换\nEnter / Esc 关闭提示'
        if key == 'login':
            hint += '（不取消浏览器登录）'
        dialog = Dialog(title=title, body=HSplit([content, Label(hint)]), buttons=[button],
                        width=96)
        await self.present(dialog, content, result, key=key, valid=valid)

    async def path(self, title: str, default: str) -> str | None:
        result: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        field = TextArea(text=default, multiline=False)

        def finish(value: str | None) -> None:
            if not result.done():
                result.set_result(value)

        keys = KeyBindings()
        keys.add('escape', eager=True)(lambda event: finish(None))
        keys.add('enter', eager=True)(lambda event: finish(field.text))
        bind_keys(field.control, keys)
        buttons = [Button('保存', handler=lambda: finish(field.text)), Button('取消', handler=lambda: finish(None))]
        escape = KeyBindings()
        escape.add('escape', eager=True)(lambda event: finish(None))
        for button in buttons:
            bind_keys(button.control, escape)
        form_navigation([field], buttons)
        hint = Label('↓ 到按钮 · 按钮 ↑ 返回路径 · ←→ 编辑文字 / 切换按钮\n'
                     'Tab/Shift+Tab 切换 · 输入框 Enter 保存 · 按钮 Enter 执行 · Esc 取消')
        dialog = Dialog(title=title, body=HSplit([field, hint]), buttons=buttons, width=96)
        return await self.present(dialog, field, result)
