-- sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql
-- Backfill for tidx_4217.mv_erc20_volume_daily
-- Apply after sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql

INSERT INTO tidx_4217.mv_erc20_volume_daily
SELECT
  toDate(block_timestamp),
  address,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))),
  count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
GROUP BY toDate(block_timestamp), address;
