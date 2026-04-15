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

export GEN DOC
python3 - <<'PY'
import os, re, sys
from pathlib import Path
doc_path = Path(os.environ["DOC"])
gen = os.environ["GEN"]
text = doc_path.read_text()
pattern = re.compile(r"<!-- BEGIN GENERATED -->.*?<!-- END GENERATED -->", re.DOTALL)
if not pattern.search(text):
    print(f"error: GENERATED markers not found in {doc_path}", file=sys.stderr)
    sys.exit(2)
new = pattern.sub(
    lambda m: "<!-- BEGIN GENERATED -->\n" + gen + "\n<!-- END GENERATED -->",
    text,
    count=1,
)
doc_path.write_text(new)
PY

echo "regenerated $DOC"
