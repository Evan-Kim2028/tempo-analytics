-- @name:         mv_token_transfers_daily
-- @domain:       tokens
-- @kind:         materialized_view
-- @purpose:      Daily Transfer event count by token address (ERC-20 and ERC-721)
-- @upstream:     tidx_4217.logs
-- @consumers:    src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_token_transfers_daily
(
  day             Date,
  token           String,
  transfer_count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_token_transfers_daily_view
TO tidx_4217.mv_token_transfers_daily
AS SELECT
  toDate(block_timestamp)   AS day,
  address                   AS token,
  count()                   AS transfer_count
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
GROUP BY day, token;
