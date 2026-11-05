"""Incremental terminal history with inline, keyboard-accessible approval cards."""
from __future__ import annotations

import asyncio
from bisect import bisect_left, bisect_right, insort
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from typing import Any

from prompt_toolkit.application.current import get_app
from prompt_toolkit.data_structures import Point
from prompt_toolkit.formatted_text import StyleAndTextTuples
from prompt_toolkit.layout import Window
from prompt_toolkit.layout.controls import UIContent, UIControl
from prompt_toolkit.layout.screen import Char
from prompt_toolkit.mouse_events import MouseEvent, MouseEventType

from .chat_markdown import Body, MarkdownWorker
from .common import Json

Fragment = tuple[str, str, tuple[str, str] | None]
Row = list[Fragment]
Anchor = tuple[int | None, int, int]


@dataclass(frozen=True, slots=True)
class DisplayRow:
    fragments: Row
    start: int


@lru_cache(maxsize=4096)
def cell_width(character: str) -> int:
    return Char(character).width


def wrap_row(row: Row, width: int) -> list[DisplayRow]:
    """Use the renderer's character widths, retaining styles and button actions."""
    result: list[DisplayRow] = []
    fragments: Row = []
    column = offset = start = 0
    for style, text, action in row:
        span = 0
        for index, character in enumerate(text):
            size = cell_width(character)
            if column and column + size > width:
                if index > span:
                    fragments.append((style, text[span:index], action))
                result.append(DisplayRow(fragments, start))
                fragments = []
                start, span, column = offset, index, 0
            column += size
            offset += 1
        if span < len(text):
            fragments.append((style, text[span:], action))
    if not result:
        return [DisplayRow(row, 0)]
    if fragments:
        result.append(DisplayRow(fragments, start))
    return result


class TranscriptWindow(Window):
    """The transcript owns its viewport; keyboard focus does not scroll it."""
    content: ChatTranscript

    def __init__(self, content: ChatTranscript, **kwargs: Any):
        super().__init__(content, wrap_lines=False, **kwargs)

    def _scroll(self, ui_content: UIContent, width: int, height: int) -> None:
        self.horizontal_scroll = self.vertical_scroll_2 = 0
        self.vertical_scroll = self.content.top

    def _mouse_handler(self, mouse_event: MouseEvent) -> Any:
        if mouse_event.event_type in {MouseEventType.SCROLL_UP, MouseEventType.SCROLL_DOWN}:
            self.content.scroll(-3 if mouse_event.event_type == MouseEventType.SCROLL_UP else 3)
            return None
        return super()._mouse_handler(mouse_event)


