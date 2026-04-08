-- sql/clickhouse/views/tokens/mv_token_transfers_daily.sql
-- Domain: tokens — daily Transfer event count by token address (ERC-20 + ERC-721)
-- topic3 is not filtered: counts both ERC-20 and ERC-721 Transfer events
-- Apply with scripts/apply-clickhouse-assets.sh

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
