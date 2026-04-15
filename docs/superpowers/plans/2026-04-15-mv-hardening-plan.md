# MV Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editing and adding ClickHouse materialized views safe, fast, and self-documenting, with a drift guard that blocks silent schema changes and a consumer-safety grep that flags frontend breaks before they ship.

**Architecture:** Keep `scripts/apply-clickhouse-assets.sh` as the single front door. Add `--only <domain>/<name>` and `--force-recreate` flags. Track target-table DDL hashes in a managed `tidx_4217._mv_schema` side-table. Require a parseable `@`-header on every SQL file and auto-generate `docs/data-assets.md` from those headers. Consumer-safety is a grep of `@consumers` paths for dropped/renamed columns. Python helpers live under `scripts/lib/` with unit tests.

**Tech Stack:** Bash, Python 3 (stdlib only), ClickHouse HTTP interface (via `curl`), existing repo tooling.

**Spec:** `docs/superpowers/specs/2026-04-15-mv-hardening-design.md`

---

## File Structure

**New files:**
- `scripts/lib/mv_header.py` — header parse + validate (module name uses `_` not `-` so it's importable by tests).
- `scripts/lib/mv_ddl.py` — target-table DDL extract + canonicalize.
- `scripts/lib/test_mv_header.py` — unittest suite for the header parser.
- `scripts/lib/test_mv_ddl.py` — unittest suite for the DDL tools.
- `scripts/gen-data-assets-doc.sh` — regenerate the generated region of `docs/data-assets.md`.
- `scripts/test-apply-flow.sh` — scripted integration test for the apply script.
- `sql/clickhouse/system/_mv_schema.sql` — DDL for the drift-tracking side-table.
- `sql/clickhouse/_template/mv_TEMPLATE.sql` — scaffolding template for new views.
- `sql/clickhouse/_template/backfill_TEMPLATE.sql` — scaffolding template for new backfills.

**Modified files:**
- `scripts/apply-clickhouse-assets.sh` — argument parsing, header validation, drift guard, `--force-recreate` path, consumer grep, doc regen hook.
- `scripts/takopi_sync_clickhouse_assets.sh` — forward `TAKOPI_MV_ONLY` and `TAKOPI_MV_FORCE_RECREATE` to the apply script.
- `docs/data-assets.md` — restructure into hand-maintained prose plus a `<!-- BEGIN GENERATED -->` / `<!-- END GENERATED -->` block.
- All 15 files under `sql/clickhouse/views/**/*.sql` — add `@`-header.
- All 15 files under `sql/clickhouse/backfills/**/*.sql` — add `@`-header.

---

## Task 1: Python header parser (`mv_header.py`) with tests

**Files:**
- Create: `scripts/lib/mv_header.py`
- Create: `scripts/lib/test_mv_header.py`
- Create: `scripts/lib/__init__.py` (empty, so tests can import)

### - [ ] Step 1: Create empty `__init__.py`

```bash
mkdir -p scripts/lib
: > scripts/lib/__init__.py
```

### - [ ] Step 2: Write the failing test

Create `scripts/lib/test_mv_header.py`:

```python
import unittest
from pathlib import Path
import tempfile

from mv_header import parse_header, HeaderError, REQUIRED_VIEW_KEYS, REQUIRED_BACKFILL_KEYS


VALID_VIEW = """\
-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         materialized_view
-- @purpose:      Daily DEX rollup.
-- @upstream:     tidx_4217.logs, tidx_4217.txs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts::getDexDaily
-- @backfill:     sql/clickhouse/backfills/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--
-- NOTES: free-form.

CREATE TABLE IF NOT EXISTS tidx_4217.mv_dex_daily ( day Date ) ENGINE = SummingMergeTree ORDER BY day;
"""

VALID_BACKFILL = """\
-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         backfill
-- @purpose:      Backfill for mv_dex_daily.
-- @pairs:        sql/clickhouse/views/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15

INSERT INTO tidx_4217.mv_dex_daily SELECT toDate(block_timestamp), 1 FROM tidx_4217.txs;
"""


class TestParseHeader(unittest.TestCase):
    def _write(self, content: str, name: str = "mv_dex_daily.sql") -> Path:
        tmp = Path(tempfile.mkdtemp()) / name
        tmp.write_text(content)
        return tmp

    def test_valid_view_header(self):
        h = parse_header(self._write(VALID_VIEW))
        self.assertEqual(h["name"], "mv_dex_daily")
        self.assertEqual(h["domain"], "dex")
        self.assertEqual(h["kind"], "materialized_view")
        self.assertEqual(h["consumers"], ["src/app/dex/page.tsx", "src/lib/analytics.ts::getDexDaily"])
        self.assertEqual(h["upstream"], ["tidx_4217.logs", "tidx_4217.txs"])

    def test_valid_backfill_header(self):
        h = parse_header(self._write(VALID_BACKFILL, "mv_dex_daily.sql"))
        self.assertEqual(h["kind"], "backfill")
        self.assertEqual(h["pairs"], "sql/clickhouse/views/dex/mv_dex_daily.sql")

    def test_missing_required_key(self):
        bad = VALID_VIEW.replace("-- @purpose:      Daily DEX rollup.\n", "")
        with self.assertRaises(HeaderError) as ctx:
            parse_header(self._write(bad))
        self.assertIn("purpose", str(ctx.exception))

    def test_name_must_match_filename(self):
        with self.assertRaises(HeaderError) as ctx:
            parse_header(self._write(VALID_VIEW, "mv_wrong_name.sql"))
        self.assertIn("@name", str(ctx.exception))

    def test_unknown_kind_rejected(self):
        bad = VALID_VIEW.replace("@kind:         materialized_view", "@kind:         nonsense")
        with self.assertRaises(HeaderError):
            parse_header(self._write(bad))

    def test_required_keys_sets(self):
        self.assertIn("purpose", REQUIRED_VIEW_KEYS)
        self.assertIn("pairs", REQUIRED_BACKFILL_KEYS)


if __name__ == "__main__":
    unittest.main()
```

### - [ ] Step 3: Run test to verify it fails

```bash
cd scripts/lib && python3 -m unittest test_mv_header -v
```
Expected: `ModuleNotFoundError: No module named 'mv_header'`.

### - [ ] Step 4: Implement `mv_header.py`

Create `scripts/lib/mv_header.py`:

```python
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
```

### - [ ] Step 5: Run test to verify it passes

```bash
cd scripts/lib && python3 -m unittest test_mv_header -v
```
Expected: 6 tests PASS.

### - [ ] Step 6: Commit

```bash
git add scripts/lib/__init__.py scripts/lib/mv_header.py scripts/lib/test_mv_header.py
git commit -m "feat(sql): add @-header parser for MV files"
```

---

## Task 2: Python DDL extractor + canonicalizer (`mv_ddl.py`) with tests

**Files:**
- Create: `scripts/lib/mv_ddl.py`
- Create: `scripts/lib/test_mv_ddl.py`

### - [ ] Step 1: Write the failing test

Create `scripts/lib/test_mv_ddl.py`:

```python
import unittest
from mv_ddl import extract_target_ddl, canonicalize_ddl, ddl_hash, extract_columns, DDLError


VIEW_SQL = """\
-- @name: mv_foo
-- @kind: materialized_view

CREATE TABLE IF NOT EXISTS tidx_4217.mv_foo
(
  day    Date,
  count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_foo_view
TO tidx_4217.mv_foo
AS SELECT toDate(block_timestamp) AS day, count() AS count
FROM tidx_4217.txs
GROUP BY day;
"""


class TestExtract(unittest.TestCase):
    def test_extracts_create_table_only(self):
        ddl = extract_target_ddl(VIEW_SQL)
        self.assertIn("CREATE TABLE IF NOT EXISTS tidx_4217.mv_foo", ddl)
        self.assertNotIn("CREATE MATERIALIZED VIEW", ddl)
        self.assertNotIn("SELECT", ddl)

    def test_missing_create_table_raises(self):
        with self.assertRaises(DDLError):
            extract_target_ddl("-- @name: x\nCREATE MATERIALIZED VIEW foo AS SELECT 1;")

    def test_missing_create_mv_raises(self):
        with self.assertRaises(DDLError):
            extract_target_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory;")


class TestCanonicalize(unittest.TestCase):
    def test_whitespace_invariant(self):
        a = canonicalize_ddl("CREATE TABLE  foo (  x Int32  ) ENGINE = Memory")
        b = canonicalize_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory")
        self.assertEqual(a, b)

    def test_strips_line_comments(self):
        a = canonicalize_ddl("CREATE TABLE foo (x Int32) -- trailing\nENGINE = Memory")
        b = canonicalize_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory")
        self.assertEqual(a, b)

    def test_case_insensitive_keywords(self):
        a = canonicalize_ddl("create table foo (x Int32) engine = Memory")
        b = canonicalize_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory")
        self.assertEqual(a, b)

    def test_hash_stable(self):
        self.assertEqual(ddl_hash(VIEW_SQL), ddl_hash(VIEW_SQL.replace("\n\n", "\n")))


class TestExtractColumns(unittest.TestCase):
    def test_basic(self):
        cols = extract_columns(extract_target_ddl(VIEW_SQL))
        self.assertEqual(cols, ["day", "count"])

    def test_handles_nested_parens(self):
        ddl = "CREATE TABLE x (a Array(UInt64), b Tuple(UInt8, String)) ENGINE = Memory"
        cols = extract_columns(ddl)
        self.assertEqual(cols, ["a", "b"])


if __name__ == "__main__":
    unittest.main()
```

### - [ ] Step 2: Run test to verify it fails

```bash
cd scripts/lib && python3 -m unittest test_mv_ddl -v
```
Expected: `ModuleNotFoundError: No module named 'mv_ddl'`.

### - [ ] Step 3: Implement `mv_ddl.py`

Create `scripts/lib/mv_ddl.py`:

```python
"""Extract, canonicalize, and hash the target-table DDL of a view file."""
from __future__ import annotations

import hashlib
import re
from typing import List

_CREATE_TABLE_RE = re.compile(
    r"(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(]+\s*\(.*?\)\s*ENGINE\s*=\s*[^\n;]+(?:\s*ORDER\s+BY\s+[^\n;]+)?(?:\s*PARTITION\s+BY\s+[^\n;]+)?(?:\s*SETTINGS\s+[^\n;]+)?)\s*;",
    re.IGNORECASE | re.DOTALL,
)

_CREATE_MV_RE = re.compile(r"CREATE\s+MATERIALIZED\s+VIEW", re.IGNORECASE)


class DDLError(ValueError):
    pass


def extract_target_ddl(sql_text: str) -> str:
    """Return the CREATE TABLE ... ENGINE ... block of a view file, as a single statement.

    Raises DDLError if the file is missing either the CREATE TABLE or the
    CREATE MATERIALIZED VIEW block.
    """
    if not _CREATE_MV_RE.search(sql_text):
        raise DDLError("no CREATE MATERIALIZED VIEW block found")
    m = _CREATE_TABLE_RE.search(sql_text)
    if not m:
        raise DDLError("no CREATE TABLE ... ENGINE block found")
    return m.group(1).strip()


def canonicalize_ddl(ddl: str) -> str:
    """Normalize whitespace, strip line comments, lowercase keywords."""
    # Strip -- line comments
    lines = [re.sub(r"--.*$", "", line) for line in ddl.splitlines()]
    text = " ".join(line for line in lines if line.strip())
    # Collapse whitespace (including around punctuation)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*([(),])\s*", r"\1", text)
    return text.lower()


def ddl_hash(sql_text: str) -> str:
    """SHA-256 of the canonicalized target-table DDL."""
    ddl = extract_target_ddl(sql_text)
    return hashlib.sha256(canonicalize_ddl(ddl).encode("utf-8")).hexdigest()


def extract_columns(target_ddl: str) -> List[str]:
    """Return column names from a CREATE TABLE block, in declaration order."""
    m = re.search(r"\((.*)\)\s*ENGINE", target_ddl, re.IGNORECASE | re.DOTALL)
    if not m:
        raise DDLError("could not locate column list in DDL")
    body = m.group(1)
    cols: List[str] = []
    depth = 0
    current = ""
    for ch in body:
        if ch == "(":
            depth += 1
            current += ch
        elif ch == ")":
            depth -= 1
            current += ch
        elif ch == "," and depth == 0:
            cols.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        cols.append(current.strip())
    # First token of each entry is the column name
    return [c.split()[0] for c in cols if c.strip()]
```

### - [ ] Step 4: Run test to verify it passes

```bash
cd scripts/lib && python3 -m unittest test_mv_ddl -v
```
Expected: 8 tests PASS.

### - [ ] Step 5: Commit

```bash
git add scripts/lib/mv_ddl.py scripts/lib/test_mv_ddl.py
git commit -m "feat(sql): add DDL extract/canonicalize/hash helpers"
```

---

## Task 3: Add the `_mv_schema` side-table DDL

**Files:**
- Create: `sql/clickhouse/system/_mv_schema.sql`

### - [ ] Step 1: Create the system SQL file

Create `sql/clickhouse/system/_mv_schema.sql`:

```sql
-- @name:    _mv_schema
-- @domain:  system
-- @kind:    system
-- @purpose: Tracks the last-applied DDL hash and text for every managed MV, used by apply-clickhouse-assets.sh for drift detection.
-- @owner:   evan
-- @since:   2026-04-15

CREATE TABLE IF NOT EXISTS tidx_4217._mv_schema
(
  name        String,
  ddl_hash    String,
  ddl_text    String,
  applied_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(applied_at)
ORDER BY name;
```

### - [ ] Step 2: Verify it parses with the header parser

```bash
cd scripts/lib && python3 -c "from mv_header import parse_header; from pathlib import Path; print(parse_header(Path('../../sql/clickhouse/system/_mv_schema.sql')))"
```
Expected: dict prints with `'kind': 'system'`, no exception.

### - [ ] Step 3: Commit

```bash
git add sql/clickhouse/system/_mv_schema.sql
git commit -m "feat(sql): add _mv_schema side-table for drift tracking"
```

---

## Task 4: Add view + backfill templates

**Files:**
- Create: `sql/clickhouse/_template/mv_TEMPLATE.sql`
- Create: `sql/clickhouse/_template/backfill_TEMPLATE.sql`

### - [ ] Step 1: Create the view template

Create `sql/clickhouse/_template/mv_TEMPLATE.sql`:

```sql
-- @name:         mv_TEMPLATE
-- @domain:       REPLACE_ME
-- @kind:         materialized_view
-- @purpose:      One-line description of what this view computes.
-- @upstream:     tidx_4217.txs
-- @consumers:    src/lib/analytics.ts::REPLACE_ME
-- @backfill:     sql/clickhouse/backfills/REPLACE_ME/mv_TEMPLATE.sql
-- @owner:        evan
-- @since:        YYYY-MM-DD
--
-- NOTES: free-form prose; non-obvious filters, caveats, rationale.

CREATE TABLE IF NOT EXISTS tidx_4217.mv_TEMPLATE
(
  day    Date,
  -- add columns
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_TEMPLATE_view
TO tidx_4217.mv_TEMPLATE
AS SELECT
  toDate(block_timestamp) AS day
  -- add aggregates
FROM tidx_4217.txs
GROUP BY day;
```

### - [ ] Step 2: Create the backfill template

Create `sql/clickhouse/_template/backfill_TEMPLATE.sql`:

```sql
-- @name:         backfill_TEMPLATE
-- @domain:       REPLACE_ME
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_TEMPLATE.
-- @pairs:        sql/clickhouse/views/REPLACE_ME/mv_TEMPLATE.sql
-- @owner:        evan
-- @since:        YYYY-MM-DD

INSERT INTO tidx_4217.mv_TEMPLATE
SELECT
  toDate(block_timestamp) AS day
  -- add aggregates matching the view
FROM tidx_4217.txs
GROUP BY day;
```

### - [ ] Step 3: Commit

```bash
git add sql/clickhouse/_template/
git commit -m "feat(sql): add view and backfill templates with required @-header"
```

---

## Task 5: Migrate existing SQL files to include `@`-headers

**Files:**
- Modify: all 15 files under `sql/clickhouse/views/**/*.sql`
- Modify: all 15 files under `sql/clickhouse/backfills/**/*.sql`

### - [ ] Step 1: Write a one-shot migration helper

Create `scripts/migrate-add-headers.py` (throwaway, not committed):

```python
#!/usr/bin/env python3
"""One-time: add @-headers to every existing sql/clickhouse/{views,backfills}/**/*.sql."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA_ASSETS = (ROOT / "docs/data-assets.md").read_text()


def consumers_for(view_filename: str) -> str:
    # Rough: pick lines in docs/data-assets.md that mention this file.
    hits = set()
    for line in DATA_ASSETS.splitlines():
        if view_filename in line:
            for match in re.findall(r"`([^`]+\.tsx?)`", line):
                hits.add(match)
    return ", ".join(sorted(hits)) or "TBD"


def upstream_from_sql(body: str) -> str:
    tables = sorted(set(re.findall(r"tidx_4217\.[A-Za-z_]+", body)))
    return ", ".join(tables) or "tidx_4217.txs"


def header(kind: str, name: str, domain: str, purpose: str,
           upstream: str = "", consumers: str = "", backfill: str = "", pairs: str = "") -> str:
    lines = [
        f"-- @name:         {name}",
        f"-- @domain:       {domain}",
        f"-- @kind:         {kind}",
        f"-- @purpose:      {purpose}",
    ]
    if kind == "materialized_view":
        lines += [
            f"-- @upstream:     {upstream}",
            f"-- @consumers:    {consumers}",
            f"-- @backfill:     {backfill}",
        ]
    elif kind == "backfill":
        lines += [f"-- @pairs:        {pairs}"]
    lines += [
        "-- @owner:        evan",
        "-- @since:        2026-04-15",
        "--",
    ]
    return "\n".join(lines) + "\n\n"


def migrate(path: Path, kind: str) -> None:
    text = path.read_text()
    if re.search(r"^-- @name:", text, re.MULTILINE):
        return  # already migrated
    domain = path.parent.name
    name = path.stem
    existing_comment_match = re.match(r"(?:--[^\n]*\n)+", text)
    purpose_seed = "TBD — review and fill in."
    if existing_comment_match:
        first_block = existing_comment_match.group(0)
        # Take the most descriptive-looking comment line
        for line in first_block.splitlines():
            stripped = line.lstrip("-").strip()
            if "Domain:" in stripped or "Apply" in stripped or not stripped:
                continue
            purpose_seed = stripped
            break
        text = text[len(first_block):].lstrip("\n")
    if kind == "materialized_view":
        backfill_rel = f"sql/clickhouse/backfills/{domain}/{name}.sql"
        backfill_abs = ROOT / backfill_rel
        backfill_val = backfill_rel if backfill_abs.exists() else "none"
        h = header(
            "materialized_view", name, domain, purpose_seed,
            upstream=upstream_from_sql(text),
            consumers=consumers_for(f"{name}.sql"),
            backfill=backfill_val,
        )
    else:
        pairs_rel = f"sql/clickhouse/views/{domain}/{name}.sql"
        h = header("backfill", name, domain, f"Historical backfill for {name}.",
                   pairs=pairs_rel)
    path.write_text(h + text)


def main() -> None:
    for path in (ROOT / "sql/clickhouse/views").rglob("mv_*.sql"):
        migrate(path, "materialized_view")
    for path in (ROOT / "sql/clickhouse/backfills").rglob("mv_*.sql"):
        migrate(path, "backfill")


if __name__ == "__main__":
    main()
```

### - [ ] Step 2: Run the migration

```bash
python3 scripts/migrate-add-headers.py
```
Expected: no output, all 30 files modified.

### - [ ] Step 3: Verify all files parse

```bash
cd scripts/lib && python3 -c "
from pathlib import Path
from mv_header import parse_header, HeaderError
root = Path('../../sql/clickhouse')
errors = []
for path in root.rglob('mv_*.sql'):
    try:
        parse_header(path)
    except HeaderError as e:
        errors.append(str(e))
if errors:
    print('FAIL:')
    for e in errors: print(' ', e)
    raise SystemExit(1)
print(f'OK: {sum(1 for _ in root.rglob(\"mv_*.sql\"))} files parse cleanly')
"
```
Expected: `OK: 30 files parse cleanly`.

### - [ ] Step 4: Review and tighten `@purpose`, `@consumers`, and `@upstream`

Open each of the 15 view files and replace any `TBD` with a meaningful one-line purpose. Cross-check `@consumers` against `docs/data-assets.md` and `grep -rn "mv_<name>" src/`. Fix any stale entries.

Command to find files still containing `TBD`:

```bash
grep -lE '^-- @(purpose|consumers):.*TBD' sql/clickhouse/views/**/*.sql sql/clickhouse/backfills/**/*.sql
```
Expected after editing: no output.

### - [ ] Step 5: Delete the throwaway migration script

```bash
rm scripts/migrate-add-headers.py
```

### - [ ] Step 6: Commit

```bash
git add sql/clickhouse/views sql/clickhouse/backfills
git commit -m "refactor(sql): add @-header to every view and backfill file"
```

---

## Task 6: Add CLI argument parsing and header validation to the apply script

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

### - [ ] Step 1: Replace the top of the apply script

Read the current file first:

```bash
cat scripts/apply-clickhouse-assets.sh
```

Edit `scripts/apply-clickhouse-assets.sh` — replace the section starting with `set -euo pipefail` through the first `: "${CLICKHOUSE_RUN_BACKFILLS:=0}"` line with:

```bash
set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL is required}"
: "${CLICKHOUSE_DB:=tidx_4217}"
: "${CLICKHOUSE_RUN_BACKFILLS:=0}"

ONLY=""
FORCE_RECREATE=0
I_KNOW=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)
      ONLY="$2"; shift 2 ;;
    --only=*)
      ONLY="${1#*=}"; shift ;;
    --force-recreate)
      FORCE_RECREATE=1; shift ;;
    --i-know-consumers-break)
      I_KNOW=1; shift ;;
    -h|--help)
      cat <<HELP
