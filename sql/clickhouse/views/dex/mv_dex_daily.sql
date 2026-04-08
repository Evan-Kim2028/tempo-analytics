-- sql/clickhouse/views/dex/mv_dex_daily.sql
-- Domain: dex — daily Uniswap V2-compatible DEX swap activity by pair (swap count only)
-- Uniswap V2 Swap event: 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
-- See mv_dex_swap_amounts_daily for decoded amounts
-- Apply with scripts/apply-clickhouse-assets.sh

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
