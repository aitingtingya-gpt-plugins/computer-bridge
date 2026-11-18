"""Cell-aware rendering for the read-only terminal startup dashboard."""
from __future__ import annotations

from unicodedata import category

from prompt_toolkit.formatted_text import FormattedText

from .chat_cells import display_width, graphemes


_HEADERS = (
    "class:header class:frame.label",
    "class:header",
    "class:header class:md.heading",
)


def _clean(value: str) -> str:
    # Preserve emoji joiners, but do not let names inject control or bidi marks.
    return " ".join("".join(c if c == "\u200d" or category(c) not in {"Cc", "Cf", "Cs"}
                            else " " for c in str(value or "")).split())


def _fit(value: str, width: int) -> str:
    value = _clean(value)
    if width <= 0:
        return ""
    if display_width(value) <= width:
        return value
    available = width - 1
    result = []
    for _, cluster, size in graphemes(value):
        if size > available:
            break
        result.append(cluster)
        available -= size
    return "".join(result).rstrip() + "…"


def _join(*values: str) -> str:
    return " · ".join(value for value in map(_clean, values) if value)


def render_dashboard(
    width: int,
    height: int,
    *,
    identity: str,
    device: str,
    system: str,
    connection: str,
    latency: str,
    chats: list[tuple[str, str, str, str, str, str]],
    chat_state: str,
    current: str,
    source: str,
    channel: str,
    latest: str,
    update: str,
    account_devices: list[tuple[str, str, str, str]] | None = None,
    account_device_status: str = "",
) -> FormattedText:
    """Render full-width section bands and bounded rows without terminal wrapping."""
    if width <= 0 or height <= 0:
        return FormattedText()

    lines: list[tuple[int | None, str, str]] = []
    framed = width >= 4
    body_width = width - (2 if framed else 0)
    pad = "  " if width >= 42 else " " if framed else ""
    inner = body_width - len(pad)
    boxes = framed and width >= 34 and height >= 15
    gap = int(boxes and height >= 22)
    box_rows = 3 + 2 * gap if boxes else 0

    def head(section: int, value: str) -> None:
        lines.append((section, _HEADERS[section], value))

    def field(value: str, style: str = "") -> None:
        lines.append((None, style, pad + _fit(value, inner)))

    def columns(values: tuple[str, ...], widths: tuple[int, ...]) -> None:
        fragments = []
        for value, size in zip(values, widths, strict=True):
            cell = _fit(value, size)
            fragments.append(cell + " " * (size - display_width(cell)))
        lines.append((None, "", pad + "  ".join(fragments)))

    chat_status = _clean(chat_state) or "暂无会话"
    version = _clean(current)
    available = _clean(latest)
    action = _clean(update)
    version_line = f"当前 {version}" if version else "当前版本未知"
    if available:
        version_line = _join(version_line, f"最新 {available}")
    can_update = "/update" in action
    verdict = "/update · 有更新" if can_update else action
    if version and available and version != available:
        builds = f"{version} → {available}" if can_update else f"本机 {version} · 源 {available}"
    elif version or available:
        builds = version or available
    else:
        builds = "版本未知"
    compact_action = "本机较新" if "本机版本高于" in action else action
    compact_version = (
        _join(compact_action, f"{version}/{available}") if compact_action == "本机较新"
        else _join(builds, "/update" if can_update else compact_action)
    )
    release_metadata = _join(f"渠道 {channel}" if channel else "", f"来源 {source}" if source else "")
    local_line = _join(device, system, connection, latency)
    managed_state = _clean(account_device_status) or "暂无账号设备"

    def managed_names(devices: list[tuple[str, str, str, str]], room: int) -> str:
        if not devices:
            return managed_state
        names = " / ".join(_clean(item[0]) or "未命名设备" for item in devices)
        if len(devices) <= 1 or display_width(names) <= room:
            return names
        total = f"{len(devices)} 台"
        return _join(_fit(names, room - display_width(total) - 3), total)

    if height < 6 or width < 34:
        if account_devices is not None:
            if height > 3:
                head(0, _join("设备", identity))
                field(managed_names(account_devices, inner), "class:metadata")
            else:
                heading = _join("设备", identity.split(" · ", 1)[0])
                room = body_width - (3 if framed else 0) - display_width(heading) - 3
                head(0, _join(heading, managed_names(account_devices, room)))
        elif height > 3:
            head(0, _join("状态", identity))
            field(_join(device, latency, system, connection), "class:metadata")
        else:
            head(0, _join("状态", identity.split(" · ", 1)[0], device))
        first = chats[0] if chats else None
        head(1, _join("会话", first[1], first[0]) if first else _join("会话", chat_status))
        if height > 4 and len(chats) > 1:
            field(_join(chats[1][1], chats[1][0]))
        if can_update and version and available and display_width(_join("更新", compact_version)) > body_width - 3:
            compact_version = f"{version}→{available} /update"
        head(2, _join("更新", compact_version))
    else:
        local_detail = height >= 9
        release_detail = height >= 9
        release_source = height >= 11 and bool(release_metadata)
        content_rows = height - 4 - int(release_detail) - int(release_source) - box_rows
        if account_devices is not None:
            head(0, _join("01  登录与设备", identity))
            keep_for_chat = 2 if height >= 8 and chats else 1
            account_rows = min(max(1, len(account_devices)), max(1, content_rows - keep_for_chat))
            if not account_devices:
                field(managed_state, "class:metadata")
            else:
                for index, (name, dev_system, state, delay) in enumerate(account_devices[:account_rows]):
                    if index == account_rows - 1 and account_rows < len(account_devices):
                        field(managed_names(account_devices[index:], inner))
                    else:
                        field(_join(name or "未命名设备", dev_system, state, delay))
            chat_rows = content_rows - account_rows
        else:
            head(0, "01  登录与本机")
            if local_detail:
                field(_join(identity, device))
                field(_join(system, connection, latency), "class:metadata")
            else:
                field(_join(identity, local_line))
            chat_rows = content_rows - 1 - int(local_detail)

        head(1, "02  会话")
        if width >= 96 and chat_rows >= 2 and chats:
            id_width, mode_width, state_width, device_width, activity_width = 7, 12, 8, 12, 16
            title_width = inner - 10 - id_width - mode_width - state_width - device_width - activity_width
            widths = (title_width, id_width, mode_width, state_width, device_width, activity_width)
            columns(("标题", "编号", "模式", "状态", "设备", "活动"), widths)
            for item in chats[:chat_rows - 1]:
                columns(item, widths)
        elif chats:
            for title, short_id, mode, state, chat_device, activity in chats:
                if not chat_rows:
                    break
                field(_join(short_id, title))
                chat_rows -= 1
                metadata = _join(mode, state, chat_device, activity)
                if chat_rows and metadata:
                    field(metadata, "class:metadata")
                    chat_rows -= 1
        else:
            field(chat_status, "class:metadata")

        head(2, "03  版本与更新")
        if release_detail:
            field(version_line)
            field(_join(verdict, f"渠道 {channel}" if channel and not release_source else ""), "class:metadata")
            if release_source:
                field(release_metadata, "class:metadata")
        else:
            field(compact_version)

    border = "bold"

    def rule(left: str, right: str, style: str = "", label: str = "") -> list[tuple[str, str]]:
        if not label:
            return [(border, left + "━" * body_width + right)]
        label = _fit(label, max(0, body_width - 3))
        if not label:
            return [(border, left + "━" * body_width + right)]
        return [
            (border, left + "━ "),
            (style, label),
            (border, " " + "━" * (body_width - display_width(label) - 3) + right),
        ]

    drawn: list[list[tuple[str, str]]] = []
    for index, (section, style, value) in enumerate(lines):
        if not framed:
            drawn.append([(style, _fit(value, width))])
        elif section is not None:
            if boxes and section:
                drawn.append(rule("┗", "┛"))
                if gap:
                    drawn.append([("", " " * width)])
            if boxes or section == 0:
                left, right = "┏", "┓"
            elif index == len(lines) - 1 and len(lines) >= height:
                left, right = "┗", "┛"
            else:
                left, right = "┣", "┫"
            drawn.append(rule(left, right, style, value))
        elif not boxes and index == len(lines) - 1 and len(lines) >= height:
            drawn.append(rule("┗", "┛", style, value))
        else:
            drawn.append([
                (border, "┃"),
                (style, value + " " * (body_width - display_width(value))),
                (border, "┃"),
            ])
    if framed and (boxes or len(drawn) < height):
        drawn.append(rule("┗", "┛"))

    result = FormattedText()
    for index, fragments in enumerate(drawn[:height]):
        if index:
            result.append(("", "\n"))
        result.extend(fragments)
    return result
