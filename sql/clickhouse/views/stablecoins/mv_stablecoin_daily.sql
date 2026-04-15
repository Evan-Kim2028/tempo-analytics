-- @name:         mv_stablecoin_daily
-- @domain:       stablecoins
-- @kind:         materialized_view
-- @purpose:      Daily transfer volume for whitelisted stablecoins (pathUSD and USDC.e)
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
    '0x20c000000000000000000000b9537d11c60e8b50'   -- USDC.e
  )
GROUP BY day, token;
