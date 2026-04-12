#!/usr/bin/env bash
# Apply repo-owned ClickHouse assets against an external ClickHouse service.
# Definitions are safe to re-run.
# Historical backfills are skipped by default to avoid double-counting SummingMergeTree data.
# Set CLICKHOUSE_RUN_BACKFILLS=N to run N backfill SQL files concurrently (e.g. CLICKHOUSE_RUN_BACKFILLS=4).

# Views are applied in arbitrary filesystem order (alphabetical by path).
# This is intentional — all views read directly from base tables (txs, logs)
# and no view depends on another. If a cross-view dependency is introduced
# in the future, this script must be updated with explicit ordering.

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL is required}"
: "${CLICKHOUSE_DB:=tidx_4217}"
: "${CLICKHOUSE_RUN_BACKFILLS:=0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLICKHOUSE_BASE_URL="${CLICKHOUSE_URL%/}"
DEFAULT_CLICKHOUSE_DB="tidx_4217"

rewrite_sql_for_db() {
  local file="$1"

  python3 - "$file" "$DEFAULT_CLICKHOUSE_DB" "$CLICKHOUSE_DB" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source_db = sys.argv[2]
target_db = sys.argv[3]

sys.stdout.write(path.read_text().replace(f"{source_db}.", f"{target_db}."))
PY
}

emit_sql_statements() {
  local file="$1"

  python3 - "$file" "$DEFAULT_CLICKHOUSE_DB" "$CLICKHOUSE_DB" <<'PY'
import base64
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
source_db = sys.argv[2]
target_db = sys.argv[3]

text = path.read_text().replace(f"{source_db}.", f"{target_db}.")
text = re.sub(r'--.*$', '', text, flags=re.MULTILINE)

statements = []
parts = []
in_single = False
in_double = False
escape = False

for ch in text:
    if escape:
        parts.append(ch)
        escape = False
        continue
    if ch == "\\" and (in_single or in_double):
        parts.append(ch)
        escape = True
        continue
    if ch == "'" and not in_double:
        in_single = not in_single
        parts.append(ch)
        continue
    if ch == '"' and not in_single:
        in_double = not in_double
        parts.append(ch)
        continue
    if ch == ";" and not in_single and not in_double:
        statement = "".join(parts).strip()
        if statement:
            statements.append(statement)
        parts = []
        continue
    parts.append(ch)

statement = "".join(parts).strip()
if statement:
    statements.append(statement)

for statement in statements:
    sys.stdout.write(base64.b64encode(statement.encode("utf-8")).decode("ascii"))
    sys.stdout.write("\n")
PY
}

run_sql() {
  local file="$1"
  local encoded_statement
  local statements_file

  statements_file="$(mktemp)"
  emit_sql_statements "$file" > "$statements_file"

  echo "Applying $file"
  while IFS= read -r encoded_statement; do
    [[ -n "$encoded_statement" ]] || continue
    printf '%s' "$encoded_statement" | base64 --decode | \
    curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
      --data-binary @- \
      >/dev/null
  done < "$statements_file"

  rm -f "$statements_file"
}

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
