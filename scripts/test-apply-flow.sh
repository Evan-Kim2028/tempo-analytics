#!/usr/bin/env bash
# End-to-end test for apply-clickhouse-assets.sh against a throwaway ClickHouse DB.
# Requires: CLICKHOUSE_URL pointing at a reachable CH instance.
# Creates tidx_test_<pid>, runs through the full flow, drops it at the end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CLICKHOUSE_URL:=http://127.0.0.1:8123}"
TEST_DB="tidx_test_$$"

TARGET="$(cd "$SCRIPT_DIR/.." && pwd)/sql/clickhouse/views/chain/mv_daily_stats.sql"
cleanup() {
  if [[ -f "$TARGET.bak" ]]; then
    mv -f "$TARGET.bak" "$TARGET"
  fi
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
cp "$TARGET" "$TARGET.bak"
python3 -c "
import sys
p = sys.argv[1]
t = open(p).read()
t = t.replace('inscription_txs UInt64', 'inscription_txs UInt32')
open(p, 'w').write(t)
" "$TARGET"

if CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats 2>/tmp/drift_err; then
  echo "FAIL: expected drift exit" >&2
  exit 1
fi
grep -q "DRIFT DETECTED" /tmp/drift_err || { echo "FAIL: no drift message" >&2; exit 1; }

echo "--- Step 4: --force-recreate succeeds ---"
CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats --force-recreate --i-know-consumers-break
ch "SELECT count() FROM mv_daily_stats FORMAT TSV"
ch "DESCRIBE TABLE mv_daily_stats FORMAT TSV" | grep -E '^inscription_txs\s+UInt32' >/dev/null || { echo "FAIL: inscription_txs column type not UInt32" >&2; exit 1; }

mv "$TARGET.bak" "$TARGET"

echo "--- Step 5: restore original via --force-recreate ---"
CLICKHOUSE_DB="$TEST_DB" bash "$SCRIPT_DIR/apply-clickhouse-assets.sh" --only chain/mv_daily_stats --force-recreate --i-know-consumers-break

echo "ALL STEPS PASSED"
