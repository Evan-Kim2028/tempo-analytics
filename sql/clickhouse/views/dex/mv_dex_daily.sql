-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         materialized_view
-- @purpose:      Daily Uniswap V2-compatible DEX swap activity by pair (swap count only)
-- @upstream:     tidx_4217.logs
-- @consumers:    src/app/analytics/page.tsx, src/app/dex/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_dex_daily
(
  day        Date,
  pair       String,
  swap_count UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, pair);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_dex_daily_view
TO tidx_4217.mv_dex_daily
AS SELECT
  toDate(block_timestamp)  AS day,
  address                  AS pair,
  count()                  AS swap_count
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY day, pair;