Usage: apply-clickhouse-assets.sh [--only <domain>/<name>] [--force-recreate] [--i-know-consumers-break]

  (no flags)             Apply all views (idempotent). Backfills skipped unless CLICKHOUSE_RUN_BACKFILLS>0.
  --only <d>/<n>         Apply one view by path (sql/clickhouse/views/<d>/<n>.sql).
  --force-recreate       Drop and recreate the target table and MV, then rerun the matching backfill.
                         Required when target-table DDL has drifted from what is recorded in _mv_schema.
                         Must be combined with --only.
  --i-know-consumers-break  Bypass the consumer-safety confirmation (for non-interactive use).
HELP
      exit 0 ;;
    *)
      echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ "$FORCE_RECREATE" == 1 && -z "$ONLY" ]]; then
  echo "error: --force-recreate requires --only <domain>/<name>" >&2
  exit 2
fi
```

### - [ ] Step 2: Add header validation gate

Directly after the argument parsing block, insert:

```bash
validate_headers() {
  python3 - "$SCRIPT_DIR/../sql/clickhouse" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[0]).resolve().parent / "lib")) if False else None
sys.path.insert(0, str(Path(__file__).resolve().parent))  # harmless placeholder
PY
}
```

Replace that stub with the real validator — insert after the `CLICKHOUSE_BASE_URL=...` line:

```bash
validate_headers() {
  python3 <<PY
import sys
from pathlib import Path
sys.path.insert(0, "$SCRIPT_DIR/lib")
from mv_header import parse_header, HeaderError
root = Path("$SCRIPT_DIR/../sql/clickhouse")
errors = []
for path in root.rglob("*.sql"):
    if "_template" in path.parts:
        continue
    try:
        parse_header(path)
    except HeaderError as e:
        errors.append(str(e))
if errors:
    print("header validation failed:", file=sys.stderr)
    for e in errors:
        print("  " + e, file=sys.stderr)
    sys.exit(2)
PY
}

