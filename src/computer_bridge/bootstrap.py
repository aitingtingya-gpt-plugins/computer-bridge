"""One-time launcher installation carries explicit optional modules into the new environment."""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from .common import Error, Json, home, save
from .module_dependencies import pin
from .network import http_client
from .update_artifacts import download


async def main_async(args: argparse.Namespace) -> None:
    settings = json.loads((home() / "device.json").read_text(encoding="utf-8"))
    active_file = home() / "active.json"
    previous = json.loads(active_file.read_text(encoding="utf-8")).get("modules", {}) if active_file.exists() else {}
    modules: Json = dict(previous)
    sources = dict(settings.get("module_dependency_sources", {}))
    for value in args.dependency_source:
        key, source = value.split("=", 1)
        sources[key] = source
    wheels = list(args.module_wheel)
    missing = [name for name in settings.get("modules", []) if name not in modules]
    if missing and not wheels:
        async with http_client(settings) as http:
            response = await http.get(
                settings["server"] + "/device/bootstrap",
                headers={"Authorization": "Bearer " + settings["device_key"]},
            )
            if response.status_code == 404:
                raise Error(
                    "bootstrap_modules", "请先更新服务端，或用 --module-wheel 指定现有模块的独立安装包"
                )
            response.raise_for_status()
            for artifact in response.json()["artifacts"]:
                if artifact["module"] not in missing:
                    continue
                wheel = args.release / artifact["file"]
                await download(settings, artifact, wheel)
                modules[artifact["module"]] = {
                    "wheel": str(wheel),
                    "version": artifact["version"],
                    "dependencies": artifact.get("dependencies", []),
                }
    for item in wheels:
        source = Path(item).expanduser().resolve()
        target = args.release / source.name
        shutil.copyfile(source, target)
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", str(target)], check=True)
        with zipfile.ZipFile(target) as archive:
            metadata = next(name for name in archive.namelist() if name.endswith("/bridge-module.json"))
            definition = json.loads(archive.read(metadata))
            modules[definition["id"]] = {
                "wheel": str(target),
                "version": definition["version"],
                "dependencies": definition["dependencies"],
            }
    absent = set(settings.get("modules", [])) - set(modules)
    if absent:
        raise Error("bootstrap_modules", "缺少已启用模块的安装包：" + ", ".join(sorted(absent)))
    dependencies = {name for module in modules.values() for name in module.get("dependencies", [])}
    for name in dependencies:
        if name not in sources and Path(args.old_python).exists():
            code = (
                "import importlib.metadata,json;d=importlib.metadata.distribution("
                + repr(name)
                + ");print(d.read_text('direct_url.json') or '{}')"
            )
            result = subprocess.run([args.old_python, "-c", code], capture_output=True, text=True)
            if result.returncode == 0:
                source = json.loads(result.stdout).get("url")
                if source:
                    sources[name] = source
        if name not in sources:
            raise Error(
                "module_dependency", "需要保留模块依赖，请用 --dependency-source " + name + "=安装来源"
            )
        sources[name] = await pin(Path(sys.executable), home(), name, sources[name])
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "-c",
                str(args.source / "constraints.txt"),
                sources[name],
            ],
            check=True,
        )
    for module in modules.values():
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", module["wheel"]], check=True)
    settings["module_dependency_sources"] = sources
    save(home() / "device.json", settings)
    save(args.release / "modules.json", modules)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--old-python", required=True)
    parser.add_argument("--module-wheel", action="append", default=[])
    parser.add_argument("--dependency-source", action="append", default=[])
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
