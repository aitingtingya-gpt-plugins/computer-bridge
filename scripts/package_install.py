"""One source-only ZIP: ordinary/optional Cloudflare server, Windows client, macOS client."""

from __future__ import annotations

import json
import shutil
import subprocess
import zipfile
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "local/source-install-build"
VERSION = runpy.run_path(str(ROOT / "src/computer_bridge/__init__.py"))["__version__"]
OUT = ROOT / f"dist/computer-bridge-{VERSION}-install.zip"


def main() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    folder = STAGE / f"computer-bridge-{VERSION}"
    folder.mkdir(parents=True)
    shutil.copyfile(ROOT / "源码安装说明.md", folder / "安装说明.md")
    shutil.copyfile(ROOT / "适配协议.md", folder / "适配协议.md")
    shutil.copyfile(ROOT / "docs/更新与模块协议.md", folder / "更新与模块协议.md")
    (folder / 'docs').mkdir()
    for name in ('chat.md','chat-terminal.md'):
        shutil.copyfile(ROOT / 'docs' / name, folder / 'docs' / name)
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(ROOT / name, folder / name)
    for system in ("windows", "macos"):
        client = folder / system
        shutil.copytree(
            ROOT / "src",
            client / "src",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules"),
        )
        for name in ("pyproject.toml", "constraints.txt", "LICENSE", "THIRD_PARTY_NOTICES.md"):
            shutil.copyfile(ROOT / name, client / name)
        shutil.copyfile(ROOT / "installers/source/install.py", client / "install.py")
        if system == "windows":
            for name, source in {
                "install-windows.ps1": ROOT / "installers/source/install-windows.ps1",
                "install.cmd": ROOT / "installers/install.cmd",
                "computer-bridge.cmd": ROOT / "installers/computer-bridge.cmd",
            }.items():
                text = source.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\n", "\r\n")
                (client / name).write_bytes(text.encode("utf-8-sig" if name.endswith(".ps1") else "ascii"))
        else:
            for name in ("install-macos.command", "computer-bridge.command"):
                shutil.copyfile(ROOT / "installers/source" / name, client / name)
                (client / name).chmod(0o755)
    server = folder / "server"
    shutil.copytree(ROOT / "gateway/src", server / "src", ignore=shutil.ignore_patterns("index-work-tree.ts"))
    shutil.copytree(ROOT / "gateway/licenses", server / "licenses")
    for name in (
        "build.mjs",
        "licenses.mjs",
        "LICENSE",
        "tsconfig.json",
        ".env.example",
        "Caddyfile.example",
        "Dockerfile",
        ".dockerignore",
        "wrangler.updater.example.jsonc",
    ):
        shutil.copyfile(ROOT / "gateway" / name, server / name)
    package = json.loads((ROOT / "gateway/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "gateway/package-lock.json").read_text(encoding="utf-8"))
    package["name"] = "computer-bridge-server"
    package["scripts"] = {
        "build": "node build.mjs",
        "start": "node --env-file=.env build/launcher.mjs",
        "check": "tsc --noEmit",
        "deploy:cloudflare": "npx --yes wrangler@4.154.0 deploy --config wrangler.example.jsonc",
    }
    package["devDependencies"].pop("wrangler", None)
    for group in ("dependencies", "devDependencies"):
        package[group] = {
            name: lock["packages"]["node_modules/" + name]["version"] for name in package[group]
        }
    (server / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    shutil.copyfile(ROOT / "gateway/package-lock.json", server / "package-lock.json")
    subprocess.run(
        ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd=server,
        check=True,
    )
    config = json.loads((ROOT / "gateway/wrangler.example.jsonc").read_text(encoding="utf-8"))
    config.update(name="computer-bridge", vars={"PUBLIC_URL": "https://bridge.example.com"}, routes=[])
    config["kv_namespaces"] = [{"binding": "OAUTH_KV", "id": "REPLACE_WITH_YOUR_KV_ID"}]
    (server / "wrangler.example.jsonc").write_text(json.dumps(config, indent=2) + "\n")
    OUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(STAGE))
    with zipfile.ZipFile(OUT) as archive:
        assert archive.testzip() is None
        assert not any(
            name.lower().endswith((".zip", ".whl", ".exe", ".dll", ".pyc")) for name in archive.namelist()
        )
        assert not any(name.endswith(("/.env", "/.dev.vars")) for name in archive.namelist())
    print(
        json.dumps(
            {
                "package": str(OUT),
                "bytes": OUT.stat().st_size,
                "sections": ["server", "windows", "macos"],
                "nested_archives": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