validate_headers
```

### - [ ] Step 3: Resolve `--only` to an actual filepath

Insert after `validate_headers`:

```bash
resolve_only() {
  local spec="$1"
  local view_path="$SCRIPT_DIR/../sql/clickhouse/views/$spec.sql"
  if [[ ! -f "$view_path" ]]; then
    echo "error: --only $spec did not resolve to $view_path" >&2
    echo "valid views:" >&2
    find "$SCRIPT_DIR/../sql/clickhouse/views" -name 'mv_*.sql' -printf '  %P\n' | sed 's|\.sql$||' >&2
    exit 2
  fi
  printf '%s\n' "$view_path"
}
```

### - [ ] Step 4: Gate the existing bulk-apply block behind `$ONLY` being empty

Wrap the existing `find .../views` loop and the `CLICKHOUSE_RUN_BACKFILLS` block at the bottom of the file:

```bash
if [[ -z "$ONLY" ]]; then
  find "$SCRIPT_DIR/../sql/clickhouse/views" -name "*.sql" | sort | while read -r f; do
    run_sql "$f"
  done

  if [ -n "$CLICKHOUSE_RUN_BACKFILLS" ] && [ "$CLICKHOUSE_RUN_BACKFILLS" -gt 0 ]; then
    echo "CLICKHOUSE_RUN_BACKFILLS=$CLICKHOUSE_RUN_BACKFILLS; applying historical backfills in parallel."
    export CLICKHOUSE_BASE_URL CLICKHOUSE_DB DEFAULT_CLICKHOUSE_DB
    export -f run_sql emit_sql_statements
    find "$SCRIPT_DIR/../sql/clickhouse/backfills" -name "*.sql" | sort | \
      xargs -P "$CLICKHOUSE_RUN_BACKFILLS" -I{} bash -c 'run_sql "$@"' _ {}
  else
    echo "Skipping historical backfills by default."
    echo "Set CLICKHOUSE_RUN_BACKFILLS=N to run N backfill SQL files concurrently (e.g. CLICKHOUSE_RUN_BACKFILLS=4)."
  fi
