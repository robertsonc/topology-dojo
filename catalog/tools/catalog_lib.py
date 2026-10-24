"""Shared catalog loading for the seed checker and the reference validator.

Kept dependency-light on purpose: the only third-party import is jsonschema, and only the
checker needs it. The Dojo implementation (TypeScript, in the Worker) must reproduce the
behaviour here; these scripts are the executable spec, not production code paths.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LOG = logging.getLogger("catalog")
DATA_ROLES = frozenset({"data", "wan", "lan", "mgmt", "stack", "ha"})
CAGE_KINDS = frozenset({"sfp", "sfp_plus", "sfp28", "sfp56", "qsfp_plus", "qsfp28", "qsfp56", "qsfp_dd", "osfp"})


class CatalogError(Exception):
    """Raised when catalog files cannot be loaded or are structurally unusable."""


@dataclass
class ResolvedInterface:
    name: str
    model_id: str
    physical_id: str
    physical_kind: str
    role: str
    speeds: frozenset[int]
    member: int | None = None


@dataclass
class Catalog:
    root: Path
    platforms: dict[str, dict[str, Any]] = field(default_factory=dict)
    models: dict[str, dict[str, Any]] = field(default_factory=dict)
    optics: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, root: Path) -> "Catalog":
        cat = cls(root=root)
        for kind, target in (("platforms", cat.platforms), ("models", cat.models)):
            folder = root / kind
            if not folder.is_dir():
                raise CatalogError(f"missing catalog folder: {folder}")
            for path in sorted(folder.glob("*.json")):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    raise CatalogError(f"cannot read {path}: {exc}") from exc
                if data.get("id") in target:
                    raise CatalogError(f"duplicate {kind[:-1]} id {data.get('id')!r} in {path}")
                target[data["id"]] = data
        optics_path = root / "optics.json"
        try:
            cat.optics = json.loads(optics_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CatalogError(f"cannot read {optics_path}: {exc}") from exc
        return cat

    def platform_for(self, model_id: str) -> dict[str, Any]:
        return self.platforms[self.models[model_id]["platform"]]

    def resolve_interface(self, model_id: str, name: str) -> ResolvedInterface | None:
        """Map an OS-native interface name to its catalog row, expanding {member} templates."""
        model = self.models[model_id]
        phys = {p["id"]: p for p in self.platform_for(model_id)["ports"]}
        for row in model["interfaces"]:
            template: str = row["name"]
            member: int | None = None
            if "{member}" in template:
                # fullmatch, not match(...$): "$" also matches before a trailing
                # newline, which accepted "1/1/1\n" as member 1.
                pattern = re.escape(template).replace(re.escape("{member}"), r"(?P<member>[1-9][0-9]*)")
                m = re.fullmatch(pattern, name)
                if not m:
                    continue
                member = int(m.group("member"))
            elif template != name:
                continue
            p = phys[row["physical"]]
            return ResolvedInterface(
                name=name, model_id=model_id, physical_id=p["id"], physical_kind=p["kind"],
                role=row["role"], speeds=frozenset(row.get("speeds_mbps", [])), member=member,
            )
        return None
