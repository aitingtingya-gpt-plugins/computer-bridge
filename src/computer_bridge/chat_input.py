"""Terminal-local newline decoding and visual-row input navigation.

The parser reuses prompt_toolkit's state machine with a private prefix cache;
neither its module-level sequence table nor an installed file is changed.
"""

from __future__ import annotations

import ctypes
import os
import re
import sys
from bisect import bisect_left, bisect_right
from collections.abc import Callable
from contextlib import contextmanager
from types import FunctionType, MethodType
from typing import Any

from prompt_toolkit.buffer import Buffer
from prompt_toolkit.input import create_input
from prompt_toolkit.input.base import Input
from prompt_toolkit.input.vt100_parser import Vt100Parser
from prompt_toolkit.key_binding.key_processor import KeyPress
from prompt_toolkit.keys import Keys
from prompt_toolkit.layout.screen import Char
from prompt_toolkit.output import Output

from .chat_attachments import _path_start
from .chat_cells import graphemes

if sys.platform != "win32":
    from prompt_toolkit.input.vt100 import Vt100Input


def local_apple_terminal(environment: dict[str, str], platform: str = sys.platform) -> bool:
    return platform == "darwin" and environment.get("TERM_PROGRAM") == "Apple_Terminal" and not any(
        environment.get(name) for name in ("SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "TMUX", "STY")
    )


class AppleShift:
    """Recover Shift for ambiguous input from the local Terminal.app only."""

    def __init__(self) -> None:
        self.read: Any = None
        if local_apple_terminal(dict(os.environ)):
            library = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
            self.read = library.CGEventSourceFlagsState
            self.read.argtypes = [ctypes.c_int32]
            self.read.restype = ctypes.c_uint64

    def __call__(self) -> bool:
        flags = int(self.read(0)) if self.read else 0
        # Do not turn Control/Option/Command combinations into Shift-only keys.
        return bool(flags & (1 << 17) and not flags & ((1 << 18) | (1 << 19) | (1 << 20)))


_NEWLINE_SEQUENCES = {
    "\x1b[27;2;13~": Keys.ControlJ,
    "\x1b[13;2u": Keys.ControlJ,
    "\x1b[13;2:1u": Keys.ControlJ,
    "\x1b[13;2:2u": Keys.ControlJ,
    "\x1b[13;2:3u": Keys.Ignore,
    "\x1b[13u": Keys.ControlM,
    "\x1b[13;1u": Keys.ControlM,
}
# These are decoded only when a terminal actually forwards the shortcut.
# Terminal.app owns Command+C and does not emit it to the PTY. Do not install
# a global key observer, change terminal preferences, or copy on selection.
_COPY_SEQUENCES = {
    "\x1b[99;9u": Keys.ControlInsert,       # Kitty / CSI-u Super+C
    "\x1b[99;9:1u": Keys.ControlInsert,
    "\x1b[99;9:2u": Keys.ControlInsert,
    "\x1b[99;9:3u": Keys.Ignore,
    "\x1b[99;6u": Keys.ControlInsert,       # Ctrl+Shift+C
    "\x1b[99;6:1u": Keys.ControlInsert,
    "\x1b[99;6:2u": Keys.ControlInsert,
    "\x1b[99;6:3u": Keys.Ignore,
    "\x1b[27;6;99~": Keys.ControlInsert,    # modifyOtherKeys
}
_PROTOCOL_REPLY = re.compile(r"\x1b\[\?(\d+)u")
_PROTOCOL_PREFIX = re.compile(r"\x1b\[\?\d*")
_APPLE_SHIFT_ARROWS = {
    "\x1b[A": Keys.ShiftUp,
    "\x1b[B": Keys.ShiftDown,
    "\x1bOA": Keys.ShiftUp,
    "\x1bOB": Keys.ShiftDown,
    "\x1b[C": Keys.ShiftRight,
    "\x1b[D": Keys.ShiftLeft,
    "\x1bOC": Keys.ShiftRight,
    "\x1bOD": Keys.ShiftLeft,
}


class NewlineParser(Vt100Parser):
    def __init__(self, callback: Callable[[KeyPress], None], shift: Callable[[], bool],
                 protocol: Callable[[], None]) -> None:
        from prompt_toolkit.input import vt100_parser

        self.shift, self.protocol = shift, protocol
        base_cache = vt100_parser._IsPrefixOfLongerMatchCache()

        class PrefixCache(dict[str, bool]):
            def __missing__(self, prefix: str) -> bool:
                result = (base_cache[prefix] or bool(_PROTOCOL_PREFIX.fullmatch(prefix))
                          or any(key.startswith(prefix) and key != prefix for key in (*_NEWLINE_SEQUENCES, *_COPY_SEQUENCES)))
                self[prefix] = result
                return result

        namespace = {**vars(vt100_parser), "_IS_PREFIX_OF_LONGER_MATCH_CACHE": PrefixCache()}
        generator = FunctionType(Vt100Parser._input_parser_generator.__code__, namespace)
        self.generator = MethodType(generator, self)
        super().__init__(callback)

    def _start_parser(self) -> None:
        self._escape_shift: bool | None = None
        self._input_parser = self.generator()
        next(self._input_parser)

    def _get_match(self, prefix: str) -> Any:
        if prefix == "\x1b" and self._escape_shift is None:
            # Snapshot when the escape sequence begins, before dispatch and
            # before a split read can arrive after the user releases Shift.
            # AppleShift is disabled for remote/multiplexed/non-Apple inputs.
            self._escape_shift = self.shift()
        if prefix in _NEWLINE_SEQUENCES:
            return _NEWLINE_SEQUENCES[prefix]
        if prefix in _COPY_SEQUENCES:
            return _COPY_SEQUENCES[prefix]
        if _PROTOCOL_REPLY.fullmatch(prefix):
            self.protocol()
            return Keys.Ignore
        if prefix in {"\r", "\x1b\r"} and self.shift():
            return Keys.ControlJ
        if prefix in _APPLE_SHIFT_ARROWS and self._escape_shift:
            return _APPLE_SHIFT_ARROWS[prefix]
        return super()._get_match(prefix)

    def _call_handler(self, key: str | Keys | tuple[Keys, ...], insert_text: str) -> None:
        # Never keep a modifier snapshot after this sequence, including an
        # Escape timeout, a protocol response, or entering bracketed paste.
        self._escape_shift = None
        super()._call_handler(key, insert_text)


def windows_shift_enter(event: Any) -> bool:
    state = int(event.ControlKeyState)
    return bool(event.KeyDown and event.VirtualKeyCode == 13 and state & 0x10 and not state & 0x0F)


class KeyboardInput:
    def __init__(self) -> None:
        self.output: Output | None = None
        self.query_pending = self.pushed = False
        self.shift = AppleShift()
        self.input = create_input()
        if sys.platform == "win32":
            self._windows(self.input)
        elif isinstance(self.input, Vt100Input):
            target = self.input
            target.vt100_parser = self.parser(lambda key: target._buffer.append(key))
        # Some hosts insert a dropped filename as a plain input batch instead
        # of using paste brackets. Preserve that input boundary for the editor.
        terminal: Any = self.input
        read_keys = terminal.read_keys
        def read() -> list[KeyPress]:
            keys: list[KeyPress] = read_keys()
            size = 0
            while size < len(keys) and len(keys[size].key) == 1:
                size += 1
            if size > 1:
                data = "".join(key.data for key in keys[:size])
                if _path_start(data.lstrip()):
                    return [KeyPress(Keys.BracketedPaste, data), *keys[size:]]
            return keys
        terminal.read_keys = read

    def parser(self, callback: Callable[[KeyPress], None]) -> NewlineParser:
        return NewlineParser(callback, self.shift, self.supported)

    def _windows(self, target: Input) -> None:
        from ctypes import windll  # type: ignore[attr-defined]
        from ctypes.wintypes import DWORD

        from prompt_toolkit.input.win32 import (  # type: ignore[attr-defined]
            ConsoleInputReader,
            raw_mode,
        )

        class NativeRawMode(raw_mode):  # type: ignore[misc]
            def _patch(self) -> None:
                super()._patch()
                mode = DWORD()
                windll.kernel32.GetConsoleMode(self.handle, ctypes.byref(mode))
                # Conhost's VT input conversion erases Shift+Return's VK and
                # modifier bits. PTK's native reader needs the original records.
                windll.kernel32.SetConsoleMode(self.handle, DWORD(mode.value & ~0x0200))

        class NativeReader(ConsoleInputReader):  # type: ignore[misc]
            def _event_to_key_presses(self, event: Any) -> list[KeyPress]:
                # The inherited Ctrl+Enter mapping also prefixes Ctrl+J with
                # Escape. Preserve Ctrl+J as the explicit newline fallback.
                if windows_shift_enter(event) or (event.VirtualKeyCode == 0x4A
                        and event.ControlKeyState & 0x0C and not event.ControlKeyState & 0x03
                        and event.uChar.UnicodeChar == "\n"):
                    return [KeyPress(Keys.ControlJ, "\n")]
                return list(super()._event_to_key_presses(event))

        # These objects belong only to this TUI's input instance.
        console: Any = target
        console.console_input_reader.close()
        console._use_virtual_terminal_input = False
        console.console_input_reader = NativeReader()
        console.raw_mode = lambda: NativeRawMode()
        handle = console.console_input_reader.handle
        original = DWORD()
        if not windll.kernel32.GetConsoleMode(handle, ctypes.byref(original)):
            raise OSError("无法读取终端输入模式")
        self._console_handle = handle
        self._console_original = original.value

        @contextmanager
        def cooked_mode():
            prior = DWORD()
            if not windll.kernel32.GetConsoleMode(handle, ctypes.byref(prior)):
                raise OSError("无法读取终端输入模式")
            if not windll.kernel32.SetConsoleMode(handle, DWORD(original.value)):
                raise OSError("无法暂停终端输入模式")
            try:
                yield
            finally:
                windll.kernel32.SetConsoleMode(handle, prior)
        console.cooked_mode = cooked_mode

    def bind_output(self, output: Output) -> None:
        """Pair this NativeReader with this output, never patch PTK globally."""
        if sys.platform != "win32" or not hasattr(self, "_console_handle"):
            return
        from ctypes import windll
        from ctypes.wintypes import DWORD
        enable, disable = output.enable_mouse_support, output.disable_mouse_support
        def mode(enabled: bool) -> None:
            value = DWORD()
            if not windll.kernel32.GetConsoleMode(self._console_handle, ctypes.byref(value)):
                raise OSError("无法读取终端鼠标模式")
            value.value = (value.value | 0x90) & ~0x40 if enabled else value.value & ~0x10
            if not windll.kernel32.SetConsoleMode(self._console_handle, value):
                raise OSError("无法设置终端鼠标模式")
        def enable_mouse() -> None:
            enable()
            mode(True)
        def disable_mouse() -> None:
            disable()
            mode(False)
        output.enable_mouse_support = enable_mouse
        output.disable_mouse_support = disable_mouse

    def start(self, output: Output) -> None:
        self.output = output
        if sys.platform != "win32" and isinstance(self.input, Vt100Input) and self.input.stdin.isatty():
            self.query_pending = True
            output.write_raw("\x1b[?u")
            output.flush()

    def supported(self) -> None:
        if self.query_pending and self.output:
            self.query_pending = False
            self.output.write_raw("\x1b[>1u")
            self.output.flush()
            self.pushed = True

    def close(self) -> None:
        self.query_pending = False
        if self.pushed and self.output:
            self.output.write_raw("\x1b[<u")
            self.output.flush()
            self.pushed = False
        self.input.close()


class InputNavigator:
    """Navigate the same displayed rows as the input window, without history recall."""

    def __init__(self, buffer: Buffer, columns: Callable[[], int], prompt: str = "") -> None:
        self.buffer, self.columns, self.prompt = buffer, columns, prompt
        self.preferred: int | None = None
        self.moving = False
        self.key: tuple[str, int] | None = None
        self.positions: dict[int, tuple[int, int]] = {}
        self.rows: list[list[tuple[int, int]]] = []
        buffer.on_cursor_position_changed += self.cursor_changed
        buffer.on_text_changed += self.cursor_changed

    def cursor_changed(self, _: Buffer) -> None:
        if not self.moving:
            self.preferred = None

    def layout(self) -> None:
        text, columns = self.buffer.text, max(1, self.columns())
        if self.key == (text, columns):
            return
        self.key = text, columns
        self.preferred = None
        positions: dict[int, tuple[int, int]] = {}
        row = offset = 0
        for line_number, line in enumerate(text.split("\n")):
            column = sum(Char(char).width for char in self.prompt) if line_number == 0 else 0
            for local, cluster, _ in graphemes(line):
                # Match prompt_toolkit's actual screen-cell representation of
                # controls and tabs while keeping grapheme boundaries intact.
                size = sum(Char(char).width for char in cluster)
                if column + size > columns:
                    row += 1
                    column = 0
                positions[offset + local] = row, column
                column += size
            # BufferControl appends one cursor space to every logical line.
            if column >= columns:
                row += 1
                column = 0
            positions[offset + len(line)] = row, column
            offset += len(line) + 1
            row += 1
        indices = {value: index for index, value in enumerate(sorted({y for y, _ in positions.values()}))}
        self.positions = {source: (indices[y], x) for source, (y, x) in positions.items()}
        self.rows = [[] for _ in indices]
        for source, (y, x) in self.positions.items():
            self.rows[y].append((source, x))

    def move(self, direction: int, count: int = 1) -> None:
        self.layout()
        source = max(position for position in self.positions if position <= self.buffer.cursor_position)
        row, column = self.positions[source]
        if self.preferred is None:
            self.preferred = column
        preferred = self.preferred
        target_row = row + direction * count
        if target_row < 0:
            target = 0
            self.preferred = self.positions[target][1]
        elif target_row >= len(self.rows):
            target = len(self.buffer.text)
            self.preferred = self.positions[target][1]
        else:
            choices = self.rows[target_row]
            target = min(choices, key=lambda pair: (abs(pair[1] - preferred), pair[1] > preferred))[0]
        self.moving = True
        try:
            self.buffer.cursor_position = target
        finally:
            self.moving = False

    def select(self, direction: int, count: int = 1) -> None:
        """Start/extend Shift selection using the same wrapped rows as arrows.

        PTK's default Shift+Up/Down uses logical lines. On a wrapped single
        logical line it cannot move, so it immediately drops a new selection.
        Keep the normal shift-mode replacement and anchor semantics while
        moving by our displayed rows instead.
        """
        if not self.buffer.text:
            return
        if self.buffer.selection_state is None:
            self.buffer.start_selection()
        selection = self.buffer.selection_state
        if selection is not None:
            selection.enter_shift_mode()
            self.move(direction, count)
            if self.buffer.cursor_position == selection.original_cursor_position:
                self.buffer.exit_selection()

    def horizontal(self, direction: int, count: int = 1, *, selecting: bool = False) -> None:
        """Move through graphemes and newlines, independent of visual wraps."""
        buffer = self.buffer
        if selecting and buffer.selection_state is None:
            buffer.start_selection()
        selection = buffer.selection_state
        if selecting and selection is not None:
            selection.enter_shift_mode()
        elif not selecting:
            buffer.exit_selection()
        boundaries = [offset for offset, _, _ in graphemes(buffer.text)] + [len(buffer.text)]
        cursor = buffer.cursor_position
        index = (bisect_left(boundaries, cursor) - count if direction < 0
                 else bisect_right(boundaries, cursor) + count - 1)
        buffer.cursor_position = boundaries[max(0, min(len(boundaries) - 1, index))]
        if selecting and selection is not None and buffer.cursor_position == selection.original_cursor_position:
            buffer.exit_selection()
