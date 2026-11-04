"""DSH reference adapter: skills and declarative Agent Presets, original files only."""

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

if TYPE_CHECKING:
    from .shared import Json, main, skill_rows
else:
    from shared import main, skill_rows


def discover(request: Json) -> list[Json]:
    context = request["context"]
    user = Path(context["home"])
    home = Path(os.environ.get("DSH_HOME", str(user / ".dsh")))
    projects = [Path(context["root"]), *map(Path, context["additional"])]
    files = {home / "cordis.yml", home / "cordis.patch.yml"}
    files.update(home.glob("profiles/*/cordis.yml"))
    files.update(home.glob("profiles/*/cordis.patch.yml"))
    for project in projects:
        files.update((project / ".dsh").glob("**/*.yml"))
    rows: list[Json] = []
    custom: list[Path] = []

    def visit(node: Any, path: Path, selector: list[str | int]) -> None:
        if isinstance(node, yaml.MappingNode):
            fields = {k.value: v for k, v in node.value}
            name = fields.get("name")
            config = fields.get("config")
            if (
                name
                and name.value == "@deepseek-ai/dsh-skill-filesystem"
                and isinstance(config, yaml.MappingNode)
            ):
                values = {k.value: v for k, v in config.value}
                dirs = values.get("customSkillDirs")
                if isinstance(dirs, yaml.SequenceNode):
                    for value in dirs.value:
                        if value.tag == "tag:yaml.org,2002:str":
                            raw = Path(value.value).expanduser()
                            custom.append(raw if raw.is_absolute() else Path(context["root"]) / raw)
                bundled = values.get("bundledSkillDir")
                if bundled and bundled.tag == "tag:yaml.org,2002:str":
                    custom.append(Path(bundled.value).expanduser())
            if (
                name
                and name.value == "@deepseek-ai/dsh-agent-preset"
                and isinstance(config, yaml.MappingNode)
            ):
                values = {k.value: v for k, v in config.value}
                identity = values["id"].value
                rows.append(
                    {
                        "key": str(path.resolve()) + "#" + identity,
                        "name": values.get("name", values["id"]).value,
                        "description": values["description"].value if "description" in values else "",
                        "locator": {"path": str(path.resolve()), "selector": identity},
                    }
                )
            for key, value in fields.items():
                visit(value, path, selector + [key])
        elif isinstance(node, yaml.SequenceNode):
            for index, value in enumerate(node.value):
                visit(value, path, selector + [index])

    for path in sorted(files):
        if path.is_file():
            visit(yaml.compose(path.read_text(encoding="utf-8")), path, [])
    if request["kind"] == "skill":
        return skill_rows(
            [
                *[p / ".dsh/skills" for p in projects],
                *[p / ".agents/skills" for p in projects],
                *custom,
                home / "skills",
                user / ".agents/skills",
            ]
        )
    return rows


if __name__ == "__main__":
    main(discover)
