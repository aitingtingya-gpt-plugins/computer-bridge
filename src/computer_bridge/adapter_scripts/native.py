"""Reference .work script; importing/discovering it creates no project directories."""

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .shared import Json, main, metadata, skill_rows
else:
    from shared import main, metadata, skill_rows


def discover(request: Json) -> list[Json]:
    context = request["context"]
    roots = [Path(context["root"]), *map(Path, context["additional"]), Path(context["home"])]
    if request["kind"] == "skill":
        return skill_rows([p / ".work/skills" for p in roots])
    rows = []
    for root in roots:
        for path in sorted((root / ".work/agents").glob("*.md")):
            attrs = metadata(path)
            rows.append(
                {
                    "key": str(path.resolve()),
                    "name": attrs.get("name", path.stem),
                    "description": attrs.get("description", ""),
                    "locator": {"path": str(path.resolve())},
                }
            )
    return rows


if __name__ == "__main__":
    main(discover)
