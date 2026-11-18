"""Incremental terminal history with keyboard-accessible review entries."""
from __future__ import annotations

import asyncio
from bisect import bisect_left, bisect_right, insort
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from prompt_toolkit.application.current import get_app
from prompt_toolkit.data_structures import Point
from prompt_toolkit.formatted_text import StyleAndTextTuples
from prompt_toolkit.layout import Window
from prompt_toolkit.layout.controls import UIContent, UIControl
from prompt_toolkit.mouse_events import MouseButton, MouseEvent, MouseEventType

from .chat_cells import cell_width as cell_width
from .chat_cells import graphemes, source_lines
from .chat_markdown import Body, MarkdownWorker
from .chat_status import clipped
from .common import Json


def format_sender(message: Json, user_name: str = "我") -> str:
    if message.get("role") != "assistant":
        return user_name
    if title := str(message.get("task_title") or "").strip():
        return f"任务 · {clipped(title, 32)}"
    if message.get("sender_role") == "master":
        return "Master"
    return "Super Agent" if message.get("source") == "module" else "GPT / Dot"

Fragment = tuple[str, str, tuple[str, str] | None]
Row = list[Fragment]
Anchor = tuple[int | str | None, int, int, int]
RenderKey = tuple[int, str, str, int]
TextPoint = tuple[int, int, int]  # message sequence, logical row in that message, source character


def beijing_message_time(value: Any) -> str:
    """Display protocol timestamps in Beijing time (UTC+08:00), to minutes."""
    if value is None or value == "":
        return ""
    try:
        instant = datetime.fromisoformat(value)
        # Legacy timestamps without an offset still originate in UTC.
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=UTC)
        return instant.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OverflowError, OSError):
        return "时间未知"


def approval_kind(card: Json) -> str:
    if card.get("module_confirmation"):
        return "work_tree"
    return "tool" if card.get("tool") else "command"


def approval_detail_lines(card: Json) -> list[str]:
    """Render the original, persisted request for both history and the reader."""
    device = str(card["device_id"])
    name = str(card.get("device_name", device))
    kind = approval_kind(card)
    lines = ["设备：" + (f"{name} · {device}" if name != device else device)]
    for label, key in (("目录", "cwd"), ("命令" if kind == "command" else "工具调用", "command"), ("理由", "justification")):
        lines.extend((label + "：" if index == 0 else "  ") + line.expandtabs(8)
                     for index, (_, line) in enumerate(source_lines(str(card[key]))))
    expires = datetime.fromtimestamp(float(card["expires_at"]) / 1000, UTC)
    lines.append("到期：" + beijing_message_time(expires.isoformat()))
    if kind == "work_tree":
        lines.extend(line for _, line in source_lines(str(card["module_confirmation"])))
    if card.get("permission_confirmation"):
        lines.append("本次同时申请使用设备命令工具。" if kind == "command" else "本次同时申请使用设备工具。")
    lines.append("仅本次命令、子进程与后续输入使用当前用户权限，在工作区限制外运行。" if kind == "command" else
                 "仅批准本次调用，工作区限制保持不变。")
    return lines


@dataclass(frozen=True, slots=True)
class DisplayRow:
    fragments: Row
    start: int


