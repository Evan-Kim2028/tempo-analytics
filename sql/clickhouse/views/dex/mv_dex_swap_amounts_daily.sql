-- @name:         mv_dex_swap_amounts_daily
-- @domain:       dex
-- @kind:         materialized_view
-- @purpose:      Daily decoded Uniswap V2 swap amounts by pair
-- @upstream:     tidx_4217.logs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_dex_swap_amounts_daily
(
  day         Date,
  pair        String,
  amount0In   UInt64,
  amount1In   UInt64,
  amount0Out  UInt64,
  amount1Out  UInt64,
  swap_count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, pair);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_dex_swap_amounts_daily_view
TO tidx_4217.mv_dex_swap_amounts_daily
AS SELECT
  toDate(block_timestamp)                                                AS day,
  address                                                               AS pair,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51,  16)))))   AS amount0In,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 115, 16)))))   AS amount1In,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 179, 16)))))   AS amount0Out,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 243, 16)))))   AS amount1Out,
  count()                                                               AS swap_count
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY day, pair;
