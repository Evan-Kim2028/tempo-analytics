-- sql/clickhouse/views/chain/mv_fee_token_daily.sql
-- Domain: chain — daily fee token usage (AA: fee paid in stablecoin vs native)
-- Apply with scripts/apply-clickhouse-assets.sh

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
