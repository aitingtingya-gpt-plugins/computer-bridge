"""Build independent, checksummed release components from this checkout."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import runpy
import shutil
import subprocess
import sys
import tomllib
import zipfile
from packaging.version import Version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def archive(source: Path, output: Path) -> None:
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                package.write(path, path.relative_to(source))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-version")
    args = parser.parse_args()
    version = runpy.run_path(str(ROOT / "src/computer_bridge/__init__.py"))["__version__"]
    python_version = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    if str(Version(python_version)) != python_version or Version(python_version) != Version(version):
        raise ValueError("Python metadata must use the normalized public component version")
    release_version = args.release_version or version
    output = ROOT / "dist" / ("release-" + release_version)
    output.mkdir(parents=True, exist_ok=True)
    stage = ROOT / "local" / ("release-build-" + release_version)
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    subprocess.run(["node", "build-chat.mjs"], cwd=ROOT / "gateway", check=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT / "src/computer_bridge/native", check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/source_integrity.py")], check=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT / "gateway", check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/package_install.py")], check=True)
    shutil.copyfile(
        ROOT / f"dist/computer-bridge-{version}-install.zip",
        output / f"computer-bridge-{version}-install.zip",
    )
    client = stage / "client"
    shutil.copytree(
        ROOT / "src", client / "src", ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules")
    )
    for name in ("pyproject.toml", "constraints.txt", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(ROOT / name, client / name)
    client_zip = output / f"computer-bridge-client-{version}.zip"
    archive(client, client_zip)
    server = stage / "server"
    shutil.copytree(ROOT / "gateway/build", server / "build")
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(ROOT / name, server / name)
    package = {
        "name": "computer-bridge-server-runtime",
        "version": version,
        "private": True,
        "type": "module",
        "engines": {"node": ">=24"},
        "dependencies": {"ws": "8.21.0"},
    }
    (server / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    subprocess.run(
        ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd=server,
        check=True,
    )
    server_zip = output / f"computer-bridge-server-node-{version}.zip"
    archive(server, server_zip)
    updater = stage / "updater"
    for name in ("computer", "node", "cloudflare"):
        (updater / name).mkdir(parents=True)
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(ROOT / name, updater / name)
    shutil.copyfile(ROOT / "src/computer_bridge/launcher.py", updater / "computer/launcher.py")
    shutil.copyfile(ROOT / "gateway/build/launcher.mjs", updater / "node/launcher.mjs")
    subprocess.run(
        [
            str(ROOT / "gateway/node_modules/.bin/esbuild"),
            str(ROOT / "gateway/src/update_worker.ts"),
            "--bundle",
            "--platform=neutral",
            "--format=esm",
            "--external:cloudflare:workers",
            "--metafile=" + str(stage / "updater-meta.json"),
            "--outfile=" + str(updater / "cloudflare/worker.mjs"),
        ],
        cwd=ROOT / "gateway",
        check=True,
    )
    def licenses(path: Path, metafile: Path, base: Path = ROOT / "gateway") -> None:
        subprocess.run([
            "node", "--input-type=module", "-e",
            "import {readFile} from 'node:fs/promises';"
            "import {appendLicenses} from './licenses.mjs';"
            "await appendLicenses(process.argv[1],JSON.parse(await readFile(process.argv[2],'utf8')),process.argv[3])",
            str(path), str(metafile), str(base),
        ], cwd=ROOT / "gateway", check=True)

    licenses(updater / "cloudflare/worker.mjs", stage / "updater-meta.json")
    updater_config = json.loads((ROOT / "gateway/wrangler.updater.example.jsonc").read_text(encoding="utf-8"))
    updater_config["main"] = "worker.mjs"
    (updater / "cloudflare/wrangler.jsonc").write_text(json.dumps(updater_config, indent=2), encoding="utf-8")
    (updater / "README.md").write_text(
        "# Computer Bridge update executors\n\n"
        "The main installer bootstraps the computer launcher. Node deployments start build/launcher.mjs; "
        "preserve DATA_DIR when replacing an installation. Cloudflare uses the independent Worker and "
        "private TARGET/UPDATER service bindings described in the update protocol. "
        "These files contain no credentials or project data. Stop the corresponding executor before "
        "manually replacing its launcher; do not replace a running update task.\n",
        encoding="utf-8",
    )
    updater_zip = output / f"computer-bridge-updater-{version}.zip"
    archive(updater, updater_zip)
    for label, entry in (("base", "index.ts"), ("work-tree", "index-work-tree.ts")):
        config = json.loads((ROOT / "gateway/wrangler.example.jsonc").read_text(encoding="utf-8"))
        config.update(main=str(ROOT / "gateway/src" / entry))
        config["kv_namespaces"][0]["id"] = "0" * 32
        path = stage / (label + ".json")
        path.write_text(json.dumps(config), encoding="utf-8")
        subprocess.run(
            [
                str(ROOT / "gateway/node_modules/.bin/wrangler"),
                "deploy",
                "--dry-run",
                "--config",
                str(path),
                "--outdir",
                str(stage / label),
                "--metafile",
                str(stage / (label + "-meta.json")),
            ],
            cwd=ROOT / "gateway",
            check=True,
        )
        built = stage / label / (entry.removesuffix(".ts") + ".js")
        shutil.copyfile(built, output / f"computer-bridge-cloudflare-{label}-{version}.mjs")
        licenses(output / f"computer-bridge-cloudflare-{label}-{version}.mjs", stage / (label + "-meta.json"), stage)
    module_file = output / f"computer-bridge-work-tree-server-{version}.mjs"
    subprocess.run(
        [
            str(ROOT / "gateway/node_modules/.bin/esbuild"),
            str(ROOT / "modules/work-tree/server/index.ts"),
            "--bundle",
            "--platform=neutral",
            "--format=esm",
            "--metafile=" + str(stage / "module-meta.json"),
            "--outfile=" + str(module_file),
        ],
        check=True,
    )
    licenses(module_file, stage / "module-meta.json")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "build",
            "--wheel",
            "--outdir",
            str(output),
            str(ROOT / "modules/work-tree/client"),
        ],
        check=True,
    )
    wheel = output / f"computer_bridge_work_tree-{Version(version)}-py3-none-any.whl"
    artifacts = []

    def add(path: Path, identity: str, target: str, modules: list[str], module: str | None = None) -> None:
        record = {
            "id": identity,
            "target": target,
            "version": version,
            "file": path.name,
            "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
            "size": path.stat().st_size,
            "platform": "any",
            "modules": modules,
            "requires": {"protocol": 1},
        }
        if module:
            record.update(module=module)
            record["requires"].update(core=f">=0.1.4 <={version}", module_api=1)
        if target == "module-client":
            record["dependencies"] = ["work-tree"]
        artifacts.append(record)

    add(client_zip, "client", "client", [])
    add(server_zip, "server-node", "server-node", [])
    add(updater_zip, "updater", "updater", [])
    add(output / f"computer-bridge-cloudflare-base-{version}.mjs", "cloudflare-base", "server-cloudflare", [])
    add(
        output / f"computer-bridge-cloudflare-work-tree-{version}.mjs",
        "cloudflare-work-tree",
        "server-cloudflare",
        ["work-tree"],
    )
    add(wheel, "work-tree-client", "module-client", ["work-tree"], "work-tree")
    add(module_file, "work-tree-server", "module-server", ["work-tree"], "work-tree")
    revision = os.environ.get("GITHUB_SHA") or os.environ.get("COMPUTER_BRIDGE_SOURCE_REVISION")
    if not revision and (ROOT / ".git").exists():
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    manifest = {
        "format": 1,
        "version": release_version,
        "protocol": {"min": 1, "max": 1},
        "artifacts": artifacts,
        **({"source_commit": revision} if revision else {}),
    }
    (output / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    resources = sorted(path for path in output.iterdir() if path.is_file() and path.name != "SHA256SUMS")
    (output / "SHA256SUMS").write_text(
        "".join(hashlib.sha256(path.read_bytes()).hexdigest() + "  " + path.name + "\n" for path in resources),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {"release": release_version, "directory": str(output), "assets": len(list(output.iterdir()))}
        )
    )


if __name__ == "__main__":
    main()
