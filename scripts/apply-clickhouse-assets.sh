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

run_sql() {
  local file="$1"

  echo "Applying $file"
  rewrite_sql_for_db "$file" | \
  curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
    --data-binary @- \
    >/dev/null
}

find "$SCRIPT_DIR/../sql/clickhouse/views" -name "*.sql" | sort | while read -r f; do
  run_sql "$f"
done

if [ -n "$CLICKHOUSE_RUN_BACKFILLS" ] && [ "$CLICKHOUSE_RUN_BACKFILLS" -gt 0 ]; then
  echo "CLICKHOUSE_RUN_BACKFILLS=$CLICKHOUSE_RUN_BACKFILLS; applying historical backfills in parallel."
  export CLICKHOUSE_BASE_URL CLICKHOUSE_DB DEFAULT_CLICKHOUSE_DB
  export -f run_sql rewrite_sql_for_db
  find "$SCRIPT_DIR/../sql/clickhouse/backfills" -name "*.sql" | sort | \
    xargs -P "$CLICKHOUSE_RUN_BACKFILLS" -I{} bash -c 'run_sql "$@"' _ {}
else
  echo "Skipping historical backfills by default."
  echo "Set CLICKHOUSE_RUN_BACKFILLS=N to run N backfill SQL files concurrently (e.g. CLICKHOUSE_RUN_BACKFILLS=4)."
fi