else
  VIEW_FILE="$(resolve_only "$ONLY")"
  echo "Single-view mode: $ONLY"
  # Drift-guard + recreate path is added in Task 7–9.
  run_sql "$VIEW_FILE"
fi
```

### - [ ] Step 5: Test header gate

```bash
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily
```
Expected: runs without error, validates all headers, applies just `mv_dex_daily`.

Temporarily break a header (e.g., delete `@purpose:` line from one file), rerun, confirm it exits 2 with the file path printed. Restore the header afterward.

### - [ ] Step 6: Commit

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "feat(apply): add --only arg and @-header validation gate"
```

---

## Task 7: Bootstrap `_mv_schema` and add hash lookup

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

### - [ ] Step 1: Apply `_mv_schema` before anything else

After `validate_headers`, insert:

```bash
ensure_mv_schema() {
  run_sql "$SCRIPT_DIR/../sql/clickhouse/system/_mv_schema.sql"
}

ensure_mv_schema
```

### - [ ] Step 2: Add a helper to read current hash

Insert after `ensure_mv_schema`:

```bash
fetch_recorded_hash() {
  local name="$1"
  curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
    --data-urlencode "query=SELECT ddl_hash FROM ${CLICKHOUSE_DB}._mv_schema FINAL WHERE name='${name}' FORMAT TSV" \
    || true
}

fetch_recorded_ddl_text() {
  local name="$1"
  curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
    --data-urlencode "query=SELECT ddl_text FROM ${CLICKHOUSE_DB}._mv_schema FINAL WHERE name='${name}' FORMAT TSV" \
    || true
}

compute_view_hash() {
  local file="$1"
  python3 <<PY
import sys
sys.path.insert(0, "$SCRIPT_DIR/lib")
from mv_ddl import ddl_hash
print(ddl_hash(open("$file").read()))
PY
}

compute_view_ddl_text() {
  local file="$1"
  python3 <<PY
import sys
sys.path.insert(0, "$SCRIPT_DIR/lib")
from mv_ddl import extract_target_ddl
print(extract_target_ddl(open("$file").read()))
PY
}

upsert_mv_schema_row() {
  local name="$1"
  local hash="$2"
  local ddl_file="$3"
  local encoded_ddl
  encoded_ddl="$(python3 -c "import sys; print(open(sys.argv[1]).read().replace(\"'\", \"''\"))" "$ddl_file")"
  curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
    --data-binary "INSERT INTO ${CLICKHOUSE_DB}._mv_schema (name, ddl_hash, ddl_text) VALUES ('${name}', '${hash}', '${encoded_ddl}')" \
    >/dev/null
}
```

