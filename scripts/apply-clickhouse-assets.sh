#!/usr/bin/env bash
# Apply repo-owned ClickHouse assets against an external ClickHouse service.
# Definitions are safe to re-run.
# Historical backfills are skipped by default to avoid double-counting SummingMergeTree data.
# Set CLICKHOUSE_RUN_BACKFILLS=1 to run the backfill SQL files explicitly.

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

run_sql "${SCRIPT_DIR}/../sql/clickhouse/views/core.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/views/erc20-and-dex.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/views/protocol-dex.sql"

if [ "${CLICKHOUSE_RUN_BACKFILLS}" = "1" ]; then
  echo "CLICKHOUSE_RUN_BACKFILLS=1; applying historical backfills."
  run_sql "${SCRIPT_DIR}/../sql/clickhouse/backfills/core.sql"
  run_sql "${SCRIPT_DIR}/../sql/clickhouse/backfills/erc20-and-dex.sql"
  run_sql "${SCRIPT_DIR}/../sql/clickhouse/backfills/protocol-dex.sql"
else
  echo "Skipping historical backfills by default."
  echo "Set CLICKHOUSE_RUN_BACKFILLS=1 to run repo-owned backfill SQL explicitly."
fi
