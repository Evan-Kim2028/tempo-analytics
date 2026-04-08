-- sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql
-- Domain: stablecoins — daily transfer volume for whitelisted stablecoins
-- Tracks pathUSD (0x20c0...0000) and USDC.e (0x20c0...b9537d11c60e8b50) only
-- volume_u6: raw uint256 lo-64 (divide by 1e6 for USD — both tokens have decimals=6)
-- topic3 IS NULL: distinguishes ERC-20 Transfer from ERC-721 Transfer
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_stablecoin_daily
(
  day       Date,
  token     String,
  volume_u6 UInt64,   -- sum of raw amounts (6 decimal places for these tokens)
  transfers UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_stablecoin_daily_view
TO tidx_4217.mv_stablecoin_daily
AS SELECT
  toDate(block_timestamp)                                                AS day,
  address                                                               AS token,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_u6,
  count()                                                               AS transfers
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',  -- pathUSD
    '0x20c000000000000000000000b9537d11c60e8b50'   -- USDC.e
  )
GROUP BY day, token;