### - [ ] Step 3: Commit

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "feat(apply): bootstrap _mv_schema and add hash-lookup helpers"
```

---

## Task 8: Add the drift guard (block on mismatch)

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

### - [ ] Step 1: Wire drift detection into the single-view path

Replace the `else` branch (single-view mode) from Task 6 with:

```bash
else
  VIEW_FILE="$(resolve_only "$ONLY")"
  VIEW_NAME="$(basename "$VIEW_FILE" .sql)"
  NEW_HASH="$(compute_view_hash "$VIEW_FILE")"
  OLD_HASH="$(fetch_recorded_hash "$VIEW_NAME" | tr -d '[:space:]')"

  if [[ -z "$OLD_HASH" ]]; then
    echo "First install of $VIEW_NAME; applying."
    run_sql "$VIEW_FILE"
    NEW_DDL_TMP="$(mktemp)"
    compute_view_ddl_text "$VIEW_FILE" > "$NEW_DDL_TMP"
    upsert_mv_schema_row "$VIEW_NAME" "$NEW_HASH" "$NEW_DDL_TMP"
    rm -f "$NEW_DDL_TMP"
  elif [[ "$OLD_HASH" == "$NEW_HASH" ]]; then
    echo "Target-table DDL unchanged for $VIEW_NAME; applying SELECT-body update."
    run_sql "$VIEW_FILE"
  else
    if [[ "$FORCE_RECREATE" != 1 ]]; then
      echo "DRIFT DETECTED for $VIEW_NAME" >&2
      echo "Recorded DDL:" >&2
      fetch_recorded_ddl_text "$VIEW_NAME" >&2
      echo "" >&2
      echo "Repo DDL:" >&2
      compute_view_ddl_text "$VIEW_FILE" >&2
      echo "" >&2
      echo "Re-run with --force-recreate to drop and recreate $VIEW_NAME." >&2
      exit 2
    fi
    # Force-recreate path lands in Task 9.
    echo "TODO: force-recreate path not yet implemented" >&2
    exit 1
  fi
fi
```

### - [ ] Step 2: Smoke-test

```bash
# Should succeed and do nothing (hash matches)
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily
```
Expected: `Target-table DDL unchanged for mv_dex_daily; applying SELECT-body update.`

```bash
# Temporarily add a fake column to sql/clickhouse/views/dex/mv_dex_daily.sql target table,
# then rerun without --force-recreate.
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily
```
Expected: exits 2 with `DRIFT DETECTED` and both DDLs printed. Revert the edit.

### - [ ] Step 3: Commit

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "feat(apply): drift guard blocks target-table DDL changes without --force-recreate"
```

---

## Task 9: Implement `--force-recreate` (drop + recreate + backfill)

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

### - [ ] Step 1: Replace the TODO stub with the real recreate path

Replace the two-line TODO in the drift-mismatch branch (from Task 8) with:

