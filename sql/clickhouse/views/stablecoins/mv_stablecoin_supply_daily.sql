-- @name:         mv_stablecoin_supply_daily
-- @domain:       stablecoins
-- @kind:         materialized_view
-- @purpose:      Daily net supply change per whitelisted stablecoin (mints minus burns)
-- @upstream:     tidx_4217.logs
-- @consumers:    src/app/stablecoins/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

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
