"""The terminal's device settings use the same human API as the web chat."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit
from prompt_toolkit.widgets import Button, Dialog, Label, TextArea

from .chat_client import ChatClient
from .chat_dialogs import ChatDialogs, bind_keys, form_navigation
from .common import Json

MODES = {"allow": "直接允许", "ask": "使用前确认", "deny": "禁止调用"}


def access_status(view: Json) -> str:
    if view.get("access_error"):
        return "配置已保存 · " + str(view["access_error"])
    return "配置已应用" if view["applied_revision"] == view["access"]["revision"] else "已保存 · 等待电脑应用"


class DeviceSettings:
    def __init__(self, client: ChatClient, dialogs: ChatDialogs,
                 choose: Callable[..., Awaitable[str | None]], status: Callable[[str], None]):
        self.client, self.dialogs, self.choose, self.status = client, dialogs, choose, status

    async def view(self, device: str) -> Json:
        return await self.client.action("device-access", device_id=device)

    async def save(self, view: Json, action: str, **values: Any) -> Json:
        return await self.client.action("device-access-save", device_id=view["device_id"],
            expected_revision=view["access"]["revision"], action=action, **values)

    async def permissions(self, device: str) -> None:
        view = await self.view(device)
        access = view["access"]
        full = access["full_access"]
        rules = dict(access.get("tool_permissions", {}))
        supported = view["tool_permissions_supported"]
        title = "权限 · " + view["device_name"] + " · " + device
        selected: str | None = "full"
        while True:
            choices = [("full", "完全访问：" + ("开启" if full else "关闭"), ""),
                       ("save", "保存权限", ""), ("cancel", "取消", "")]
            if supported:
                choices += [(tool, tool + " · " + MODES[rules.get(tool, "allow")], "") for tool in view["tools"]]
            selected = await self.choose(title, choices, selected_id=selected, description=access_status(view)
                + ("\n完全访问和工具权限分别生效。" if supported else "\n请更新目标电脑以设置工具权限。"))
            if selected in (None, "cancel"):
                return
            if selected == "save":
                result = await self.save(view, "access", full_access=full,
                    **({"tool_permissions": rules} if supported else {}))
                self.status(access_status(result))
                return
            if selected == "full":
                mode = await self.choose("完全访问", [("on", "开启", ""), ("off", "关闭", "")],
                    selected_id="on" if full else "off")
                if mode is not None:
                    full = mode == "on"
            else:
                mode = await self.choose(selected, [(key, label, "") for key, label in MODES.items()],
                    selected_id=rules.get(selected, "allow"))
                if mode is not None:
                    rules[selected] = mode

    async def workspace_fields(self, workspace: Json) -> Json | None:
        result: asyncio.Future[Json | None] = asyncio.get_running_loop().create_future()
        name = TextArea(text=workspace.get("name", ""), multiline=False)
        path = TextArea(text=workspace.get("path", ""), multiline=False)
        additional = TextArea(text="\n".join(workspace.get("additional", [])), height=4, scrollbar=True)
        def finish(value: Json | None) -> None:
            if not result.done():
                result.set_result(value)
        keys = KeyBindings()
        keys.add("escape", eager=True)(lambda event: finish(None))
        multiline = KeyBindings()
        multiline.add("enter")(lambda event: additional.buffer.insert_text("\n"))
        for field in (name, path, additional):
            bind_keys(field.control, keys)
            if field is additional:
                bind_keys(field.control, multiline)
        save = Button("保存", handler=lambda: finish({"workspace_id":workspace.get("id", ""),
            "name":name.text.strip(), "path":path.text.strip(),
            "additional":[line.strip() for line in additional.text.splitlines() if line.strip()]}))
        cancel = Button("取消", handler=lambda: finish(None))
        for button in (save, cancel):
            bind_keys(button.control, keys)
        form_navigation([name, path, additional], [save, cancel], advance=True)
        dialog = Dialog(title="编辑工作区", body=HSplit([
            Label("名称"), name, Label("主工作区绝对路径"), path,
            Label("外部子工作区（每行一个路径）"), additional,
            Label("↑↓ 切字段；多行框内移动，首末显示行切出 · Tab/Shift+Tab 切换\n"
                  "←→ 编辑文字 / 切换按钮 · Enter 下一项 / 多行换行 / 按钮执行 · Esc 取消"),
        ]), buttons=[save, cancel], width=96)
        return await self.dialogs.present(dialog, name, result)

    async def workspaces(self, device: str) -> None:
        view = await self.view(device)
        title = "工作区 · " + view["device_name"] + " · " + device
        while True:
            workspaces = {workspace["id"]:workspace for workspace in view["access"]["workspaces"]}
            choice = await self.choose(title, [("add", "添加工作区", ""), *[
                (key, key+" · "+workspace["name"], workspace["path"]) for key,workspace in workspaces.items()
            ], ("close", "关闭", "")], description=access_status(view))
            if choice in (None, "close"):
                return
            workspace = workspaces.get(choice, {})
            if workspace:
                paths = [workspace.get("validation", {}).get("main", {}),
                         *workspace.get("validation", {}).get("additional", [])]
                description = "\n".join(str(item.get("path", ""))+" · "+
                    (item.get("error") or {"valid":"有效","pending":"待核验"}.get(item.get("state"),"未核验"))
                    for item in paths if item)
                action = await self.choose(workspace["name"]+" · "+choice, [
                    ("edit", "编辑名称和路径", ""), ("remove", "移除工作区", "保留本机目录"),
                    ("back", "返回", ""),
                ], description=description)
                if action == "remove":
                    confirmed = await self.choose("移除「"+workspace["name"]+"」", [
                        ("cancel", "取消", ""), ("remove", "移除配置", "保留本机目录"),
                    ])
                    if confirmed == "remove":
                        view = await self.save(view, "workspace_remove", workspace_id=choice)
                        self.status(access_status(view))
                    continue
                if action != "edit":
                    continue
            values = await self.workspace_fields(workspace)
            if values is None:
                continue
            saved = await self.save(view, "workspace_save", **values)
            if saved.get("confirmation"):
                confirmed = await self.choose("创建缺失目录", [("cancel", "取消", ""), ("create", "创建并保存", "")],
                    description="\n".join(saved["confirmation"]["missing"]))
                if confirmed != "create":
                    continue
                saved = await self.save(view, "workspace_save", **values, create_missing=True)
            view = saved
            self.status(access_status(view))