```bash
    echo "Force-recreating $VIEW_NAME."
    # Drop the MV and the target table. Names follow the repo convention:
    #   target table: tidx_4217.<name>
    #   MV:           tidx_4217.<name>_view
    for stmt in \
      "DROP VIEW IF EXISTS ${CLICKHOUSE_DB}.${VIEW_NAME}_view" \
      "DROP TABLE IF EXISTS ${CLICKHOUSE_DB}.${VIEW_NAME}"; do
      curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
        --data-binary "$stmt" >/dev/null
    done

    run_sql "$VIEW_FILE"

    DOMAIN_DIR="$(dirname "${ONLY}")"
    BACKFILL_FILE="$SCRIPT_DIR/../sql/clickhouse/backfills/${DOMAIN_DIR}/${VIEW_NAME}.sql"
    if [[ -f "$BACKFILL_FILE" ]]; then
      echo "Running backfill: $BACKFILL_FILE"
      run_sql "$BACKFILL_FILE"
    else
      echo "warning: no backfill file at $BACKFILL_FILE; skipping" >&2
    fi

    NEW_DDL_TMP="$(mktemp)"
    compute_view_ddl_text "$VIEW_FILE" > "$NEW_DDL_TMP"
    upsert_mv_schema_row "$VIEW_NAME" "$NEW_HASH" "$NEW_DDL_TMP"
    rm -f "$NEW_DDL_TMP"
```

### - [ ] Step 2: End-to-end test

```bash
# Add a harmless column to sql/clickhouse/views/dex/mv_dex_daily.sql target table
# (e.g., `, extra UInt64`), then:
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily --force-recreate
```
Expected: drop succeeds, recreate succeeds, backfill runs, `_mv_schema` row is updated.

Verify:

```bash
curl -fsS 'http://127.0.0.1:8123/?database=tidx_4217' --data-binary "DESCRIBE TABLE mv_dex_daily FORMAT TSV"
curl -fsS 'http://127.0.0.1:8123/?database=tidx_4217' --data-binary "SELECT name, ddl_hash FROM _mv_schema FINAL WHERE name='mv_dex_daily' FORMAT TSV"
```
Expected: `extra UInt64` shows in the schema; `_mv_schema` hash matches `compute_view_hash`.

Revert the `.sql` file and re-run with `--force-recreate` to restore state:

```bash
git checkout sql/clickhouse/views/dex/mv_dex_daily.sql
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily --force-recreate
```

### - [ ] Step 3: Commit

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "feat(apply): implement --force-recreate drop+recreate+backfill path"
```

---

## Task 10: Consumer-safety grep

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

### - [ ] Step 1: Add the consumer-check helper

Insert above the single-view `else` branch:

```bash
consumer_safety_check() {
  local view_file="$1"
  local view_name="$2"
  python3 <<PY
import subprocess, sys
from pathlib import Path
sys.path.insert(0, "$SCRIPT_DIR/lib")
from mv_header import parse_header
from mv_ddl import extract_columns, extract_target_ddl

view_path = Path("$view_file")
repo_root = Path("$SCRIPT_DIR").parent
header = parse_header(view_path)
consumers = header.get("consumers", [])

new_cols = set(extract_columns(extract_target_ddl(view_path.read_text())))

# Fetch recorded DDL from CH to diff old columns
import urllib.request, urllib.parse
q = f"SELECT ddl_text FROM ${CLICKHOUSE_DB}._mv_schema FINAL WHERE name='{view_name}' FORMAT TSVRaw"
url = "$CLICKHOUSE_BASE_URL/?database=$CLICKHOUSE_DB&" + urllib.parse.urlencode({"query": q})
recorded = urllib.request.urlopen(url).read().decode("utf-8").strip()
if not recorded:
    sys.exit(0)  # first install; nothing to diff

old_cols = set(extract_columns(recorded))
dropped = old_cols - new_cols
if not dropped:
    sys.exit(0)

print(f"Dropped/renamed columns: {sorted(dropped)}", file=sys.stderr)
hits = []
for consumer in consumers:
    path = consumer.split("::", 1)[0]
    full = repo_root / path
    if not full.exists():
        continue
    for col in dropped:
        result = subprocess.run(
            ["grep", "-nFw", col, str(full)],
            capture_output=True, text=True,
        )
        if result.stdout:
            hits.append((path, col, result.stdout.strip()))

if hits:
    print("Consumer references to dropped/renamed columns:", file=sys.stderr)
    for path, col, out in hits:
        print(f"  [{col}] {path}:", file=sys.stderr)
        for line in out.splitlines():
            print(f"    {line}", file=sys.stderr)
    sys.exit(10)
PY
}
```

### - [ ] Step 2: Wire it into the force-recreate branch

Directly before the `DROP VIEW` loop in the force-recreate branch, insert:

```bash
    if consumer_safety_check "$VIEW_FILE" "$VIEW_NAME"; then
      :
    else
      rc=$?
      if [[ "$rc" != 10 ]]; then
        echo "consumer-safety check failed with rc=$rc" >&2
        exit "$rc"
      fi
      if [[ "$I_KNOW" != 1 ]]; then
        if [[ -t 0 ]]; then
          read -r -p "Proceed anyway? [y/N] " reply
          if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
            echo "aborted by operator" >&2
            exit 3
          fi
        else
          echo "non-interactive: pass --i-know-consumers-break to override" >&2
          exit 3
        fi
      fi
    fi
```

### - [ ] Step 3: Manual test

Temporarily delete a column from `sql/clickhouse/views/dex/mv_dex_daily.sql` that is referenced in `src/lib/analytics.ts`. Run:

```bash
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily --force-recreate
```
Expected (interactive): warning + `Proceed anyway? [y/N]`. Answer `N`, confirm abort.

Rerun with override:

```bash
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily --force-recreate --i-know-consumers-break
```
Expected: proceeds. Revert the edit and re-run to restore.

### - [ ] Step 4: Commit

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "feat(apply): consumer-safety grep gates --force-recreate on dropped columns"
```

---

## Task 11: Generate `docs/data-assets.md` from headers

**Files:**
- Create: `scripts/gen-data-assets-doc.sh`
- Modify: `docs/data-assets.md`

### - [ ] Step 1: Restructure `docs/data-assets.md`

Replace the entire file with:

