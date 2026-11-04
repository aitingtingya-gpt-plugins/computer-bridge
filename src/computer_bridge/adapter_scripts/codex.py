"""Codex reference adapter. No Codex process or model is started."""

import os
import tomllib
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .shared import Json, main, skill_rows
else:
    from shared import main, skill_rows


def discover(request: Json) -> list[Json]:
    context = request["context"]
    home = Path(os.environ.get("CODEX_HOME", str(Path(context["home"]) / ".codex")))
    projects = [Path(context["root"]), *map(Path, context["additional"])]
    if request["kind"] == "skill":
        return skill_rows(
            [
                *[p / ".agents/skills" for p in projects],
                Path(context["home"]) / ".agents/skills",
                home / "skills",
                Path("/etc/codex/skills"),
            ]
        )
    rows: dict[str, Json] = {}
    for base in [*[p / ".codex" for p in projects], home]:
        config = base / "config.toml"
        declared = tomllib.loads(config.read_text(encoding="utf-8")).get("agents", {}) if config.is_file() else {}
        files: list[tuple[Path, str | None, Json]] = [
            (p, None, {}) for p in sorted((base / "agents").glob("*.toml"))
        ]
        files += [
            (base / v["config_file"], k, v)
            for k, v in declared.items()
            if isinstance(v, dict) and "config_file" in v
        ]
        for path, name, declaration in files:
            attrs = tomllib.loads(path.read_text(encoding="utf-8"))
            name = attrs.get("name", name or path.stem)
            key = str(path.resolve())
            rows[key] = {
                "key": key,
                "name": name,
                "description": attrs.get("description", declaration.get("description", "")),
                "locator": {"path": key},
            }
    return list(rows.values())


if __name__ == "__main__":
    main(discover)
