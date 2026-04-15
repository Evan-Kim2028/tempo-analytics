#!/usr/bin/env bash
# scripts/validate-data.sh
# Run: CLICKHOUSE_URL=http://localhost:8123 TIDX_URL=http://localhost:8080 CLICKHOUSE_DB=tidx_4217 bash scripts/validate-data.sh
# Validates on-chain data integrity against known reference values.
# Reference values established 2026-04-07 from direct RPC + ClickHouse queries.

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL is required}"
: "${TIDX_URL:?TIDX_URL is required}"
: "${CLICKHOUSE_DB:=tidx_4217}"

ERRORS=0
CLICKHOUSE_BASE_URL="${CLICKHOUSE_URL%/}"
TIDX_BASE_URL="${TIDX_URL%/}"

ch() {
  curl -fsS \
    --data-urlencode "query=$1" \
    "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}"
}

fail() {
  echo "  FAIL: $1"
  ERRORS=$((ERRORS + 1))
}

pass() {
  echo "  PASS: $1"
}

echo "=== Tempo Explorer Data Validation ==="
echo ""

echo "0. Python unittests (header + DDL helpers)..."
SCRIPT_DIR_VD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ( cd "$SCRIPT_DIR_VD/lib" && python3 -m unittest discover -v -p 'test_*.py' ) >/tmp/mv_unittest.log 2>&1; then
  pass "Python unittests: $(grep -oE 'Ran [0-9]+ tests' /tmp/mv_unittest.log | head -1)"
else
  fail "Python unittests failed; see /tmp/mv_unittest.log"
  cat /tmp/mv_unittest.log
fi

echo "1. Transaction count..."
TX_COUNT=$(ch "SELECT count() FROM ${CLICKHOUSE_DB}.txs")
if [ "$TX_COUNT" -ge 15700000 ]; then
  pass "Total txs: $TX_COUNT (>= 15,700,000)"
else
  fail "Total txs too low: $TX_COUNT (expected >= 15,700,000)"
fi

echo "2. PostgreSQL <-> ClickHouse consistency..."
TIDX_STATUS=$(curl -fsS "${TIDX_BASE_URL}/status")
PG_TX=$(echo "$TIDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['chains'][0]['postgres']['txs_count'])")
CH_TX=$(echo "$TIDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['chains'][0]['clickhouse']['txs_count'])")
DIFF=$(python3 -c "print(abs($CH_TX - $PG_TX))")
PCT=$(python3 -c "print(f'{abs($CH_TX - $PG_TX)/$PG_TX*100:.4f}')")
if python3 -c "exit(0 if abs($CH_TX - $PG_TX) / $PG_TX < 0.001 else 1)"; then
  pass "PG ($PG_TX) <-> CH ($CH_TX) within 0.1% (diff: $DIFF = $PCT%)"
else
  fail "PG ($PG_TX) <-> CH ($CH_TX) diverge by $PCT% - re-run tidx or check for gaps"
fi

echo "3. Daily stats completeness..."
DAYS_IN_MV=$(ch "SELECT uniq(day) FROM ${CLICKHOUSE_DB}.mv_daily_stats")
if [ "$DAYS_IN_MV" -ge 20 ]; then
  pass "Daily stats MV has $DAYS_IN_MV days"
else
  fail "Daily stats MV only has $DAYS_IN_MV days - may need backfill"
fi

echo "4. Daily unique-sender MV has matching day coverage..."
UNIQ_DAYS_IN_MV=$(ch "SELECT uniq(day) FROM ${CLICKHOUSE_DB}.mv_daily_uniq")
if [ "$UNIQ_DAYS_IN_MV" -eq "$DAYS_IN_MV" ]; then
  pass "Daily unique-sender MV day coverage matches mv_daily_stats: $UNIQ_DAYS_IN_MV days"
else
  fail "Daily unique-sender MV coverage mismatch: mv_daily_uniq=$UNIQ_DAYS_IN_MV vs mv_daily_stats=$DAYS_IN_MV"
fi

echo "5. Inscription MV has recent mint activity..."
INSCRIPTION_MINTS=$(ch "SELECT sum(count) FROM ${CLICKHOUSE_DB}.mv_inscription_daily WHERE op = 'mint'")
if [ "${INSCRIPTION_MINTS}" -ge 1000 ]; then
  pass "Inscription MV total mint rows: $INSCRIPTION_MINTS (>= 1,000)"