```markdown
# Data Assets

This repo keeps ClickHouse view definitions, backfills, and validation scripts as first-class source files. Every `.sql` file carries a structured `@`-header that IS its documentation. The table below is generated from those headers — do not edit by hand.

## Creating a new view

1. Copy `sql/clickhouse/_template/mv_TEMPLATE.sql` to `sql/clickhouse/views/<domain>/mv_<name>.sql`. Fill the header and the DDL.
2. Copy `sql/clickhouse/_template/backfill_TEMPLATE.sql` to `sql/clickhouse/backfills/<domain>/mv_<name>.sql`. Fill the header.
3. Run `bash scripts/apply-clickhouse-assets.sh --only <domain>/mv_<name> --force-recreate`.
4. Wire the frontend in `src/lib/analytics.ts` (or the relevant lib). Update `@consumers` in the view's header.
5. Commit both `.sql` files and the regenerated section of this doc.

## Editing an existing view

- **SELECT-body only:** edit and run `apply-clickhouse-assets.sh --only <domain>/<name>`. `CREATE OR REPLACE MATERIALIZED VIEW` applies; target-table data stays; new logic applies to new inserts only.
- **Target-table schema change:** edit and run the same command. Apply blocks with a DDL diff. Re-run with `--force-recreate` to drop + recreate + backfill. The consumer-safety grep warns if dropped/renamed columns are referenced in the files listed in `@consumers`.

## Verification after apply

1. Exit 0 from the apply script.
2. `SELECT count() FROM tidx_4217.<mv_name>` is non-zero (or expected-zero with a note in `@notes`).
3. The frontend page in `@consumers` renders without error at the public URL.
4. `takopi service status takopi-tempo-explorer.service` is `active`.

## Takopi integration

- `takopi service restart takopi-tempo-stack.service` applies all views (current bulk behavior).
- Set `TAKOPI_MV_ONLY=<domain>/<name>` to narrow to one view.
- Set `TAKOPI_MV_FORCE_RECREATE=1` (must be combined with `TAKOPI_MV_ONLY`) to drop and recreate. The sync script passes `--i-know-consumers-break` so the grep is non-blocking in the broker path.

<!-- BEGIN GENERATED -->
<!-- END GENERATED -->
```

### - [ ] Step 2: Create the generator

Create `scripts/gen-data-assets-doc.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOC="$SCRIPT_DIR/../docs/data-assets.md"

GEN="$(python3 <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, "scripts/lib")
from mv_header import parse_header

root = Path("sql/clickhouse/views")
rows = []
for path in sorted(root.rglob("mv_*.sql")):
    h = parse_header(path)
    consumers = ", ".join(f"`{c}`" for c in h["consumers"])
    upstream = ", ".join(f"`{u}`" for u in h["upstream"])
    backfill = h["backfill"]
    if backfill != "none":
        backfill = f"`{backfill}`"
    rows.append({
        "name": h["name"],
        "domain": h["domain"],
        "purpose": h["purpose"],
        "upstream": upstream,
        "consumers": consumers,
        "view": f"`{path.as_posix()}`",
        "backfill": backfill,
    })

print("## Views")
print()
print("| Name | Domain | Purpose | Upstream | Consumers | View SQL | Backfill SQL |")
print("| --- | --- | --- | --- | --- | --- | --- |")
for r in rows:
    print(f"| `{r['name']}` | {r['domain']} | {r['purpose']} | {r['upstream']} | {r['consumers']} | {r['view']} | {r['backfill']} |")
PY
)"

python3 - "$DOC" <<PY
import re, sys
from pathlib import Path
doc_path = Path(sys.argv[1])
text = doc_path.read_text()
gen = """$GEN"""
new = re.sub(
    r"<!-- BEGIN GENERATED -->.*?<!-- END GENERATED -->",
    "<!-- BEGIN GENERATED -->\n" + gen + "\n<!-- END GENERATED -->",
    text,
    count=1,
    flags=re.DOTALL,
)
if new == text:
    print("error: GENERATED markers not found in $DOC", file=sys.stderr)
    sys.exit(2)
doc_path.write_text(new)
PY

echo "regenerated $DOC"
```

Make executable:

```bash
chmod +x scripts/gen-data-assets-doc.sh
```

### - [ ] Step 3: Run it

```bash
bash scripts/gen-data-assets-doc.sh
```
Expected: prints `regenerated docs/data-assets.md`. Inspect the file — the generated block now contains a table with all 15 views.

### - [ ] Step 4: Commit

```bash
git add scripts/gen-data-assets-doc.sh docs/data-assets.md
git commit -m "feat(docs): generate data-assets.md views table from SQL headers"
```

---

## Task 12: Trigger doc regeneration at the end of apply

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

### - [ ] Step 1: Call the generator as the last step

Append to the bottom of `scripts/apply-clickhouse-assets.sh`:

```bash
if bash "$SCRIPT_DIR/gen-data-assets-doc.sh"; then
  :
else
  echo "warning: gen-data-assets-doc.sh failed; doc not regenerated" >&2
fi
```

### - [ ] Step 2: Test

```bash
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only dex/mv_dex_daily
```
Expected: finishes with `regenerated docs/data-assets.md`. `git diff docs/data-assets.md` shows only the banner + table content (stable).

### - [ ] Step 3: Commit

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "feat(apply): regenerate docs/data-assets.md at end of successful apply"
```

---

## Task 13: Forward takopi env vars in the sync script

**Files:**
- Modify: `scripts/takopi_sync_clickhouse_assets.sh`

### - [ ] Step 1: Read current invocation

```bash
grep -n 'apply-clickhouse-assets' scripts/takopi_sync_clickhouse_assets.sh
```

### - [ ] Step 2: Add env-var passthrough above the apply invocation

Insert immediately before the line that executes `apply-clickhouse-assets.sh`:

```bash
APPLY_ARGS=()
if [[ -n "${TAKOPI_MV_ONLY:-}" ]]; then
  APPLY_ARGS+=(--only "$TAKOPI_MV_ONLY")
fi
if [[ "${TAKOPI_MV_FORCE_RECREATE:-0}" == "1" ]]; then
  if [[ -z "${TAKOPI_MV_ONLY:-}" ]]; then
    echo "error: TAKOPI_MV_FORCE_RECREATE=1 requires TAKOPI_MV_ONLY" >&2
    exit 2
  fi
  APPLY_ARGS+=(--force-recreate --i-know-consumers-break)
