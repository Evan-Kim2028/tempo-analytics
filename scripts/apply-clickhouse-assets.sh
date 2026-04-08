#!/usr/bin/env bash
set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL is required}"
: "${CLICKHOUSE_DB:=tidx_4217}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLICKHOUSE_BASE_URL="${CLICKHOUSE_URL%/}"

run_sql() {
  local file="$1"

  echo "Applying $file"
  curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
    --data-binary @"$file" \
    >/dev/null
}

run_sql "${SCRIPT_DIR}/../sql/clickhouse/views/core.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/views/erc20-and-dex.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/views/protocol-dex.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/backfills/core.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/backfills/erc20-and-dex.sql"
run_sql "${SCRIPT_DIR}/../sql/clickhouse/backfills/protocol-dex.sql"