class ChatTranscript(UIControl):
    """Keep message lines separately; only visible lines enter the renderer."""

    def __init__(self, status: Callable[[Json], str], decide: Callable[[str, str], None]):
        self.status, self.decide = status, decide
        self.messages: dict[int, Json] = {}
        self.order: list[int] = []
        self.lines: dict[int, list[Row]] = {}
        self.bodies: dict[int, tuple[tuple[object, ...], list[Row]]] = {}
        self.segment_actions: dict[int, list[tuple[tuple[str, str], int]]] = {}
        self.starts: list[int] = []
        self.notes: tuple[str, ...] = ()
        self.footer: list[Row] = []
        self.older = False
        self.count = 1
        self.cursor = 0
        self.top = 0
        self.width = 0
        self.height = 1
        self.display_starts: list[int] = []
        self.display_rows: list[list[DisplayRow]] = []
        self.display_count = 1
        self.wrap_cache: dict[int, tuple[Row, list[DisplayRow]]] = {}
        self.dirty = True
        self.pending_anchor: Anchor | None = None
        self.wrap_computations = 0
        self.following = True
        self.expanded: set[str] = set()
        self.busy: set[str] = set()
        self.actions: list[tuple[tuple[str, str], int]] = []
        self.selected: tuple[str, str] | None = None
        self.pending_count = 0
        self.formatted_messages = 0
        self.markdown: MarkdownWorker | None = None
        self.documents: dict[int, tuple[str,int,Body]] = {}
        self.source_positions: dict[int, list[int]] = {}
        self.format_width = 80
        self.ready_documents: dict[int,tuple[str,int,Body]] = {}
        self.document_flush: asyncio.TimerHandle | None = None

    def _apply_documents(self) -> None:
        self.document_flush=None
        anchor=self._anchor();changed=False
        for sequence,(text,columns,body) in self.ready_documents.items():
            current=self.messages.get(sequence)
            if current is not None and current['text']==text and self.format_width==columns:
                self.documents[sequence]=(text,columns,body)
                self.bodies.pop(sequence,None)
                self.lines[sequence]=self._format(current);changed=True
        self.ready_documents.clear()
        if changed:self._index(anchor);get_app().invalidate()

    def _prepare_body(self, sequence: int, message: Json) -> None:
        if self.markdown is None:
            return
        worker=self.markdown
        text, columns = str(message['text']), self.format_width
        cached=self.documents.get(sequence)
        if cached and cached[:2] == (text,columns):
            return
        key=(str(message['id']),columns)
        if key in self.markdown.tasks:
            return
        async def prepare() -> None:
            try:
                body=await worker.body(text,str(message['id']),columns)
                self.ready_documents[sequence]=(text,columns,body)
                if self.document_flush is None:
                    self.document_flush=asyncio.get_running_loop().call_later(1/30,self._apply_documents)
            finally:
                if worker.tasks.get(key) is asyncio.current_task():worker.tasks.pop(key,None)
        self.markdown.tasks[key]=asyncio.create_task(prepare())

    @staticmethod
    def row(text: str, style: str = "") -> Row:
        return [(style, text, None)]

    def is_focusable(self) -> bool:
        return True

    def _format(self, message: Json) -> list[Row]:
        self.formatted_messages += 1
        if message.get("approval_id"):
            return []  # Its decision is displayed on the original approval card.
        approval = message.get("approval") if message.get("kind") == "approval" else None
        if approval:
            identifier = str(approval["id"])
            pending = approval["state"] == "pending" and not approval.get("decision")
            decision = {"allowed-once": "已批准本次命令", "rejected": "已拒绝", "cancelled": "已取消"}.get(approval.get("decision"), "")
            label = decision or {"pending": "命令审批", "expired": "审批已过期", "invalidated": "审批已失效", "ended": "审批已结束"}.get(approval["state"], "审批已处理")
            if approval.get("delivery_pending"):
                label += " · 决定等待送达"
            rows = [self.row("┌ " + label, "class:approval.heading"),
                    self.row("│ " + str(approval.get("device_name", approval["device_id"])) + " · " + str(approval["device_id"]))]
            if pending or identifier in self.expanded:
                for title, value in (("目录", approval["cwd"]), ("命令", approval["command"]), ("理由", approval["justification"])):
                    rows.extend(self.row("│ " + (title + "：" if index == 0 else "  ") + line)
                                for index, line in enumerate(str(value).splitlines() or [""]))
                expires = datetime.fromtimestamp(float(approval["expires_at"]) / 1000).astimezone().strftime("%m-%d %H:%M:%S")
                rows.append(self.row("│ 到期：" + expires))
                rows.append(self.row("│ 仅本次命令、子进程与后续输入使用当前用户权限，在工作区限制外运行。", "class:hint"))
            if pending:
                if identifier in self.busy:
                    rows.append(self.row("│ 正在保存决定…", "class:status"))
                else:
                    rows.append([( "", "│ ", None),
                        ("class:approval.button", " 批准本次 ", (identifier, "allowed-once")), ("", "  ", None),
                        ("class:approval.button", " 拒绝 ", (identifier, "rejected")), ("", "  ", None),
                        ("class:approval.button", " 取消命令 ", (identifier, "cancelled"))])
            else:
                rows.append([("", "│ ", None), ("class:approval.button", " 收起详情 " if identifier in self.expanded else " 查看详情 ", (identifier, "details"))])
            return [*rows, self.row("└"), self.row("")]
        sender = "GPT / Dot" if message["role"] == "assistant" else "你"
        signature = (message["text"], tuple((file["id"], file["name"], file["size"]) for file in message.get("attachments", [])))
        sequence = int(message["sequence"])
        previous = self.bodies.get(sequence)
        if previous is None or previous[0] != signature:
            self._prepare_body(sequence,message)
            document=self.documents.get(sequence)
            if document and document[0]==message['text']:
                body=list(document[2].rows)
                positions=list(document[2].sources)
            else:
                raw=message['text'].split('\n')
                body=[self.row(line) for line in raw]
                positions=[];offset=0
                for line in raw:positions.append(offset);offset+=len(line)+1
            body.extend(self.row(f"  ↳ {file['id']}  {file['name']}  ({file['size']} 字节)") for file in message.get("attachments", []))
            positions.extend([len(message['text'])]*(len(body)-len(positions)))
            self.source_positions[sequence]=[-1,*positions,len(message['text'])+1]
            self.bodies[sequence] = signature, body
        else:
            body = previous[1]
        return [self.row(f"{sender} · {message['id']} · {message.get('created_at', '')}  {self.status(message)}", "class:hint"), *body, self.row("")]

    def update(self, messages: Iterable[Json] = (), *, reset: bool = False,
               notes: Iterable[str] = (), older: bool = False) -> None:
        anchor = self._anchor()
        changed = reset
        if reset:
            if self.markdown:
                for task in tuple(self.markdown.tasks.values()):task.cancel()
                self.markdown.tasks.clear()
            self.documents.clear();self.source_positions.clear()
            self.ready_documents.clear()
            if self.document_flush:self.document_flush.cancel();self.document_flush=None
            self.messages.clear(); self.order.clear(); self.lines.clear()
            self.bodies.clear()
            self.segment_actions.clear()
            self.expanded.clear(); self.busy.clear(); self.selected = None
            self.following = True
        for message in messages:
            sequence = int(message["sequence"])
            if self.messages.get(sequence) != message:
                if sequence not in self.messages:
                    insort(self.order, sequence)
                self.messages[sequence] = message
                self.lines[sequence] = self._format(message)
                self.segment_actions[sequence] = [(action, offset) for offset, row in enumerate(self.lines[sequence])
                                                  for _, _, action in row if action]
                changed = True
        current_notes = tuple(notes)
        if current_notes != self.notes:
            self.notes = current_notes
            self.footer = [self.row("— " + line) for note in current_notes for line in note.splitlines()]
            changed = True
        if older != self.older:
            self.older = older; changed = True
        if changed:
            self._index(anchor)

    def _anchor(self) -> Anchor | None:
        if self.pending_anchor is not None:
            return self.pending_anchor
        if not self.display_starts:
            return None
        logical = bisect_right(self.display_starts, self.top) - 1
        line = self.display_rows[logical][self.top - self.display_starts[logical]]
        index = bisect_right(self.starts, logical) - 1
        if index >= 0 and index < len(self.order):
            sequence = self.order[index]
            offset = logical - self.starts[index]
            if offset < len(self.lines[sequence]):
                positions=self.source_positions.get(sequence)
                character=line.start
                if positions:
                    first=bisect_left(positions,positions[offset])
                    character+=sum(sum(len(text) for _,text,_ in row) for row in self.lines[sequence][first:offset])
                return sequence, positions[offset] if positions else offset, character
        return None, logical, line.start

    def _index(self, anchor: Anchor | None = None) -> None:
        self.starts = []
        self.actions = []
        self.pending_count = 0
        count = int(self.older)
        for sequence in self.order:
            self.starts.append(count)
            rows = self.lines[sequence]
            approval = self.messages[sequence].get("approval")
            if approval and approval["state"] == "pending" and not approval.get("decision"):
                self.pending_count += 1
            self.actions.extend((action, count + offset) for action, offset in self.segment_actions[sequence])
            count += len(rows)
        self.count = max(1, count + len(self.footer))
        self.dirty = True
        self.pending_anchor = None if self.following else anchor
        if self.selected and self.selected not in [action for action, _ in self.actions]:
            self.selected = None

    def _row(self, index: int) -> Row:
        if self.older and index == 0:
            return self.row("↑ /history 读取更早消息", "class:hint")
        segment = bisect_right(self.starts, index) - 1
        if segment >= 0:
            rows = self.lines[self.order[segment]]
            offset = index - self.starts[segment]
            if offset < len(rows):
                return rows[offset]
            index = offset - len(rows)
        else:
            index -= int(self.older)
        return self.footer[index] if 0 <= index < len(self.footer) else self.row("")

    def _layout(self, width: int, height: int) -> None:
        width, height = max(1, width), max(1, height)
        if width != self.format_width:
            self.format_width=width
            for sequence in self.order:
                if self.messages[sequence].get('kind')!='approval':self._prepare_body(sequence,self.messages[sequence])
        anchor = self._anchor()
        if self.dirty or width != self.width:
            cache = self.wrap_cache if width == self.width else {}
            fresh: dict[int, tuple[Row, list[DisplayRow]]] = {}
            self.display_starts, self.display_rows = [], []
            count = 0
            for index in range(self.count):
                row = self._row(index)
                entry = cache.get(id(row))
                if entry is None or entry[0] is not row:
                    entry = row, wrap_row(row, width)
                    self.wrap_computations += 1
                fresh[id(row)] = entry
                self.display_starts.append(count)
                self.display_rows.append(entry[1])
                count += len(entry[1])
            self.wrap_cache = fresh
            self.display_count = count
            self.dirty = False
            self.width = width
            if anchor is not None and not self.following:
                anchor_sequence, logical, character = anchor
                if anchor_sequence is not None and anchor_sequence in self.messages:
                    index = bisect_right(self.order, anchor_sequence) - 1
                    positions=self.source_positions.get(anchor_sequence)
                    offset=max(0,bisect_left(positions,logical)) if positions else logical
                    if positions:
                        offset=min(offset,len(positions)-1)
                        while offset+1<len(positions) and positions[offset+1]==positions[offset]:
                            size=sum(len(text) for _,text,_ in self.lines[anchor_sequence][offset])
                            if character<size:break
                            character-=size;offset+=1
                    logical = self.starts[index] + min(offset, max(0, len(self.lines[anchor_sequence]) - 1))
                logical = min(logical, self.count - 1)
                segments = self.display_rows[logical]
                part = max(0, bisect_right([row.start for row in segments], character) - 1)
                self.top = self.display_starts[logical] + part
            self.pending_anchor = None
        self.height = height
        maximum = max(0, self.display_count - height)
        self.top = maximum if self.following else min(self.top, maximum)
        self.cursor = max(0, bisect_right(self.display_starts, self.top) - 1)

    def _screen_row(self, index: int) -> DisplayRow:
        logical = bisect_right(self.display_starts, index) - 1
        return self.display_rows[logical][index - self.display_starts[logical]]

    def create_content(self, width: int, height: int) -> UIContent:
        self._layout(width, height)
        focused = get_app().layout.current_control is self
        def line(index: int) -> StyleAndTextTuples:
            return [(style + (" class:approval.selected" if focused and action == self.selected and action else ""), text)
                    for style, text, action in self._screen_row(index).fragments]
        return UIContent(get_line=line, line_count=self.display_count, cursor_position=Point(x=0, y=self.top), show_cursor=False)

    def scroll(self, amount: int) -> None:
        self._layout(self.width, self.height)
        maximum = max(0, self.display_count - self.height)
        self.top = max(0, min(maximum, self.top + amount))
        self.following = self.top == maximum
        self.cursor = max(0, bisect_right(self.display_starts, self.top) - 1)
        self.selected = None
        get_app().invalidate()

    def page(self, direction: int) -> None:
        self.scroll(direction * max(1, self.height - 1))

    def move_cursor_up(self) -> None:
        self.scroll(-1)

    def move_cursor_down(self) -> None:
        self.scroll(1)

    def focus_action(self, direction: int = 1) -> bool:
        actions = [action for action, _ in self.actions]
        if not actions:
            return False
        if get_app().layout.current_control is not self:
            index = next((index for index, (action, _) in enumerate(self.actions) if action[1] != "details"),
                         0 if direction > 0 else len(actions) - 1)
        else:
            index = actions.index(self.selected) + direction if self.selected in actions else (0 if direction > 0 else len(actions) - 1)
        if not 0 <= index < len(actions):
            self.selected = None
            return False
        self.selected, logical = self.actions[index]
        self.following = False
        self._layout(self.width, self.height)
        parts = self.display_rows[logical]
        part = next(i for i, row in enumerate(parts) if any(action == self.selected for _, _, action in row.fragments))
        position = self.display_starts[logical] + part
        if position < self.top:
            self.top = position
        elif position >= self.top + self.height:
            self.top = position - self.height + 1
        get_app().layout.focus(self)
        get_app().invalidate()
        return True

    def activate(self, action: tuple[str, str] | None = None) -> None:
        action = action or self.selected
        if not action:
            return
        identifier, decision = action
        if decision == "details":
            if identifier in self.expanded:
                self.expanded.remove(identifier)
            else:
                self.expanded.add(identifier)
            self.refresh_approval(identifier)
        elif identifier not in self.busy:
            self.decide(identifier, decision)

    def refresh_approval(self, identifier: str) -> None:
        anchor = self._anchor()
        for sequence in self.order:
            if self.messages[sequence].get("approval", {}).get("id") == identifier:
                self.lines[sequence] = self._format(self.messages[sequence])
                self.segment_actions[sequence] = [(action, offset) for offset, row in enumerate(self.lines[sequence])
                                                  for _, _, action in row if action]
                break
        self._index(anchor)
        get_app().invalidate()

    def mouse_handler(self, mouse_event: MouseEvent) -> Any:
        if mouse_event.event_type in {MouseEventType.SCROLL_UP, MouseEventType.SCROLL_DOWN}:
            self.scroll(-3 if mouse_event.event_type == MouseEventType.SCROLL_UP else 3)
            return None
        if mouse_event.event_type == MouseEventType.MOUSE_UP:
            position = 0
            for _, text, action in self._screen_row(mouse_event.position.y).fragments:
                position += len(text)
                if position > mouse_event.position.x:
                    if action:
                        self.selected = action
                        self.activate(action)
                        return None
                    break
        return NotImplemented
