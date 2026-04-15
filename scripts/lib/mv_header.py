"""Parse and validate the @-header on every sql/clickhouse/**/*.sql file."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Union

ALLOWED_KINDS = {"materialized_view", "backfill", "system"}

REQUIRED_VIEW_KEYS = {
    "name", "domain", "kind", "purpose", "upstream", "consumers",
    "backfill", "owner", "since",
}
REQUIRED_BACKFILL_KEYS = {
    "name", "domain", "kind", "purpose", "pairs", "owner", "since",
}
REQUIRED_SYSTEM_KEYS = {"name", "domain", "kind", "purpose", "owner", "since"}

LIST_KEYS = {"upstream", "consumers"}

_HEADER_RE = re.compile(r"^--\s*@(?P<key>[a-z_]+)\s*:\s*(?P<value>.*?)\s*$")


class HeaderError(ValueError):
    pass


def parse_header(path: Path) -> Dict[str, Union[str, List[str]]]:
    """Parse the header block at the top of `path`.

    Header lines look like `-- @key: value` and form a contiguous block starting
    at the first line. The first non-header, non-blank-comment line ends the block.
    """
    text = path.read_text()
    raw: Dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            break
        if not stripped.startswith("--"):
            break
        m = _HEADER_RE.match(stripped)
        if not m:
            # Allow `-- NOTES:` style and bare `--` lines inside the block
            # but do not parse them as key/value.
            continue
        key = m.group("key")
        value = m.group("value")
        if key in raw:
            raise HeaderError(f"{path}: duplicate @{key}")
        raw[key] = value

    if not raw:
        raise HeaderError(f"{path}: no @-header found at top of file")

    kind = raw.get("kind")
    if kind not in ALLOWED_KINDS:
        raise HeaderError(f"{path}: @kind must be one of {sorted(ALLOWED_KINDS)}, got {kind!r}")

    if kind == "materialized_view":
        required = REQUIRED_VIEW_KEYS
    elif kind == "backfill":
        required = REQUIRED_BACKFILL_KEYS
    else:
        required = REQUIRED_SYSTEM_KEYS

    missing = required - raw.keys()
    if missing:
        raise HeaderError(f"{path}: missing required keys: {sorted(missing)}")

    expected_name = path.stem
    if raw["name"] != expected_name:
        raise HeaderError(f"{path}: @name={raw['name']!r} does not match filename stem {expected_name!r}")

    parsed: Dict[str, Union[str, List[str]]] = {}
    for key, value in raw.items():
        if key in LIST_KEYS:
            parsed[key] = [v.strip() for v in value.split(",") if v.strip()]
        else:
            parsed[key] = value
    return parsed
