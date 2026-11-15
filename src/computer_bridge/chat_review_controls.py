"""The terminal's interchangeable composer, review lists, and read-only pager."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from prompt_toolkit.application.current import get_app
from prompt_toolkit.data_structures import Point
from prompt_toolkit.document import Document
from prompt_toolkit.filters import Condition
from prompt_toolkit.formatted_text import StyleAndTextTuples
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import ConditionalContainer, HSplit, Layout, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import Dimension
from prompt_toolkit.layout.margins import ScrollbarMargin
from prompt_toolkit.mouse_events import MouseButton, MouseEvent, MouseEventType
from prompt_toolkit.widgets import TextArea

from .chat_dialogs import bind_keys
from .chat_status import clipped
from .chat_transcript import approval_detail_lines, approval_kind, wrap_row


@dataclass
class ReviewState:
    kind: str
    identifier: str
    options: list[tuple[str, str]]
    approval: dict[str, Any] | None = None
    index: int = 0
    marked: int | None = None
    reason: Document = field(default_factory=Document)
    editing_reason: bool = False
    busy: bool = False
    error: str = ''

    @property
    def form(self) -> bool:
        return self.kind in ('tool', 'work-tree')


class ReviewControls:
    def __init__(self, select: Callable[[str], None], dismiss: Callable[[], None]):
        self.select, self.dismiss = select, dismiss
        self.stack: list[ReviewState] = []
        self.plan_reasons: dict[str, Document] = {}
        self.details: dict[str, Any] | None = None
        self.detail_offset = 0
        self.reason = TextArea(
            multiline=True,
            wrap_lines=True,
            height=Dimension(min=1, max=4),
            dont_extend_height=True,
            focus_on_click=Condition(lambda: not self.busy),
            prompt='   理由（选填）：',
            style='class:review.reason',
            read_only=Condition(lambda: self.busy),
        )
        self.control = FormattedTextControl(self.fragments, focusable=True, show_cursor=False,
                                            get_cursor_position=self._list_cursor)
        self.window = Window(self.control, height=Dimension(max=9), dont_extend_height=True,
                             wrap_lines=False, always_hide_cursor=True)
        self.container = HSplit([
            self.window,
            ConditionalContainer(self.reason, filter=Condition(lambda: self.kind == 'plan')),
            Window(FormattedTextControl(self._footer), height=1, always_hide_cursor=True),
        ], style='class:review')
        self.detail_control = FormattedTextControl(self._detail_fragments, focusable=True, show_cursor=False,
            get_cursor_position=self._detail_cursor)
        self.detail_window = Window(self.detail_control, right_margins=[ScrollbarMargin()],
                                    get_vertical_scroll=lambda _: self.detail_offset,
                                    always_hide_cursor=True, wrap_lines=False)
        self.details_container = HSplit([
            Window(FormattedTextControl(lambda: [('class:review.heading', ' 审批详情')]), height=1),
            self.detail_window,
            Window(FormattedTextControl(lambda: [('class:hint', ' ↑↓ / PageUp/PageDown 阅读 · q / Ctrl+C 返回')]), height=1),
        ], style='class:review')
        self._bind()

    @property
    def current(self) -> ReviewState | None:
        return self.stack[-1] if self.stack else None

    @property
    def reading(self) -> bool:
        return self.details is not None

    @property
    def active(self) -> bool:
        return self.current is not None or self.reading

    @property
    def kind(self) -> str:
        return self.current.kind if self.current else 'details' if self.reading else ''

    @property
    def identifier(self) -> str:
        return self.current.identifier if self.current else str((self.details or {}).get('id', ''))

    @property
    def busy(self) -> bool:
        return bool(self.current and self.current.busy)

    @busy.setter
    def busy(self, value: bool) -> None:
        if self.current:
            self.current.busy = value

    @property
    def error(self) -> str:
        return self.current.error if self.current else ''

    @error.setter
    def error(self, value: str) -> None:
        if self.current:
            self.current.error = value

    def contains(self, identifier: str) -> bool:
        return self.find(identifier) is not None or (
            self.details is not None and self.details['id'] == identifier)

    def find(self, identifier: str) -> ReviewState | None:
        return next((state for state in self.stack if state.identifier == identifier), None)

    def _store_reason(self) -> None:
        if self.current and self.current.kind == 'plan':
            self.current.reason = self.reason.buffer.document
            self.current.editing_reason = get_app().layout.current_control is self.reason.control

    def _load_reason(self) -> None:
        self.reason.buffer.set_document(self.current.reason if self.current else Document(), bypass_readonly=True)

    def _push(self, state: ReviewState) -> None:
        self._store_reason()
        self.stack.append(state)
        self._load_reason()

    def show_plan(self, identifier: str) -> None:
        if not self.contains(identifier):
            self._push(ReviewState('plan', identifier, [('normal', '同意并进入普通模式'),
                ('auto', '同意并进入自动模式'), ('reject', '拒绝并要求修改')],
                reason=self.plan_reasons.pop(identifier, Document())))

    def show_claims(self, options: list[tuple[str, str]]) -> None:
        self._push(ReviewState('claim', '', options))

    def show_approval(self, approval: dict[str, Any]) -> None:
        identifier = str(approval['id'])
        if not self.contains(identifier):
            kind = approval_kind(approval)
            if kind == 'work_tree':
                kind = 'work-tree'
                options = [('allowed-once', '启动'), ('rejected', '不启动')]
            elif kind == 'tool':
                options = [('allowed-once', '仅允许本次'), ('rejected', '拒绝'), ('cancelled', '取消调用')]
            else:
                options = [('allowed-once', '批准本次命令'), ('rejected', '拒绝'), ('cancelled', '取消命令')]
            self._push(ReviewState(kind, identifier, options, approval))

    def show_details(self, approval: dict[str, Any]) -> None:
        self._store_reason()
        self.details, self.detail_offset = approval, 0

    def focus(self, layout: Layout) -> None:
        if self.reading:
            layout.focus(self.detail_control)
        elif self.current:
            layout.focus(self.reason if self.current.editing_reason else self.control)

    def close(self) -> None:
        if self.reading:
            self.details = None
            return
        self._store_reason()
        if self.current:
            state = self.stack.pop()
            if state.kind == 'plan':
                self.plan_reasons[state.identifier] = state.reason
            self._load_reason()

    def remove(self, identifier: str, *, keep_reason: bool = False) -> None:
        if self.details is not None and self.details['id'] == identifier:
            self.details = None
        current = self.current
        self._store_reason()
        kept = [state for state in self.stack if state.identifier != identifier]
        if keep_reason:
            for state in self.stack:
                if state.identifier == identifier and state.kind == 'plan':
                    self.plan_reasons[identifier] = state.reason
        else:
            self.plan_reasons.pop(identifier, None)
        self.stack = kept
        if current is not self.current:
            self._load_reason()

    def reset(self) -> None:
        self.stack.clear()
        self.plan_reasons.clear()
        self.details = None
        self._load_reason()

    def _move(self, delta: int, *, wrap: bool = True) -> None:
        if (state := self.current) and state.options:
            count = len(state.options)
            index = state.index + delta
            state.index = index % count if wrap else max(0, min(count - 1, index))

    def _activate(self, index: int | None = None) -> None:
        if (state := self.current) and not state.busy:
            option = state.index if index is None else index
            if 0 <= option < len(state.options):
                state.index = option
                if state.kind == 'plan' and option == 2:
                    self._focus_reason()
                else:
                    self.select(state.options[option][0])

    def _cancel(self) -> None:
        if self.kind == 'plan' or (not self.busy and self.kind == 'claim'):
            self.dismiss()
        elif not self.busy:
            self.select('cancelled')

    def _focus_reason(self) -> None:
        if self.current and self.kind == 'plan' and not self.current.busy:
            self.current.index = 2
            self.current.editing_reason = True
            get_app().layout.focus(self.reason)
            get_app().invalidate()

    def _leave_reason(self) -> None:
        if self.current:
            self.current.editing_reason = False
            if self.kind == 'plan':
                self.current.index = 2
            get_app().layout.focus(self.control)
            get_app().invalidate()

    def _submit_reason(self) -> None:
        if self.current and self.kind == 'plan' and not self.current.busy:
            self.current.index = 2
            self.select('reject')

    def _finish_reading(self) -> None:
        if self.current:
            self.details = None
            self.focus(get_app().layout)
        else:
            self.dismiss()

    def _bind(self) -> None:
        keys = KeyBindings()
        list_only = Condition(lambda: bool(self.current and not self.current.form))
        for name in ('up', 'k'):
            keys.add(name, eager=True)(lambda event: self._move(-1))
        for name in ('down', 'j'):
            keys.add(name, eager=True)(lambda event: self._move(1))
        for name in ('c-p', 'c-k'):
            keys.add(name, filter=list_only, eager=True)(lambda event: self._move(-1))
        for name in ('c-n', 'c-j'):
            keys.add(name, filter=list_only, eager=True)(lambda event: self._move(1))
        for name in ('home', 'end', 'pageup', 'pagedown', 'c-b', 'c-f'):
            def move(event: Any, name: str = name) -> None:
                length = len(self.current.options) if self.current else 0
                height = self.window.render_info.window_height if self.window.render_info else 5
                amount = length if name in ('home', 'end') else max(1, height - 2)
                self._move(-amount if name in ('home', 'pageup', 'c-b') else amount, wrap=False)
            keys.add(name, filter=list_only, eager=True)(move)
        keys.add('enter', eager=True)(lambda event: self._activate())
        for index in range(9):
            keys.add(str(index + 1), eager=True)(lambda event, index=index: self._activate(index))
        for name in ('escape', 'c-c'):
            keys.add(name, eager=True)(lambda event: self._cancel())
        keys.add('tab', eager=True)(lambda event: self._focus_reason())
        command = Condition(lambda: self.kind == 'command')
        for name, index in zip(('y', 'd', 'n'), range(3)):
            keys.add(name, filter=command, eager=True)(lambda event, index=index: self._activate(index))
        keys.add('c-a', filter=command, eager=True)(lambda event: self._open_command_details())
        form = Condition(lambda: bool(self.current and self.current.form))

        def mark(event: Any) -> None:
            if self.current:
                self.current.marked = self.current.index

        def unmark(event: Any) -> None:
            if self.current:
                self.current.marked = None

        keys.add(' ', filter=form, eager=True)(mark)
        for name in ('backspace', 'delete'):
            keys.add(name, filter=form, eager=True)(unmark)
        bind_keys(self.control, keys)

        reason_keys = KeyBindings()
        reason_keys.add('escape', eager=True)(lambda event: self._leave_reason())
        reason_keys.add('c-c', eager=True)(lambda event: self._cancel())
        for name in ('s-tab', 'tab'):
            reason_keys.add(name, eager=True)(lambda event: self._leave_reason())
        reason_keys.add('c-j', eager=True)(
            lambda event: event.current_buffer.insert_text('\n') if not self.busy else None)
        reason_keys.add('enter', eager=True)(lambda event: self._submit_reason())
        bind_keys(self.reason.control, reason_keys)

        base_list_mouse = self.control.mouse_handler

        def list_mouse(mouse_event: MouseEvent) -> Any:
            if (self.current and not self.busy and mouse_event.event_type == MouseEventType.MOUSE_UP
                    and mouse_event.button == MouseButton.LEFT):
                option = mouse_event.position.y - len(self._intro())
                if 0 <= option < len(self.current.options):
                    self.current.index = option
                self.current.editing_reason = False
                get_app().layout.focus(self.control)
                get_app().invalidate()
                return None
            return base_list_mouse(mouse_event)

        self.control.mouse_handler = list_mouse

        base_reason_mouse = self.reason.control.mouse_handler

        def reason_mouse(mouse_event: MouseEvent) -> Any:
            result = base_reason_mouse(mouse_event)
            if (self.current and self.kind == 'plan' and not self.busy
                    and mouse_event.event_type == MouseEventType.MOUSE_UP
                    and mouse_event.button == MouseButton.LEFT
                    and get_app().layout.current_control is self.reason.control):
                self.current.index = 2
                self.current.editing_reason = True
                get_app().invalidate()
            return result

        self.reason.control.mouse_handler = reason_mouse

        read_keys = KeyBindings()
        for name in ('q', 'c-c'):
            read_keys.add(name, eager=True)(lambda event: self._finish_reading())
        for name in ('up', 'k', 'down', 'j', 'home', 'end', 'pageup', 'pagedown', 'c-b', 'c-f'):
            read_keys.add(name, eager=True)(lambda event, name=name: self._scroll_detail(name))
        bind_keys(self.detail_control, read_keys)

    def _open_command_details(self) -> None:
        if self.current and self.current.approval:
            self.show_details(self.current.approval)
            self.focus(get_app().layout)

    def _choice(self, index: int) -> StyleAndTextTuples:
        state = self.current
        if not state or index >= len(state.options):
            return []
        current_control = get_app().layout.current_control
        focused = current_control is self.control or (
            state.kind == 'plan' and index == 2 and current_control is self.reason.control)
        selected = state.index == index and focused
        style = 'class:review.choice.selected' if selected else 'class:review.choice'
        prefix = ' › ' if selected else '   '
        marker = '  ✓' if state.marked == index else ''
        return [(style, clipped(f'{prefix}{index + 1}. {state.options[index][1]}{marker}', self._width()))]

    def _width(self) -> int:
        return get_app().output.get_size().columns

    def _intro(self) -> list[tuple[str, str]]:
        state = self.current
        if not state:
            return []
        title = {'claim': '领取审批', 'plan': '审阅方案', 'command': '审批本次沙盒外命令',
                 'tool': '审批设备工具', 'work-tree': '确认启动 Work Tree'}[state.kind]
        if state.busy:
            title += ' · 等待同步…' if state.error else ' · 正在保存决定…'
        rows = [('class:review.heading', ' ' + title)]
        if approval := state.approval:
            device = approval.get('device_name', approval['device_id'])
            summary = str(approval['command']).splitlines()
            rows.append(('class:hint', '   ' + str(device) + ' · ' + str(approval['cwd'])))
            rows.append(('class:review.choice', '   ' + (summary[0] if summary else '') + (' …' if len(summary) > 1 else '')))
            if state.kind == 'command':
                rows.append(('class:hint', '   本次命令、子进程和后续输入以当前用户权限运行。'))
            if approval.get('module_confirmation'):
                rows.append(('class:hint', '   ' + str(approval['module_confirmation'])))
            if approval.get('permission_confirmation') and state.kind != 'tool':
                rows.append(('class:hint', '   同时批准本次工具使用。'))
        return rows

    def _list_cursor(self) -> Point:
        if not (state := self.current):
            return Point(0, 0)
        return Point(0, len(self._intro()) + state.index)

    def fragments(self) -> StyleAndTextTuples:
        if not (state := self.current):
            return []
        out: StyleAndTextTuples = []
        for style, row in self._intro():
            if out:
                out.append(('', '\n'))
            out.append((style, clipped(row, self._width())))
        for index in range(len(state.options)):
            out.extend([('', '\n'), *self._choice(index)])
        return out

    def _footer(self) -> StyleAndTextTuples:
        if not (state := self.current):
            return []
        if state.error:
            return [('class:review.error', clipped(' ' + ' '.join(state.error.splitlines()), self._width()))]
        plan_hint = (' Shift+Enter 换行 · Enter 提交拒绝 · Esc 返回选项'
                     if get_app().layout.current_control is self.reason.control
                     else ' ↑↓ 选择 · Enter 确认 · Esc 返回')
        hint = {'plan': plan_hint,
                'claim': ' ↑↓ 选择 · Enter 领取 · Esc 返回',
                'command': ' Enter 确认 · Ctrl+A 查看完整命令 · Esc 取消',
                'tool': ' ↑↓ 选择 · Enter 确认 · Esc 取消',
                'work-tree': ' ↑↓ 选择 · Enter 确认 · Esc 取消'}[state.kind]
        return [('class:hint', clipped(hint, self._width()))]

    def _detail_rows(self) -> list[str]:
        if not self.details:
            return []
        width = max(1, self._width() - 1)
        return [''.join(text for _, text, _ in wrapped.fragments)
                for line in approval_detail_lines(self.details) for wrapped in wrap_row([('', line, None)], width)]

    def _detail_fragments(self) -> StyleAndTextTuples:
        return [('', '\n'.join(self._detail_rows()))]

    def _detail_cursor(self) -> Point:
        return Point(0, min(self.detail_offset, max(0, len(self._detail_rows()) - 1)))

    def _scroll_detail(self, name: str) -> None:
        info = self.detail_window.render_info
        height = info.window_height if info else 10
        last = max(0, len(self._detail_rows()) - height)
        if name == 'home':
            self.detail_offset = 0
        elif name == 'end':
            self.detail_offset = last
        else:
            step = height - 1 if name in ('pageup', 'pagedown', 'c-b', 'c-f') else 1
            direction = -1 if name in ('up', 'k', 'pageup', 'c-b') else 1
            start = min(self.detail_offset, last)
            self.detail_offset = max(0, min(last, start + direction * max(1, step)))
