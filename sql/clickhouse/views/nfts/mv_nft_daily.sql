-- @name:         mv_nft_daily
-- @domain:       nfts
-- @kind:         materialized_view
-- @purpose:      Daily ERC-721 transfer activity by collection
-- @upstream:     tidx_4217.logs
-- @consumers:    src/app/analytics/page.tsx, src/app/nfts/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/nfts/mv_nft_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_nft_daily
(
  day        Date,
  collection String,
  transfers  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, collection);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_nft_daily_view
TO tidx_4217.mv_nft_daily
AS SELECT
  toDate(block_timestamp)  AS day,
  address                  AS collection,
  count()                  AS transfers
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
GROUP BY day, collection;