def wrap_row(row: Row, width: int) -> list[DisplayRow]:
    """Break at grapheme boundaries; mathematical spans remain indivisible."""
    text = "".join(value for _, value, _ in row)
    clusters = list(graphemes(text))
    math_ranges: list[tuple[int, int]] = []
    offset = 0
    for style, text, action in row:
        end = offset + len(text)
        if "class:md.math" in style.split() and text:
            if math_ranges and math_ranges[-1][1] == offset:
                math_ranges[-1] = math_ranges[-1][0], end
            else:
                math_ranges.append((offset, end))
        offset = end
    boundaries = [0]
    column = cluster_index = math_index = 0
    while cluster_index < len(clusters):
        begin, cluster, size = clusters[cluster_index]
        end = begin + len(cluster)
        while math_index < len(math_ranges) and math_ranges[math_index][1] <= begin:
            math_index += 1
        # A styled boundary may lie inside a combining sequence. Keep both the
        # source fragments and that entire sequence on the same physical row.
        if math_index < len(math_ranges) and math_ranges[math_index][0] < end:
            math_end = math_ranges[math_index][1]
            while cluster_index + 1 < len(clusters) and clusters[cluster_index + 1][0] < math_end:
                cluster_index += 1
                position, following, following_size = clusters[cluster_index]
                end = position + len(following)
                size += following_size
        if column and column + size > width:
            boundaries.append(begin)
            column = 0
        column += size
        cluster_index += 1
    if len(boundaries) == 1:
        return [DisplayRow(row, 0)]
    boundaries.append(offset)
    result: list[DisplayRow] = []
    fragment_index = fragment_start = 0
    for start, end in zip(boundaries, boundaries[1:]):
        fragments: Row = []
        while fragment_index < len(row):
            style, value, action = row[fragment_index]
            fragment_end = fragment_start + len(value)
            if fragment_start >= end:
                break
            if fragment_end > start:
                fragments.append((style, value[max(0, start-fragment_start):end-fragment_start], action))
            if fragment_end > end:
                break
            fragment_index += 1
            fragment_start = fragment_end
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

    def __init__(self, status: Callable[[Json], str], open_review: Callable[[str, str], None]):
        self.status, self.open_review = status, open_review
        self.messages: dict[int, Json] = {}
        self.user_name = "本机"
        self.maintenance_statuses: dict[str, Json] = {}
        self.plan_reviews: dict[str, Json] = {}
        self.plans_at: dict[int, set[str]] = {}
        self.plan_documents: dict[str, tuple[str, int, Body]] = {}
        self.review_offsets: dict[str, tuple[int, int]] = {}
        self.review_positions: dict[str, list[int]] = {}
        self.approval_sequences: dict[str, int] = {}
        self.approval_errors: dict[str, str] = {}
        self.leading_rows: list[Row] = []
        self.order: list[int] = []
        self.lines: dict[int, list[Row]] = {}
        self.bodies: dict[int, tuple[tuple[object, ...], list[Row]]] = {}
        self.segment_actions: dict[int, list[tuple[tuple[str, str], int]]] = {}
        self.starts: list[int] = []
        self.older = False
        self.history_complete = False
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
        self.busy: set[str] = set()
        self.actions: list[tuple[tuple[str, str], int]] = []
        self.selected: tuple[str, str] | None = None
        self.selection: tuple[TextPoint, TextPoint] | None = None
        self.drag_anchor: TextPoint | None = None
        self.mouse_button = MouseButton.NONE
        self.copy_menu: Callable[[], None] | None = None
        self.selection_started: Callable[[], None] | None = None
        self.selection_finished: Callable[[], None] | None = None
        self.pending_count = 0
        self.history_state = ""
        self.on_scroll: Callable[[int], None] | None = None
        self.formatted_messages = 0
        self.markdown: MarkdownWorker | None = None
        self.generation = 0
        self.documents: dict[int, tuple[str,int,Body]] = {}
        self.source_positions: dict[int, list[int]] = {}
        self.format_width = 80
        self.ready_documents: dict[RenderKey,tuple[int,Body]] = {}
        self.pending_documents: dict[int,RenderKey] = {}
        self.document_flush: asyncio.TimerHandle | None = None

    def _apply_documents(self) -> None:
        self.document_flush=None
        anchor=self._anchor();changed=False
        for key,(sequence,body) in self.ready_documents.items():
            if self._current_document(key,sequence):
                _,_,text,columns=key
                self.documents[sequence]=(text,columns,body)
                self.bodies.pop(sequence,None)
                self._refresh_segment(sequence);changed=True
        self.ready_documents.clear()
        if changed:self._index(anchor);get_app().invalidate()

    def _current_document(self, key: RenderKey, sequence: int) -> bool:
        generation,identifier,text,columns=key
        current=self.messages.get(sequence)
        return (generation==self.generation and columns==self.format_width and current is not None
                and current['id']==identifier and current['text']==text)

    def _prepare_body(self, sequence: int, message: Json) -> None:
        if self.markdown is None:
            return
        worker=self.markdown
        text, columns = str(message['text']), self.format_width
        key=(self.generation,str(message['id']),text,columns)
        previous=self.pending_documents.get(sequence)
        if previous is not None and previous!=key:
            task=worker.tasks.pop(previous,None)
            if task is not None:task.cancel()
            self.pending_documents.pop(sequence,None)
        cached=self.documents.get(sequence)
        if cached and cached[:2] == (text,columns):
            return
        if key in self.markdown.tasks:
            return
        async def prepare() -> None:
            try:
                ordinal=bisect_left(self.order,sequence)
                first=self.starts[ordinal] if ordinal<len(self.starts) else 0
                last=self.starts[ordinal+1] if ordinal+1<len(self.starts) else self.count
                begin=self.display_starts[first] if first<len(self.display_starts) else first
                end=self.display_starts[last] if last<len(self.display_starts) else self.display_count
                distance=max(0,self.top-end,begin-self.top-self.height)
                body=await worker.body(text,str(message['id']),columns,priority=distance)
                if self._current_document(key,sequence):
                    self.ready_documents[key]=(sequence,body)
                    if self.document_flush is None:
                        self.document_flush=asyncio.get_running_loop().call_later(1/30,self._apply_documents)
            finally:
                if worker.tasks.get(key) is asyncio.current_task():
                    worker.tasks.pop(key,None)
                    if self.pending_documents.get(sequence)==key:self.pending_documents.pop(sequence,None)
        self.markdown.tasks[key]=asyncio.create_task(prepare())
        self.pending_documents[sequence]=key

    @staticmethod
    def row(text: str, style: str = "") -> Row:
        return [(style, text, None)]

    def is_focusable(self) -> bool:
        return True

    def _maintenance_rows(self, sequence: int) -> list[Row]:
        rows: list[Row] = []
        statuses = sorted((item for item in self.maintenance_statuses.values()
            if int(item["anchor_sequence"]) == sequence), key=lambda item: (item["created_at"], item["id"]))
        for item in statuses:
            deferred = item.get("outcome") == "deferred" or (
                item["state"] == "completed" and item["text"] == "收到新消息，空闲检查已顺延。")
            state = "检查已顺延" if deferred else {"waiting": "等待维护", "running": "正在维护上下文", "completed": "上下文维护完成", "failed": "维护失败"}[item["state"]]
            detail = str(item["text"])
            text = "◇ 上下文维护 · " + state
            if detail.strip().rstrip("。.") != state:
                text += " · " + detail
            rows.extend(self.row(line, "class:maintenance") for _, line in source_lines(text))
            rows.append(self.row(""))
        return rows

    def _plan_rows(self, sequence: int, start: int) -> list[Row]:
        rows: list[Row] = []
        for item in sorted((self.plan_reviews[identifier] for identifier in self.plans_at.get(sequence, ())),
                           key=lambda item: (item['created_revision'], item['id'])):
            identifier, markdown = str(item['id']), str(item['markdown'])
            self.review_offsets[identifier] = sequence, start + len(rows)
            state = {'pending': '待审', 'rejected': '已要求修改', 'cancelled': '已取消'}.get(item['state'], '已同意')
            state = {'normal': '已同意 · 普通模式', 'auto': '已同意 · 自动模式'}.get(item.get('decision', ''), state)
            heading = self.row('◇ 计划 · ', 'class:approval.heading')
            heading.append(('class:approval.button' if item['state'] == 'pending' else 'class:approval.heading',
                            state, (identifier, 'plan') if item['state'] == 'pending' else None))
            rows.append(heading)
            document = self.plan_documents.get(identifier)
            if document and document[0] == markdown:
                rows.extend(document[2].rows)
                positions = list(document[2].sources)
                if document[1] != self.format_width:
                    self._prepare_plan(identifier, markdown)
            elif self.markdown:
                self._prepare_plan(identifier, markdown)
                rows.append(self.row('正在排版方案…', 'class:hint'))
                positions = [0]
            else:
                source = list(source_lines(markdown))
                rows.extend(self.row(line.expandtabs(8)) for _, line in source)
                positions = [offset for offset, _ in source]
            if item.get('reason'):
                for offset, line in source_lines('修改理由：' + str(item['reason'])):
                    rows.append(self.row(line, 'class:hint'))
                    positions.append(len(markdown) + 1 + offset)
            rows.append(self.row(''))
            self.review_positions[identifier] = [-1, *positions, max(positions[-1] + 1 if positions else 0, len(markdown) + 1)]
        return rows

    def _prepare_plan(self, identifier: str, markdown: str) -> None:
        if self.markdown is None:
            return
        worker, columns = self.markdown, self.format_width
        key = (self.generation, 'review:' + identifier, markdown, columns)
        if key in worker.tasks:
            return

        async def prepare() -> None:
            try:
                body = await worker.body(markdown, key[1], columns)
                current = self.plan_reviews.get(identifier)
                if current and current['markdown'] == markdown and self.generation == key[0] and self.format_width == columns:
                    anchor = self._anchor()
                    self.plan_documents[identifier] = markdown, columns, body
                    sequence = int(current['anchor_sequence'])
                    if sequence in self.messages:
                        self._refresh_segment(sequence)
                    self._index(anchor)
                    get_app().invalidate()
            finally:
                if worker.tasks.get(key) is asyncio.current_task():
                    worker.tasks.pop(key, None)

        worker.tasks[key] = asyncio.create_task(prepare())

    def _format(self, message: Json) -> list[Row]:
        rows = self._format_message(message)
        sequence = int(message["sequence"])
        maintenance = self._maintenance_rows(sequence)
        reviews = self._plan_rows(sequence, len(rows) + len(maintenance))
        if sequence in self.source_positions:
            positions = self.source_positions[sequence][:len(rows)]
            positions.extend(len(message["text"]) + 2 + offset for offset in range(len(maintenance) + len(reviews)))
            self.source_positions[sequence] = positions
        return [*rows, *maintenance, *reviews]

    def _refresh_segment(self, sequence: int) -> None:
        self.lines[sequence] = self._format(self.messages[sequence])
        self.segment_actions[sequence] = [(action, offset) for offset, row in enumerate(self.lines[sequence])
                                          for _, _, action in row if action]

    def _format_message(self, message: Json) -> list[Row]:
        self.formatted_messages += 1
        if message.get("approval_id"):
            return []  # Its decision is displayed on the original approval card.
        approval = message.get("approval") if message.get("kind") == "approval" else None
        if approval:
            identifier = str(approval["id"])
            pending = approval["state"] == "pending" and not approval.get("decision")
            kind = approval_kind(approval)
            decision = {"allowed-once": "已批准本次命令" if kind == "command" else "已批准本次调用",
                        "rejected": "已拒绝", "cancelled": "已取消"}.get(approval.get("decision"), "")
            state = approval["state"]
            if state in {"invalidated", "expired", "revoked"}:
                label = {"invalidated": "授权已变化", "expired": "审批已过期", "revoked": "授权已撤销"}[state]
            elif state == "ended" and approval.get("decision") == "allowed-once":
                label = decision + " · 审批已结束"
            elif pending:
                label = {"work_tree": "Work Tree 启动确认", "tool": "工具审批", "command": "命令审批"}[kind]
            else:
                label = decision or "审批已处理"
            if approval.get("delivery_pending"):
                label += " · 决定已保存，等待送达"
            lines = approval_detail_lines(approval)
            rows = [self.row("┌ " + label, "class:approval.heading")]
            rows.extend(self.row("│ " + line) for line in (lines if pending else lines[:1]))
            if pending:
                if identifier in self.busy:
                    rows.append(self.row("│ 正在保存决定…", "class:status"))
                else:
                    rows.append([("", "│ ", None), ("class:approval.button", " 审阅 ", (identifier, "approval"))])
            else:
                rows.append([("", "│ ", None), ("class:approval.button", " 查看详情 ", (identifier, "details"))])
            if pending and identifier in self.approval_errors:
                rows.append(self.row('│ ' + self.approval_errors[identifier], 'class:hint'))
            return [*rows, self.row("└"), self.row("")]
        sender = "▐ " + format_sender(message, self.user_name) + " ▌"
        signature = (message["text"], tuple((file["id"], file["name"], file["size"]) for file in message.get("attachments", [])))
        sequence = int(message["sequence"])
        previous = self.bodies.get(sequence)
        if previous is None or previous[0] != signature:
            self._prepare_body(sequence,message)
            document=self.documents.get(sequence)
            if document and document[:2]==(message['text'],self.format_width):
                body=list(document[2].rows)
                positions=list(document[2].sources)
            else:
                raw=list(source_lines(message['text']))
                body=[self.row(line.expandtabs(8)) for _,line in raw]
                positions=[offset for offset,_ in raw]
            body.extend(self.row(f"  ↳ {file['id']}  {file['name']}  ({file['size']} 字节)") for file in message.get("attachments", []))
            positions.extend([len(message['text'])]*(len(body)-len(positions)))
            self.source_positions[sequence]=[-1,*positions,len(message['text'])+1]
            self.bodies[sequence] = signature, body
        else:
            body = previous[1]
        quote = [("class:reply.label", "  ↪ 引用 " + str(message["reply_to"]) + " ", None)] if message.get("reply_to") else []
        return [[("class:sender.assistant" if message["role"] == "assistant" else "class:sender.user", sender, None),
                 ("class:hint", f" · {message['id']} · {beijing_message_time(message.get('created_at'))}  {self.status(message)}", None),
                 *quote], *body, self.row("")]

    def update(self, messages: Iterable[Json] = (), *, reset: bool = False,
               older: bool = False, history_state: str = "", history_complete: bool = False,
               user_name: str | None = None, maintenance_statuses: Iterable[Json] | None = None,
               plan_reviews: Iterable[Json] = ()) -> None:
        anchor = self._anchor()
        changed = reset
        if reset:
            self.generation += 1
            if self.markdown:
                for task in tuple(self.markdown.tasks.values()):task.cancel()
                self.markdown.tasks.clear()
            self.documents.clear();self.source_positions.clear()
            self.pending_documents.clear()
            self.ready_documents.clear()
            if self.document_flush:self.document_flush.cancel();self.document_flush=None
            self.messages.clear(); self.order.clear(); self.lines.clear()
            self.maintenance_statuses.clear()
            self.plan_reviews.clear(); self.plans_at.clear(); self.plan_documents.clear()
            self.review_offsets.clear(); self.review_positions.clear()
            self.approval_sequences.clear()
            self.approval_errors.clear()
            self.bodies.clear()
            self.segment_actions.clear()
            self.busy.clear(); self.selected = None
            self.clear_selection()
            self.following = True
        refresh: set[int] = set()
        if user_name is not None and user_name != self.user_name:
            self.user_name = user_name
            refresh.update(self.order)
        if maintenance_statuses is not None:
            for item in maintenance_statuses:
                identifier = str(item["id"])
                old = self.maintenance_statuses.get(identifier)
                # A delayed history page must not revert a newer live status.
                if old is not None and str(old["updated_at"]) > str(item["updated_at"]):
                    continue
                if old != item:
                    self.maintenance_statuses[identifier] = item
                    refresh.add(int(item["anchor_sequence"]))
                    if old is not None:
                        refresh.add(int(old["anchor_sequence"]))
                    changed = True
        for item in plan_reviews:
            identifier = str(item['id'])
            old = self.plan_reviews.get(identifier)
            if old is not None and old['updated_revision'] > item['updated_revision']:
                continue
            if old != item:
                sequence = int(item['anchor_sequence'])
                self.plan_reviews[identifier] = item
                if old:
                    previous = int(old['anchor_sequence'])
                    self.plans_at[previous].discard(identifier)
                    refresh.add(previous)
                self.plans_at.setdefault(sequence, set()).add(identifier)
                refresh.add(sequence)
                changed = True
        for message in messages:
            sequence = int(message["sequence"])
            if self.messages.get(sequence) != message:
                if sequence not in self.messages:
                    insort(self.order, sequence)
                if approval := message.get('approval'):
                    self.approval_sequences[str(approval['id'])] = sequence
                self.messages[sequence] = message
                refresh.add(sequence)
                changed = True
        for sequence in refresh & self.messages.keys():
            self._refresh_segment(sequence)
            changed = True
        if older != self.older:
            self.older = older; changed = True
        if history_state != self.history_state:
            self.history_state = history_state; changed = True
        if history_complete != self.history_complete:
            self.history_complete = history_complete; changed = True
        if changed:
            self._index(anchor)

    def _anchor(self) -> Anchor | None:
        if self.following:
            return None
        if self.pending_anchor is not None:
            return self.pending_anchor
        if not self.display_starts:
            return None
        screen = self.top
        logical = bisect_right(self.display_starts, screen) - 1
        if logical < len(self.leading_rows) and self.order and self._review_anchor(logical) is None:
            screen = self.display_starts[self.starts[0]]
        last_visible = min(self.display_count - 1, self.top + self.height - 1)
        while screen < last_visible and not any(text.strip() for _, text, _ in self._screen_row(screen).fragments):
            screen += 1
        logical = bisect_right(self.display_starts, screen) - 1
        line = self.display_rows[logical][screen - self.display_starts[logical]]
        screen_offset = screen - self.top
        review = self._review_anchor(logical)
        if review:
            identifier, offset = review
            review_positions = self.review_positions[identifier]
            origin = logical - offset
            character = line.start + sum(sum(len(text) for _, text, _ in self._row(row))
                for row in range(origin + bisect_left(review_positions, review_positions[offset]), logical))
            return identifier, review_positions[offset], character, screen_offset
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
                return sequence, positions[offset] if positions else offset, character, screen_offset
        return None, logical, line.start, screen_offset

    def _review_start(self, identifier: str) -> int | None:
        location = self.review_offsets.get(identifier)
        if not location or self.plan_reviews[identifier]['anchor_sequence'] != location[0]:
            return None
        sequence, offset = location
        if not sequence:
            return None if self.older else offset
        index = bisect_left(self.order, sequence)
        return self.starts[index] + offset if sequence in self.messages else None

    def _review_anchor(self, logical: int) -> tuple[str, int] | None:
        segment = bisect_right(self.starts, logical) - 1
        sequence = self.order[segment] if segment >= 0 else 0
        for identifier in self.plans_at.get(sequence, ()):
            start = self._review_start(identifier)
            if start is not None and start <= logical < start + len(self.review_positions[identifier]):
                return identifier, logical - start
        return None

    def _index(self, anchor: Anchor | None = None) -> None:
        self.starts = []
        self.actions = []
        self.pending_count = 0
        self.leading_rows = []
        if self.older or self.history_complete:
            self.leading_rows.append(self.row({"loading": "正在加载更早消息…", "error": "历史暂不可用，恢复连接后继续加载"}.get(self.history_state,
                "已到最早消息" if self.history_complete else ""), "class:hint"))
        if not self.older:
            self.leading_rows.extend(self._maintenance_rows(0))
            self.leading_rows.extend(self._plan_rows(0, len(self.leading_rows)))
        self.actions.extend((action, offset) for offset, row in enumerate(self.leading_rows)
                            for _, _, action in row if action)
        count = len(self.leading_rows)
        for sequence in self.order:
            self.starts.append(count)
            rows = self.lines[sequence]
            approval = self.messages[sequence].get("approval")
            if approval and approval["state"] == "pending" and not approval.get("decision"):
                self.pending_count += 1
            self.actions.extend((action, count + offset) for action, offset in self.segment_actions[sequence])
            count += len(rows)
        self.count = max(1, count)
        self.dirty = True
        self.pending_anchor = None if self.following else anchor
        if self.selected and self.selected not in [action for action, _ in self.actions]:
            self.selected = None

    def _row(self, index: int) -> Row:
        if index < len(self.leading_rows):
            return self.leading_rows[index]
        segment = bisect_right(self.starts, index) - 1
        if segment >= 0:
            rows = self.lines[self.order[segment]]
            offset = index - self.starts[segment]
            if offset < len(rows):
                return rows[offset]
            index = offset - len(rows)
        else:
            index -= len(self.leading_rows)
        return self.row("")

    def _layout(self, width: int, height: int) -> None:
        width, height = max(1, width), max(1, height)
        anchor = self._anchor()
        if width != self.format_width:
            self.format_width=width
            if self.markdown:
                for task in tuple(self.markdown.tasks.values()):task.cancel()
                self.markdown.tasks.clear();self.pending_documents.clear()
            for sequence in self.order:
                if self.messages[sequence].get('kind') != 'approval' or self.plans_at.get(sequence):
                    self.bodies.pop(sequence,None)
                    self._refresh_segment(sequence)
            self._index(anchor)
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
                anchor_sequence, logical, character, screen_offset = anchor
                if isinstance(anchor_sequence, str) and (start := self._review_start(anchor_sequence)) is not None:
                    review_positions = self.review_positions[anchor_sequence]
                    offset = min(bisect_left(review_positions, logical), len(review_positions) - 1)
                    while offset + 1 < len(review_positions) and review_positions[offset + 1] == review_positions[offset]:
                        size = sum(len(text) for _, text, _ in self._row(start + offset))
                        if character < size:
                            break
                        character -= size
                        offset += 1
                    logical = start + offset
                elif isinstance(anchor_sequence, int) and anchor_sequence in self.messages:
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
                self.top = max(0, self.display_starts[logical] + part - screen_offset)
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
        bounds = self.selection_bounds()
        def line(index: int) -> StyleAndTextTuples:
            row = self._screen_row(index)
            logical = bisect_right(self.display_starts, index) - 1
            start, end = 0, 0
            if bounds and bounds[0][0] <= logical <= bounds[1][0]:
                start = bounds[0][1] if logical == bounds[0][0] else 0
                end = bounds[1][1] if logical == bounds[1][0] else sum(len(text) for _,text,_ in self._row(logical))
            fragments: StyleAndTextTuples = []
            offset = row.start
            for style,text,action in row.fragments:
                if focused and action and action == self.selected:
                    style += " class:approval.selected"
                if start < end and offset < end and offset+len(text) > start:
                    left, right = max(0,start-offset), min(len(text),end-offset)
                    selected_style = style + " class:text-selection"
                    if "class:sender.user" in style.split():
                        selected_style += " class:sender.user.selected"
                    elif "class:sender.assistant" in style.split():
                        selected_style += " class:sender.assistant.selected"
                    fragments.extend([(style,text[:left]),(selected_style,text[left:right]),(style,text[right:])])
                else:
                    fragments.append((style,text))
                offset += len(text)
            return [*fragments, ("", " ")]
        return UIContent(get_line=line, line_count=self.display_count, cursor_position=Point(x=0, y=self.top), show_cursor=False)

    def clear_selection(self) -> None:
        self.selection = self.drag_anchor = None

    def selection_bounds(self) -> tuple[tuple[int, int], tuple[int, int]] | None:
        if not self.selection:
            return None
        first, last = sorted(self.selection)
        def position(point: TextPoint) -> tuple[int, int]:
            sequence, row, offset = point
            return self.starts[bisect_left(self.order,sequence)] + row, offset
        return position(first), position(last)

    def selected_text(self) -> str:
        bounds = self.selection_bounds()
        if not bounds:
            return ""
        (first,start), (last,end) = bounds
        rows = ["".join(text for _,text,_ in self._row(index)) for index in range(first,last+1)]
        rows[-1] = rows[-1][:end]
        rows[0] = rows[0][start:]
        return "\n".join(rows)

    def text_point(self, position: Point) -> TextPoint | None:
        if not 0 <= position.y < self.display_count:
            return None
        logical = bisect_right(self.display_starts,position.y)-1
        segment = bisect_right(self.starts,logical)-1
        if segment < 0:
            return None
        sequence = self.order[segment]
        row = logical-self.starts[segment]
        text = "".join(value for _,value,_ in self._row(logical))
        offset = min(len(text),self._screen_row(position.y).start + position.x)
        boundary = max((i for i,_,_ in graphemes(text) if i<=offset),default=0) if offset < len(text) else offset
        return sequence,row,boundary

    def scroll(self, amount: int) -> None:
        self._layout(self.width, self.height)
        maximum = max(0, self.display_count - self.height)
        self.top = max(0, min(maximum, self.top + amount))
        self.following = self.top == maximum
        self.cursor = max(0, bisect_right(self.display_starts, self.top) - 1)
        self.selected = None
        if self.on_scroll:
            self.on_scroll(amount)
        get_app().invalidate()

    def page(self, direction: int) -> None:
        self.scroll(direction * max(1, self.height - 1))

    def follow_latest(self) -> None:
        self.following = True
        self.pending_anchor = None
        self.selected = None
        self._layout(self.width, self.height)
        get_app().invalidate()

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
        return self._focus_action(*self.actions[index])

    def focus_approval(self, identifier: str) -> bool:
        return next((self._focus_action(action, logical) for action, logical in self.actions
                     if action == (identifier, 'approval')), False)

    def approval(self, identifier: str) -> Json | None:
        sequence = self.approval_sequences.get(identifier)
        return self.messages[sequence]["approval"] if sequence is not None else None

    def reveal_approval(self, identifier: str) -> None:
        self._layout(self.width, self.height)
        sequence = self.approval_sequences.get(identifier)
        if sequence is not None:
            self._reveal(self.starts[bisect_left(self.order, sequence)])

    def reveal_plan(self, identifier: str) -> None:
        self._layout(self.width, self.height)
        logical = self._review_start(identifier)
        if logical is not None:
            self._reveal(logical)

    def _reveal(self, logical: int) -> None:
        maximum = max(0, self.display_count - self.height)
        self.top = min(self.display_starts[logical], maximum)
        self.following = self.top == maximum
        self.selected = None
        get_app().invalidate()

    def _focus_action(self, selected: tuple[str, str], logical: int) -> bool:
        self.selected = selected
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
        identifier, entry = action
        if identifier not in self.busy:
            self.open_review(identifier, entry)

    def refresh_approval(self, identifier: str) -> None:
        anchor = self._anchor()
        sequence = self.approval_sequences.get(identifier)
        if sequence is not None:
            self._refresh_segment(sequence)
        self._index(anchor)
        get_app().invalidate()

    def mouse_handler(self, mouse_event: MouseEvent) -> Any:
        if mouse_event.event_type in {MouseEventType.SCROLL_UP, MouseEventType.SCROLL_DOWN}:
            self.scroll(-3 if mouse_event.event_type == MouseEventType.SCROLL_UP else 3)
            return None
        if mouse_event.event_type == MouseEventType.MOUSE_DOWN:
            if self.selection_started:
                self.selection_started()
            self.mouse_button = mouse_event.button
            if mouse_event.button == MouseButton.RIGHT:
                self.drag_anchor = None
                return None
            if mouse_event.button == MouseButton.LEFT:
                self.clear_selection()
                self.selected = None
                self.drag_anchor = self.text_point(mouse_event.position)
                return None
        if mouse_event.event_type == MouseEventType.MOUSE_UP and self.mouse_button == MouseButton.RIGHT:
            self.mouse_button = MouseButton.NONE
            if self.copy_menu:
                self.copy_menu()
            return None
        if mouse_event.event_type in {MouseEventType.MOUSE_MOVE, MouseEventType.MOUSE_UP} and self.drag_anchor:
            if mouse_event.event_type == MouseEventType.MOUSE_MOVE and mouse_event.button != MouseButton.LEFT:
                return NotImplemented
            point = self.text_point(mouse_event.position)
            if point:
                self.selection = (self.drag_anchor, point) if point != self.drag_anchor else None
                if self.selection:
                    self.following = False
            if mouse_event.event_type == MouseEventType.MOUSE_MOVE:
                return None
            self.drag_anchor = None
            if self.selection:
                if self.selection_finished:
                    self.selection_finished()
                return None
        if mouse_event.event_type == MouseEventType.MOUSE_UP and self.mouse_button != MouseButton.RIGHT:
            if mouse_event.button == MouseButton.RIGHT or not 0 <= mouse_event.position.y < self.display_count:
                return NotImplemented
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
