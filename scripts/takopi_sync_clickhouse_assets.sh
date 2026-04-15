#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${CLICKHOUSE_URL:=http://127.0.0.1:8123}"
: "${CLICKHOUSE_DB:=tidx_4217}"
: "${TIDX_HEALTH_URL:=http://127.0.0.1:8080/health}"
: "${TAKOPI_TEMPO_CLICKHOUSE_BOOTSTRAP_MARKER:=/srv/takopi/state/tempo-analytics/.clickhouse-assets-bootstrap-v1}"

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "timed out waiting for ${label}: ${url}" >&2
  return 1
}

ch_query() {
  local sql="$1"
  curl -fsS "${CLICKHOUSE_URL}/?database=${CLICKHOUSE_DB}" --data-binary "$sql"
}

required_asset_names() {
  find "$REPO_ROOT/sql/clickhouse/views" -type f -name 'mv_*.sql' -printf '%f\n' | \
    sed 's/\.sql$//' | sort -u
}

reset_existing_assets() {
  local rows
  rows="$(ch_query "SELECT name, engine FROM system.tables WHERE database='${CLICKHOUSE_DB}' AND name LIKE 'mv_%' ORDER BY engine = 'MaterializedView' DESC, name FORMAT TSV")"
  if [[ -z "$rows" ]]; then
    return 0
  fi

  while IFS=$'\t' read -r name engine; do
    [[ -n "$name" ]] || continue
    if [[ "$engine" == "MaterializedView" ]]; then
      echo "Dropping existing materialized view ${CLICKHOUSE_DB}.${name}"
      ch_query "DROP VIEW IF EXISTS ${CLICKHOUSE_DB}.${name}"
    else
      echo "Dropping existing table ${CLICKHOUSE_DB}.${name}"
      ch_query "DROP TABLE IF EXISTS ${CLICKHOUSE_DB}.${name}"
    fi
  done <<< "$rows"
}

wait_for_clickhouse_tables() {
  local attempt
  for attempt in $(seq 1 60); do
    local table_count
    table_count="$(ch_query "SELECT count() FROM system.tables WHERE database='${CLICKHOUSE_DB}' AND name IN ('blocks','txs','logs','receipts')" || true)"
    if [[ "$table_count" == "4" ]]; then
      return 0
    fi
    sleep 2
  done
  echo "timed out waiting for raw ClickHouse tables in ${CLICKHOUSE_DB}" >&2
  return 1
}

verify_required_assets() {
  local missing=()
  local name
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    local present
    present="$(ch_query "SELECT count() FROM system.tables WHERE database='${CLICKHOUSE_DB}' AND name='${name}'")"
    if [[ "$present" != "1" ]]; then
      missing+=("$name")
    fi
  done < <(required_asset_names)

  if (( ${#missing[@]} > 0 )); then
    printf 'required ClickHouse analytics assets missing in %s: %s\n' \
      "$CLICKHOUSE_DB" "${missing[*]}" >&2
    return 1
  fi
}

mkdir -p "$(dirname "$TAKOPI_TEMPO_CLICKHOUSE_BOOTSTRAP_MARKER")"

wait_for_http "$CLICKHOUSE_URL" "ClickHouse HTTP"
wait_for_http "$TIDX_HEALTH_URL" "tidx health"
wait_for_clickhouse_tables

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

if [[ -f "$TAKOPI_TEMPO_CLICKHOUSE_BOOTSTRAP_MARKER" ]]; then
  echo "Applying ClickHouse view definitions for ${CLICKHOUSE_DB}"
  CLICKHOUSE_RUN_BACKFILLS=0 CLICKHOUSE_URL="$CLICKHOUSE_URL" CLICKHOUSE_DB="$CLICKHOUSE_DB" \
    bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" "${APPLY_ARGS[@]}"
else
  echo "Bootstrapping ClickHouse analytics assets for ${CLICKHOUSE_DB}"
  reset_existing_assets
  CLICKHOUSE_RUN_BACKFILLS=1 CLICKHOUSE_URL="$CLICKHOUSE_URL" CLICKHOUSE_DB="$CLICKHOUSE_DB" \
    bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" "${APPLY_ARGS[@]}"
  touch "$TAKOPI_TEMPO_CLICKHOUSE_BOOTSTRAP_MARKER"
fi

verify_required_assets
echo "ClickHouse analytics assets ready for ${CLICKHOUSE_DB}"
