"""Target-computer directory inspection. Inspection never creates a directory."""

from __future__ import annotations

import os
import re
from pathlib import Path

from .common import Json


def inspect_path(raw: str) -> Json:
    result: Json = {"path": raw, "state": "invalid", "creatable": False}
    try:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            raise ValueError("需要目标电脑上的绝对路径")
        if os.name == "nt":
            for part in path.parts[1:]:
                if (
                    re.search(r'[<>:"|?*\x00-\x1f]', part)
                    or part.endswith((".", " "))
                    or re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part)
                ):
                    raise ValueError("路径包含 Windows 不允许的目录名")
        path = path.resolve()
        result["path"] = str(path)
        try:
            path.stat()
        except FileNotFoundError:
            parent = path.parent
            while not parent.exists() and parent != parent.parent:
                parent = parent.parent
            if not parent.is_dir():
                raise ValueError("已有父路径不是目录") from None
            result.update(
                state="missing",
                creatable=os.access(parent, os.W_OK | os.X_OK),
                error="目录不存在",
            )
        else:
            if not path.is_dir():
                raise ValueError("路径不是目录")
            if not os.access(path, os.R_OK | os.X_OK):
                raise PermissionError("当前用户无法访问目录")
            result.update(state="valid", creatable=False)
    except (OSError, ValueError) as error:
        result["error"] = str(error)
    return result


def inspect_access(value: Json) -> Json:
    workspaces = []
    for entry in value.get("workspaces", []):
        main = inspect_path(entry["path"])
        additional = []
        seen = set()
        for raw in entry.get("additional", []):
            check = inspect_path(raw)
            path = Path(check["path"])
            root = Path(main["path"])
            if path == root or path.is_relative_to(root):
                check.update(
                    state="invalid",
                    creatable=False,
                    error="子工作区不能是主工作区自身或其下级目录",
                )
            if path not in seen:
                additional.append(check)
                seen.add(path)
        workspaces.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "path": main["path"],
                "additional": [p["path"] for p in additional],
                "validation": {"main": main, "additional": additional},
            }
        )
    return {
        "full_access": bool(value["full_access"]),
        "workspaces": workspaces,
        "revision": int(value.get("revision", 0)),
    }


def missing_directories(value: Json) -> list[str]:
    return list(
        dict.fromkeys(
            check["path"]
            for entry in value["workspaces"]
            for check in [entry["validation"]["main"], *entry["validation"]["additional"]]
            if check["state"] == "missing" and check["creatable"]
        )
    )


def create_directories(value: Json) -> Json:
    checked = inspect_access(value)
    for path in missing_directories(checked):
        Path(path).mkdir(parents=True, exist_ok=True)
    return inspect_access(value)


def usable_roots(entry: Json) -> list[Path]:
    checked = inspect_access({"full_access": False, "workspaces": [entry]})["workspaces"][0]
    main = checked["validation"]["main"]
    if main["state"] != "valid":
        from .common import Error

        raise Error("workspace_invalid", f"主工作区异常：{main['path']}：{main.get('error', '')}")
    return [
        Path(main["path"]),
        *[Path(p["path"]) for p in checked["validation"]["additional"] if p["state"] == "valid"],
    ]
