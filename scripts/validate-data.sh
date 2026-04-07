#!/usr/bin/env bash
# scripts/validate-data.sh
# Run: bash scripts/validate-data.sh
# Validates on-chain data integrity against known reference values.
# Reference values established 2026-04-07 from direct RPC + ClickHouse queries.

set -euo pipefail
ERRORS=0

ch() { docker exec tidx-clickhouse-1 clickhouse-client --query "$1"; }
fail() { echo "  FAIL: $1"; ERRORS=$((ERRORS+1)); }
pass() { echo "  PASS: $1"; }

echo "=== Tempo Explorer Data Validation ==="
echo ""

# 1. Total transaction count
echo "1. Transaction count..."
TX_COUNT=$(ch "SELECT count() FROM tidx_4217.txs")
if [ "$TX_COUNT" -ge 15700000 ]; then
  pass "Total txs: $TX_COUNT (≥ 15,700,000)"
else
  fail "Total txs too low: $TX_COUNT (expected ≥ 15,700,000)"
fi

# 2. PG vs CH consistency
echo "2. PostgreSQL ↔ ClickHouse consistency..."
TIDX_STATUS=$(curl -s http://localhost:8080/status)
PG_TX=$(echo "$TIDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['chains'][0]['postgres']['txs_count'])")
CH_TX=$(echo "$TIDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['chains'][0]['clickhouse']['txs_count'])")
DIFF=$(python3 -c "print(abs($CH_TX - $PG_TX))")
PCT=$(python3 -c "print(f'{abs($CH_TX - $PG_TX)/$PG_TX*100:.4f}')")
if python3 -c "exit(0 if abs($CH_TX - $PG_TX) / $PG_TX < 0.001 else 1)"; then
  pass "PG ($PG_TX) ↔ CH ($CH_TX) within 0.1% (diff: $DIFF = $PCT%)"
else
  fail "PG ($PG_TX) ↔ CH ($CH_TX) diverge by $PCT% — re-run tidx or check for gaps"
fi

# 3. Daily stats MV completeness
echo "3. Daily stats completeness..."
DAYS_IN_MV=$(ch "SELECT uniq(day) FROM tidx_4217.mv_daily_stats")
if [ "$DAYS_IN_MV" -ge 20 ]; then
  pass "Daily stats MV has $DAYS_IN_MV days"
else
  fail "Daily stats MV only has $DAYS_IN_MV days — may need backfill"
fi

# 4. Stablecoin total volume sanity (pathUSD)
echo "4. pathUSD all-time transfer volume..."
PATHUSD_VOL=$(ch "SELECT round(sum(volume_u6)/1e6) FROM tidx_4217.mv_stablecoin_daily WHERE token='0x20c0000000000000000000000000000000000000'")
if python3 -c "exit(0 if float('$PATHUSD_VOL') >= 34000000 else 1)"; then
  pass "pathUSD all-time volume: \$$PATHUSD_VOL (≥ \$34M)"
else
  fail "pathUSD volume too low: \$$PATHUSD_VOL — check amount decoding formula"
fi

# 5. USDC.e total volume sanity
echo "5. USDC.e all-time transfer volume..."
USDCE_VOL=$(ch "SELECT round(sum(volume_u6)/1e6) FROM tidx_4217.mv_stablecoin_daily WHERE token='0x20c000000000000000000000b9537d11c60e8b50'")
if python3 -c "exit(0 if float('$USDCE_VOL') >= 21000000 else 1)"; then
  pass "USDC.e all-time volume: \$$USDCE_VOL (≥ \$21M)"
else
  fail "USDC.e volume too low: \$$USDCE_VOL — check amount decoding or MV backfill"
fi

# 6. DEX swap count sanity
echo "6. DEX all-time swap count..."
SWAPS=$(ch "SELECT sum(swap_count) FROM tidx_4217.mv_dex_daily")
if [ "$SWAPS" -ge 55000 ]; then
  pass "Total DEX swaps: $SWAPS (≥ 55,000)"
else
  fail "DEX swaps too low: $SWAPS — check mv_dex_daily backfill"
fi

# 7. NFT transfer count sanity
echo "7. NFT all-time transfer count..."
NFTS=$(ch "SELECT sum(transfers) FROM tidx_4217.mv_nft_daily")
if [ "$NFTS" -ge 100000 ]; then
  pass "Total NFT transfers: $NFTS (≥ 100,000)"
else
  fail "NFT transfers too low: $NFTS — check mv_nft_daily backfill"
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "✓ All checks passed"
else
  echo "✗ $ERRORS check(s) failed"
  exit 1
fi
