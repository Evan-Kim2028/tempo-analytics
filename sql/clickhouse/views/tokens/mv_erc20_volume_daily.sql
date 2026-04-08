-- sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql
-- Domain: tokens — daily ERC-20 transfer volume across all tokens (~2600+ tokens)
-- topic3 IS NULL distinguishes ERC-20 from ERC-721 (same Transfer selector)
-- volume_raw: raw uint256 lo-64 (divide by 10^decimals at query time)
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_erc20_volume_daily
(
  day        Date,
  token      String,
  volume_raw UInt64,
  transfers  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_erc20_volume_daily_view
TO tidx_4217.mv_erc20_volume_daily
AS SELECT
  toDate(block_timestamp)                                                AS day,
  address                                                               AS token,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw,
  count()                                                               AS transfers
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
GROUP BY day, token;
