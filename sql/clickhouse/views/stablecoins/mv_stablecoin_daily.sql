-- @name:         mv_stablecoin_daily
-- @domain:       stablecoins
-- @kind:         materialized_view
-- @purpose:      Daily transfer volume for whitelisted stablecoins (mirrors tokenlist.tempo.xyz)
-- @upstream:     tidx_4217.logs
-- @consumers:    src/app/analytics/page.tsx, src/app/stablecoins/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

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
    '0x20c000000000000000000000b9537d11c60e8b50',  -- USDC.e
    '0x20c0000000000000000000001621e21f71cf12fb',  -- EURC.e
    '0x20c00000000000000000000014f22ca97301eb73',  -- USDT0
    '0x20c0000000000000000000003554d28269e0f3c2',  -- frxUSD
    '0x20c0000000000000000000000520792dcccccccc',  -- cUSD
    '0x20c0000000000000000000008ee4fcff88888888',  -- stcUSD
    '0x20c0000000000000000000005c0bac7cef389a11',  -- GUSD
    '0x20c0000000000000000000007f7ba549dd0251b9',  -- rUSD
    '0x20c000000000000000000000aeed2ec36a54d0e5',  -- wsrUSD
    '0x20c0000000000000000000009a4a4b17e0dc6651',  -- EURAU
    '0x20c000000000000000000000383a23bacb546ab9',  -- reUSD
    '0x20c000000000000000000000ab02d39df30bd17e',  -- iUSD
    '0x20c000000000000000000000048c8f36df1c9a4a',  -- siUSD
    '0x20c0000000000000000000002f52d5cc21a3207b',  -- USDe
    '0x20c000000000000000000000bd95bfb69fbe6ce3',  -- sUSDe
    '0x20c000000000000000000000ae247a1130450f09'   -- SBC
  )
GROUP BY day, token;
