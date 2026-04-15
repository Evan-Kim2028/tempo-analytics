-- @name:         mv_nft_daily
-- @domain:       nfts
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_nft_daily.
-- @pairs:        sql/clickhouse/views/nfts/mv_nft_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_nft_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
GROUP BY toDate(block_timestamp), address;
