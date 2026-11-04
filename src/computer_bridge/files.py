"""Original files with the same write-root policy as the native DSH sandbox."""

from __future__ import annotations

import base64
import mimetypes
import os
import shutil
from pathlib import Path

from .access import check_write, command_argv
from .common import Error, Json, uid
from .file_results import mutation_info, read_original
from .native_files import file_call, media_call


class LocalFiles:
    def __init__(
        self,
        root: Path,
        roots: list[Path] | None = None,
        node_path: str | None = None,
        grant_base: Path | None = None,
    ):
        self.root = root.expanduser().resolve()
        self.roots = roots
        self.node_path = node_path
        self.grant_base = grant_base

    def path(self, value: str) -> Path:
        path = Path(value).expanduser()
        return (path if path.is_absolute() else self.root / path).resolve()

    def display(self, path: Path) -> str:
        return str(path.relative_to(self.root)) if path.is_relative_to(self.root) else str(path)

    def apply(self, operation: str, args: Json) -> Json:
        path = self.path(args.get("path", "."))
        if operation in {"list", "glob", "search"}:
            result = file_call(operation, path, args, self.node_path)
            for entry in result["matches" if operation == "search" else "entries"]:
                entry["path"] = self.display(Path(entry["path"]))
            return result
        if operation == "read":
            if "line_offset" in args or "line_limit" in args:
                if any(key in args for key in ("offset", "length", "binary")):
                    raise Error("read_range", "行分页不能同时指定字节范围或 binary")
                return {"path": self.display(path), **file_call("read_lines", path, args, self.node_path)}
            return {"path": self.display(path), **read_original(
                path, offset=args.get("offset", 0), length=args.get("length"),
                binary=args.get("binary", False), version=args.get("version"), node_path=self.node_path,
            )}
        if operation == "write":
            check_write(path, self.roots)
            if "base64" not in args:
                file_call("write", path, args, self.node_path)
                return {"path": self.display(path), "written": path.stat().st_size,
                        **mutation_info(path, sha256=args.get("sha256", False))}
            data = (
                base64.b64decode(args["base64"], validate=True) if "base64" in args else args["text"].encode()
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + "." + uid("writing"))
            try:
                temporary.write_bytes(data)
                if path.exists():
                    temporary.chmod(path.stat().st_mode & 0o777)
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
            return {"path": self.display(path), "written": len(data),
                    **mutation_info(path, sha256=args.get("sha256", False))}
        if operation == "edit":
            check_write(path, self.roots)
            file_call("edit", path, args, self.node_path)
            return {"path": self.display(path), "written": path.stat().st_size,
                    **mutation_info(path, sha256=args.get("sha256", False))}
        if operation == "patch":
            import tempfile

            # Apply relative to the selected directory, without discovering a parent repository.
            # The actual Git process still runs under the existing kernel write policy.
            with tempfile.TemporaryDirectory(prefix="bridge-patch-") as patch_directory:
                argv = command_argv(
                    ["git", "--git-dir=" + str(Path(patch_directory) / "no-repository"),
                     "apply", "--no-index", "--whitespace=nowarn", "--numstat", "-z", "--apply", "-"],
                    self.roots,
                    Path(patch_directory),
                    self.node_path,
                    self.grant_base,
                )
                result = file_call("patch", path if path.is_dir() else path.parent,
                                   {"argv": argv, "patch": args["patch"]}, self.node_path)
            if result["exit_code"] != 0:
                raise Error("patch_failed", result["stderr"].strip())
            if not result["stdout"]:
                raise Error("patch_failed", "补丁未应用任何文件")
            return {"applied": True}
        if operation == "delete":
            check_write(path, self.roots)
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            return {"path": self.display(path), "deleted": True}
        if operation == "move":
            destination = self.path(args["destination"])
            check_write(path, self.roots)
            check_write(destination, self.roots)
            destination.parent.mkdir(parents=True, exist_ok=True)
            path.rename(destination)
            return {"path": self.display(destination)}
        raise Error("file_operation", operation)

    def image(self, value: str) -> Json:
        path = self.path(value)
        media = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return media_call({"operation": "image", "path": str(path), "media_type": media}, self.node_path)
