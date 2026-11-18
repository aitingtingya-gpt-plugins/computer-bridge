"""Download one complete conversation as an offline Markdown/attachment ZIP."""
from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import zipfile
from collections.abc import Callable
from datetime import datetime
from pathlib import Path, PureWindowsPath
from urllib.parse import quote, unquote, urlsplit

from markdown_it import MarkdownIt

from .chat_client import ChatClient
from .common import Error, Json


def _filename(value: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value).strip(' .')
    return name or 'conversation'


def export_filename(chat: Json) -> str:
    return _filename(str(chat.get('title') or '会话'))[:80] + '-' + str(chat['id']) + '-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.zip'


def _label(value: str) -> str:
    return value.replace('\\', '\\\\').replace('[', '\\[').replace(']', '\\]').replace('\n', ' ')


def _destination(url: str, chat_id: str, paths: dict[str, str], server: str) -> str | None:
    parsed = urlsplit(url)
    if parsed.netloc and (parsed.scheme, parsed.netloc) != (urlsplit(server).scheme, urlsplit(server).netloc):
        return None
    parts = [unquote(part) for part in parsed.path.split('/')]
    if len(parts) == 5 and parts[:3] == ['', 'chat', 'files'] and parts[3] == chat_id:
        return paths.get(parts[4])
    return None


def _rewrite_links(text: str, chat_id: str, paths: dict[str, str], server: str) -> str:
    """Keep original prose and code; replace only actual local attachment targets."""
    protected: list[tuple[int, int]] = []
    starts = [0]
    for match in re.finditer('\n', text):
        starts.append(match.end())
    starts.append(len(text))
    for token in MarkdownIt('commonmark').parse(text):
        if token.type in {'fence', 'code_block', 'html_block'} and token.map:
            protected.append((starts[token.map[0]], starts[min(token.map[1], len(starts) - 1)]))
    # Inline code may use any number of matching backticks.
    position = 0
    while position < len(text):
        found = re.search(r'`+', text[position:])
        if not found:
            break
        begin = position + found.start()
        marker = found.group()
        end_match = re.search(r'(?<!`)' + re.escape(marker) + r'(?!`)', text[begin + len(marker):])
        if end_match:
            end = begin + len(marker) + end_match.end()
            protected.append((begin, end))
            position = end
        else:
            position = begin + len(marker)
    pattern = re.compile(r'(?P<lead>!?\[[^\n]*?\]\(\s*<?)(?P<url>[^\s)>]+)(?=[>\s)]|$)|(?P<ref>^ {0,3}\[[^\]\n]+\]:\s*<?)(?P<refurl>[^\s>]+)', re.MULTILINE)
    def replace(match: re.Match[str]) -> str:
        if any(begin <= match.start() < end for begin, end in protected):
            return match.group()
        target = match.group('url') or match.group('refurl')
        result = _destination(target, chat_id, paths, server)
        return (match.group('lead') or match.group('ref')) + result if result else match.group()
    return pattern.sub(replace, text)


def _fence(value: str) -> str:
    size = max((len(match.group()) for match in re.finditer(r'`+', value)), default=0)
    marker = '`' * max(3, size + 1)
    return marker + '\n' + value + '\n' + marker


def _sender(message: Json) -> str:
    if message['role'] != 'assistant':
        return '用户'
    if title := ' '.join(str(message.get('task_title') or '').split()):
        return '任务 · ' + title
    if message.get('sender_role') == 'master':
        return 'Master'
    return 'Super Agent' if message.get('source') == 'module' else 'GPT / Dot'


def _message(message: Json, chat_id: str, paths: dict[str, str], server: str) -> str:
    sender = _sender(message)
    result = ['## ' + sender + ' · ' + str(message['id']) + ' · ' + str(message.get('created_at', '')), '']
    if message.get('text'):
        result.extend([_rewrite_links(str(message['text']), chat_id, paths, server), ''])
    approval = message.get('approval')
    if message.get('kind') == 'approval' and isinstance(approval, dict):
        result.extend(['### 命令审批', ''])
        for key, label in [('id', '审批编号'), ('device_name', '电脑'), ('cwd', '工作目录'), ('justification', '理由'), ('state', '状态'), ('decision', '决定'), ('delivery_pending', '决定等待送达'), ('expires_at', '有效期')]:
            if key in approval:
                result.extend(['**' + label + '**', '', str(approval[key]), ''])
        if 'command' in approval:
            result.extend(['**命令**', '', _fence(str(approval['command'])), ''])
    for attachment in message.get('attachments', []):
        identifier = str(attachment['id'])
        prefix = '!' if str(attachment.get('mime_type', '')).startswith('image/') else ''
        result.extend([prefix + '[' + _label(str(attachment['name'])) + '](' + paths[identifier] + ')', ''])
    return '\n'.join(result) + '\n---\n\n'


