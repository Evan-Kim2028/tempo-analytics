-- sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql
-- Backfill for tidx_4217.mv_stablecoin_supply_daily
-- Apply after sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql

INSERT INTO tidx_4217.mv_stablecoin_supply_daily
SELECT
  toDate(block_timestamp) AS day,
  address                 AS token,
  sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
        topic1 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    - sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
            topic2 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    AS net_raw
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50'
  )
GROUP BY day, token;