fi
```

Change the apply call from:

```bash
bash "$REPO_ROOT/scripts/apply-clickhouse-assets.sh"
```

to:

```bash
bash "$REPO_ROOT/scripts/apply-clickhouse-assets.sh" "${APPLY_ARGS[@]}"
```

### - [ ] Step 3: Smoke test the broker path

```bash
TAKOPI_MV_ONLY=dex/mv_dex_daily takopi service restart takopi-tempo-stack.service
takopi service status takopi-tempo-stack.service
journalctl -u takopi-tempo-stack.service -n 50 --no-pager
```
Expected: status `active`; journal shows `Single-view mode: dex/mv_dex_daily` and ends with `regenerated docs/data-assets.md`.

### - [ ] Step 4: Commit

```bash
git add scripts/takopi_sync_clickhouse_assets.sh
git commit -m "feat(takopi): forward TAKOPI_MV_ONLY and TAKOPI_MV_FORCE_RECREATE to apply"
```

---

## Task 14: Scripted integration test

**Files:**
- Create: `scripts/test-apply-flow.sh`

### - [ ] Step 1: Write the test harness

Create `scripts/test-apply-flow.sh`:

```bash
#!/usr/bin/env bash
# End-to-end test for apply-clickhouse-assets.sh against a throwaway ClickHouse DB.
# Requires: CLICKHOUSE_URL pointing at a reachable CH instance.
# Creates tidx_test_<pid>, runs through the full flow, drops it at the end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CLICKHOUSE_URL:=http://127.0.0.1:8123}"
TEST_DB="tidx_test_$$"

cleanup() {
  curl -fsS "${CLICKHOUSE_URL}/" --data-binary "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null || true
}
trap cleanup EXIT

ch() { curl -fsS "${CLICKHOUSE_URL}/?database=${TEST_DB}" --data-binary "$1"; }
ch_root() { curl -fsS "${CLICKHOUSE_URL}/" --data-binary "$1"; }

ch_root "CREATE DATABASE ${TEST_DB}"

# Minimal upstream fixtures so `txs` / `logs` exist
ch "CREATE TABLE txs (block_timestamp DateTime, from String, to String, fee_payer String, call_count UInt32, input String) ENGINE = Memory"
ch "CREATE TABLE logs (block_timestamp DateTime, address String, topics Array(String), data String) ENGINE = Memory"
ch "INSERT INTO txs VALUES (now(), '0xA', '0x0000000000000000000000000000000000000000', '0xA', 1, '0x7b')"

echo "--- Step 1: first install ---"
CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats
ch "SELECT count() FROM _mv_schema WHERE name='mv_daily_stats' FORMAT TSV" | grep -q '^1$'

echo "--- Step 2: idempotent re-apply (hash match) ---"
CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats

echo "--- Step 3: drift blocked without --force-recreate ---"
TARGET="$SCRIPT_DIR/../sql/clickhouse/views/chain/mv_daily_stats.sql"
cp "$TARGET" "$TARGET.bak"
python3 -c "
import sys
p = sys.argv[1]
t = open(p).read().replace('ENGINE = SummingMergeTree', ', extra UInt64\n)\nENGINE = SummingMergeTree', 1)
# Simpler: just append a column before the closing paren of the CREATE TABLE
import re
t = re.sub(r'(inscription_txs UInt64)\n\)', r'\1,\n  extra UInt64\n)', t)
open(p, 'w').write(t)
" "$TARGET"

if CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats 2>/tmp/drift_err; then
  echo "FAIL: expected drift exit" >&2
  mv "$TARGET.bak" "$TARGET"
  exit 1
fi
grep -q "DRIFT DETECTED" /tmp/drift_err || { echo "FAIL: no drift message" >&2; exit 1; }

echo "--- Step 4: --force-recreate succeeds ---"
CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats --force-recreate --i-know-consumers-break
ch "SELECT count() FROM mv_daily_stats FORMAT TSV"
ch "DESCRIBE TABLE mv_daily_stats FORMAT TSV" | grep -q '^extra\s'

mv "$TARGET.bak" "$TARGET"

echo "--- Step 5: restore original via --force-recreate ---"
CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats --force-recreate --i-know-consumers-break

echo "ALL STEPS PASSED"
```

Make executable:

```bash
chmod +x scripts/test-apply-flow.sh
```

### - [ ] Step 2: Run it

```bash
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/test-apply-flow.sh
```
Expected: `ALL STEPS PASSED`. Throwaway DB is dropped on exit.

### - [ ] Step 3: Commit

```bash
git add scripts/test-apply-flow.sh
git commit -m "test(apply): end-to-end script covering install / idempotent / drift / recreate"
```

---

## Task 15: Run Python unit tests as part of validate-data

**Files:**
- Modify: `scripts/validate-data.sh`

### - [ ] Step 1: Append unittest run

Read the current file first:

```bash
cat scripts/validate-data.sh
```

Append to the end of `scripts/validate-data.sh`:

```bash
echo "--- Python unit tests: scripts/lib ---"
(cd "$(dirname "$0")/lib" && python3 -m unittest discover -v -p 'test_*.py')
```

### - [ ] Step 2: Run it

```bash
bash scripts/validate-data.sh
```
Expected: existing validation output plus 14 Python tests passing.

### - [ ] Step 3: Commit

```bash
git add scripts/validate-data.sh
git commit -m "test: wire scripts/lib unittests into validate-data.sh"
```

---

## Task 16: Final manual verification

### - [ ] Step 1: Full-tree apply against live CH

```bash
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh
```
Expected: every view applies with `Target-table DDL unchanged ...`; `_mv_schema` populated for all 15 views; doc regenerates; exit 0.

### - [ ] Step 2: Verify through the takopi broker

```bash
takopi service restart takopi-tempo-stack.service
takopi service status takopi-tempo-stack.service
curl -sS -L -o /dev/null -w 'explorer -> %{http_code}\n' http://localhost:3001
```
Expected: stack active; explorer returns 200.

### - [ ] Step 3: Spot-check one page in the browser

Open the DEX page at `http://localhost:3001/dex` — confirm charts render with data (non-empty).

### - [ ] Step 4: Confirm `_mv_schema` snapshot

```bash
curl -fsS 'http://127.0.0.1:8123/?database=tidx_4217' --data-binary "SELECT name, ddl_hash, applied_at FROM _mv_schema FINAL ORDER BY name FORMAT PrettyCompact"
```
Expected: 15 rows, one per view.
