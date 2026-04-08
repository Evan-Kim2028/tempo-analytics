-- sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql
-- Domain: stablecoins — daily net supply change per whitelisted stablecoin
-- Mints: Transfer from zero address (topic1 = 32-byte zero-padded)
-- Burns: Transfer to zero address (topic2 = 32-byte zero-padded)
-- topic3 IS NULL: distinguishes ERC-20 Transfer from ERC-721 Transfer
-- net_raw: Int64 mints_raw - burns_raw (lo-64 of uint256; divide by 1e6 for USD)
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_stablecoin_supply_daily
(
  day      Date,
  token    String,
  net_raw  Int64    -- mints_raw - burns_raw (lo-64 of uint256)
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_stablecoin_supply_daily_view
TO tidx_4217.mv_stablecoin_supply_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  address                                                               AS token,
  sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
        topic1 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    - sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
            topic2 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    AS net_raw
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',  -- pathUSD
    '0x20c000000000000000000000b9537d11c60e8b50'   -- USDC.e
  )
GROUP BY day, token;
