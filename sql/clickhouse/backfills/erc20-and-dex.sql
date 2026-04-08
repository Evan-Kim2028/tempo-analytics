-- sql/clickhouse/backfills/erc20-and-dex.sql
-- Derived from scripts/setup-clickhouse-views-v2.sql
-- Apply after sql/clickhouse/views/erc20-and-dex.sql

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

INSERT INTO tidx_4217.mv_dex_swap_amounts_daily
SELECT
  toDate(block_timestamp), address,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51,  16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 115, 16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 179, 16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 243, 16))))),
  count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;

INSERT INTO tidx_4217.mv_fee_token_daily
SELECT toDate(block_timestamp), fee_token, count()
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY toDate(block_timestamp), fee_token;
