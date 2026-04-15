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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLICKHOUSE_BASE_URL="${CLICKHOUSE_URL%/}"
DEFAULT_CLICKHOUSE_DB="tidx_4217"

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

ensure_mv_schema() {
  run_sql "$SCRIPT_DIR/../sql/clickhouse/system/_mv_schema.sql"
}

ensure_mv_schema

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
  fi
fi
