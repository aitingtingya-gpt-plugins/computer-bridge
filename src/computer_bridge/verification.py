"""Human-run native sandbox check using disposable real directories and processes."""

from __future__ import annotations

import json
import os
import platform
import shlex
import shutil
import sys
from pathlib import Path

from . import __version__
from .cli import setup
from .common import Error, Json, home, uid
from .service import Computer


async def verify() -> Json:
    directory = home() / "verification" / uid("check")
    for name in ["main", "extra", "outside"]:
        (directory / name).mkdir(parents=True)
    config = directory / "device.json"
    setup(config, "http://verification.invalid", "local-verification")
    original_config = home() / "device.json"
    if original_config.is_file():
        data = json.loads(config.read_text(encoding="utf-8"))
        data["native_node"] = json.loads(original_config.read_text(encoding="utf-8")).get("native_node")
        config.write_text(json.dumps(data), encoding="utf-8")
    computer = Computer(config)
    try:
        await computer.execute(
            "computer.configure",
            {
                "access": {
                    "full_access": False,
                    "revision": 1,
                    "workspaces": [
                        {
                            "id": "w1",
                            "name": "verification",
                            "path": str(directory / "main"),
                            "additional": [str(directory / "extra")],
                        }
                    ],
                }
            },
        )
        session = (await computer.execute("computer.open", {"workspace_id": "w1"}))["session"]
        for name in ["main", "extra"]:
            await computer.execute(
                "computer.files",
                {
                    "session": session,
                    "operation": "write",
                    "payload": {
                        "path": str(directory / name / "sample.txt"),
                        "text": "Computer Bridge 原始字节",
                    },
                },
            )
        denied = False
        try:
            await computer.execute(
                "computer.files",
                {
                    "session": session,
                    "operation": "write",
                    "payload": {"path": str(directory / "outside/forbidden.txt"), "text": "no"},
                },
            )
        except Error as error:
            if error.code != "FS_SANDBOX_DENIED":
                raise
            denied = True
        if not denied or (directory / "outside/forbidden.txt").exists():
            raise Error("verification_files", "文件工具没有拒绝测试目录外写入")
        code = f"from pathlib import Path; Path({str(directory / 'outside/native.txt')!r}).write_text('no')"
        if os.name == "nt":
            command = "& '" + sys.executable.replace("'", "''") + "' -c '" + code.replace("'", "''") + "'"
        else:
            command = shlex.join([sys.executable, "-c", code])
        started = await computer.execute("computer.exec", {"session": session, "command": command})
        result = await computer.execute(
            "computer.wait", {"session": session, "operation": started["operation"], "seconds": 30}
        )
        if result["state"] != "completed":
            raise Error("verification_process", f"测试命令未完成：{result}")
        stderr_text = Path(result["result"]["stderr_path"]).read_text(errors="replace", encoding="utf-8")
        if (
            result["result"]["exit_code"] == 0
            or "PermissionError" not in stderr_text
            or (directory / "outside/native.txt").exists()
        ):
            raise Error("verification_sandbox", f"原生沙盒未通过越界写入验收：{stderr_text}")
        return {
            "version": __version__,
            "system": platform.system(),
            "passed": True,
            "real_files": True,
            "external_subworkspace": True,
            "file_write_denied": True,
            "native_process_write_denied": True,
            "production_configuration_changed": False,
        }
    finally:
        await computer.execute(
            "computer.configure", {"access": {"full_access": False, "workspaces": [], "revision": 2}}
        )
        await computer.close()
        shutil.rmtree(directory)