def _archive(folder: Path, output: Path) -> None:
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(folder.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(folder.parent))


async def _compress(folder: Path, output: Path) -> None:
    worker = asyncio.create_task(asyncio.to_thread(_archive, folder, output))
    try:
        await asyncio.shield(worker)
    except asyncio.CancelledError:
        # A running thread cannot be cancelled. Finish before removing its inputs.
        await worker
        raise


async def export_chat(client: ChatClient, chat_id: str, destination: Path,
                      progress: Callable[[str], None] | None = None) -> Json:
    destination = destination.expanduser().resolve()
    if destination.suffix.lower() != '.zip':
        raise Error('chat_export_path', '会话导出保存为 ZIP，请使用 .zip 文件名。')
    if destination.exists():
        raise Error('file_exists', '目标文件已存在，请指定新文件名：' + str(destination))
    def update(value: str) -> None:
        if progress:
            progress(value)
    chat = (await client.action('get', chat_id=chat_id))['chat']
    last = int(chat['message_count'])
    with tempfile.TemporaryDirectory(prefix='.bridge-export-', dir=destination.parent) as temporary:
        stage = Path(temporary)
        folder = stage / _filename(destination.stem)
        folder.mkdir()
        spool = stage / 'messages.jsonl'
        attachments: dict[str, Json] = {}
        count = cursor = 0
        with spool.open('w', encoding='utf-8') as output:
            while cursor < last:
                previous = cursor
                page = await client.action('history', chat_id=chat_id, after=cursor, limit=50)
                for message in page['messages']:
                    sequence = int(message['sequence'])
                    if sequence > last:
                        break
                    if sequence != count + 1:
                        raise Error('chat_export_history', '会话历史不完整，未生成导出文件。')
                    output.write(json.dumps(message, ensure_ascii=False) + '\n')
                    count = cursor = sequence
                    for item in message.get('attachments', []):
                        attachments[str(item['id'])] = item
                update(f'读取会话 · {count}/{last} 条')
                if cursor == previous:
                    raise Error('chat_export_history', '会话历史读取中断，未生成导出文件。')
        paths: dict[str, str] = {}
        if attachments:
            (folder / 'attachments').mkdir()
        for index, (identifier, attachment) in enumerate(attachments.items(), 1):
            name = identifier + '-' + _filename(PureWindowsPath(str(attachment['name'])).name)
            paths[identifier] = 'attachments/' + quote(name, safe='-._~')
            update(f'下载附件 · {index}/{len(attachments)} · {attachment["name"]}')
            await client.download(chat_id, identifier, folder / 'attachments' / name)
        update('生成 Markdown…')
        with (folder / 'conversation.md').open('w', encoding='utf-8', newline='\n') as output:
            output.write('# ' + str(chat['title']).replace('\n', ' ') + '\n\n')
            output.write('- 会话：' + chat_id + '\n- 电脑：' + str(chat['device_name']) + ' · ' + str(chat['device_id']) + '\n')
            output.write('- 导出时间：' + datetime.now().astimezone().isoformat(timespec='seconds') + '\n- 保存至消息：m' + str(last) + '\n\n---\n\n')
            with spool.open(encoding='utf-8') as source:
                for line in source:
                    output.write(_message(json.loads(line), chat_id, paths, client.server))
        update('压缩会话…')
        packed = stage / 'complete.zip'
        await _compress(folder, packed)
        # Exclusive creation also preserves another export that finishes first.
        try:
            os.link(packed, destination)
        except FileExistsError:
            raise Error('file_exists', '目标文件已存在，请指定新文件名：' + str(destination)) from None
    return {'path': str(destination), 'messages': count, 'attachments': len(attachments)}
