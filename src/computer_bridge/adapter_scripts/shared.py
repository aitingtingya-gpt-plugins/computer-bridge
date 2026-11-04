"""Helpers for the shipped external scripts; not imported by the adapter module."""

import json
import sys
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, cast

import yaml

type Json = dict[str, Any]


def metadata(path: Path) -> Json:
    with path.open(encoding="utf-8", newline="") as source:
        if source.readline().strip() != "---":
            return {}
        header = []
        for line in source:
            if line.strip() == "---":
                break
            header.append(line)
    return cast(Json, yaml.safe_load("".join(header)) or {})


def skill_rows(directories: Iterable[Path]) -> list[Json]:
    rows: list[Json] = []
    for directory in directories:
        if not directory.is_dir():
            continue
        files = sorted({*directory.glob("*/SKILL.md"), *directory.glob("*.md")})
        for path in files:
            actual = path.resolve()
            attrs = metadata(actual)
            rows.append(
                {
                    "key": str(actual),
                    "name": attrs.get("name", path.parent.name if path.name == "SKILL.md" else path.stem),
                    "description": attrs.get("description", ""),
                    "locator": {"path": str(actual)},
                }
            )
    return rows


def original(locator: Json) -> Json:
    path = Path(locator["path"]).resolve(strict=True)
    with path.open(encoding="utf-8", newline="") as source:
        return {
            "path": str(path),
            "directory": str(path.parent),
            "text": source.read(),
            **({"selector": locator["selector"]} if "selector" in locator else {}),
        }


def main(discover: Callable[[Json], list[Json]]) -> None:
    request = json.load(sys.stdin)
    if request["protocol"] != 1:
        raise ValueError("unsupported adapter protocol")
    result = original(request["locator"]) if request["action"] == "read" else {"items": discover(request)}
    print(json.dumps({"protocol": 1, **result}, ensure_ascii=False))