else
  fail "Inscription MV mint activity too low: $INSCRIPTION_MINTS - check mv_inscription_daily backfill"
fi

echo "6. ERC-20 daily volume MV covers pathUSD..."
PATHUSD_VOL=$(ch "SELECT round(sum(volume_raw)/1e6) FROM ${CLICKHOUSE_DB}.mv_erc20_volume_daily WHERE token='0x20c0000000000000000000000000000000000000'")
if python3 -c "exit(0 if float('$PATHUSD_VOL') >= 34000000 else 1)"; then
  pass "pathUSD all-time ERC-20 volume: \$$PATHUSD_VOL (>= \$34M)"
else
  fail "pathUSD ERC-20 volume too low: \$$PATHUSD_VOL - check mv_erc20_volume_daily"
fi

echo "7. Fee-token MV has recent data..."
FEE_TOKEN_30D=$(ch "SELECT sum(txs) FROM ${CLICKHOUSE_DB}.mv_fee_token_daily WHERE day >= today() - 30")
if [ "${FEE_TOKEN_30D}" -ge 1000 ]; then
  pass "Fee-token MV 30d txs: $FEE_TOKEN_30D (>= 1,000)"
else
  fail "Fee-token MV too low: $FEE_TOKEN_30D - check mv_fee_token_daily backfill"
fi

echo "8. Community DEX decoded swap MV matches swap-count MV..."
DEX_SWAP_COUNTS=$(ch "SELECT sum(swap_count) FROM ${CLICKHOUSE_DB}.mv_dex_daily")
DEX_DECODED_COUNTS=$(ch "SELECT sum(swap_count) FROM ${CLICKHOUSE_DB}.mv_dex_swap_amounts_daily")
if [ "$DEX_SWAP_COUNTS" = "$DEX_DECODED_COUNTS" ]; then
  pass "Community DEX swap counts agree: $DEX_SWAP_COUNTS"
else
  fail "Community DEX MV mismatch: mv_dex_daily=$DEX_SWAP_COUNTS vs mv_dex_swap_amounts_daily=$DEX_DECODED_COUNTS"
fi

echo "9. Protocol DEX MV has expected swap volume..."
PROTOCOL_SWAPS=$(ch "SELECT sum(swaps) FROM ${CLICKHOUSE_DB}.mv_protocol_dex_daily")
PROTOCOL_VOL=$(ch "SELECT round(sum(volume_raw)/1e6) FROM ${CLICKHOUSE_DB}.mv_protocol_dex_daily")
if python3 -c "exit(0 if float('$PROTOCOL_SWAPS') >= 50000 and float('$PROTOCOL_VOL') >= 1000000 else 1)"; then
  pass "Protocol DEX swaps: $PROTOCOL_SWAPS, volume: \$$PROTOCOL_VOL"
else
  fail "Protocol DEX MV looks low: swaps=$PROTOCOL_SWAPS volume=\$$PROTOCOL_VOL"
fi

echo "10. USDC.e all-time ERC-20 transfer volume..."
USDCE_VOL=$(ch "SELECT round(sum(volume_raw)/1e6) FROM ${CLICKHOUSE_DB}.mv_erc20_volume_daily WHERE token='0x20c000000000000000000000b9537d11c60e8b50'")
if python3 -c "exit(0 if float('$USDCE_VOL') >= 21000000 else 1)"; then
  pass "USDC.e all-time ERC-20 volume: \$$USDCE_VOL (>= \$21M)"
else
  fail "USDC.e ERC-20 volume too low: \$$USDCE_VOL - check mv_erc20_volume_daily"
fi

echo "11. NFT all-time transfer count..."
NFTS=$(ch "SELECT sum(transfers) FROM ${CLICKHOUSE_DB}.mv_nft_daily")
if [ "$NFTS" -ge 100000 ]; then
  pass "Total NFT transfers: $NFTS (>= 100,000)"
else
  fail "NFT transfers too low: $NFTS - check mv_nft_daily backfill"
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "PASS: all checks passed"
else
  echo "FAIL: $ERRORS check(s) failed"
  exit 1
fi
