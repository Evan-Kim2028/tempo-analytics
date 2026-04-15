-- @name:         mv_fee_token_daily
-- @domain:       chain
-- @kind:         materialized_view
-- @purpose:      Daily fee token usage (AA: fee paid in stablecoin vs native)
-- @upstream:     tidx_4217.txs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/chain/mv_fee_token_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_fee_token_daily
(
  day       Date,
  fee_token String,
  txs       UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, fee_token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_fee_token_daily_view
TO tidx_4217.mv_fee_token_daily
AS SELECT
  toDate(block_timestamp) AS day,
  fee_token,
  count()                 AS txs
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY day, fee_token;
