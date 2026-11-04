"""Hold the existing power setting while the one-time installer replaces its background entry."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .power import Power
from .update_control import helper_running


async def run(args: argparse.Namespace) -> None:
    settings = json.loads(args.config.read_text(encoding="utf-8"))
    power = Power(settings.get("lock_mode", {"enabled": True, "revision": 0}))
    try:
        await power.start()
        if power.setting["enabled"] and not power.applied:
            raise RuntimeError("无法接管防睡眠请求：" + power.error)
        print(json.dumps({"ready": True}), flush=True)
        while helper_running(args.parent) and not args.release.exists():
            await asyncio.sleep(0.25)
    finally:
        await power.close()
        args.release.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--parent", type=int, required=True)
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
