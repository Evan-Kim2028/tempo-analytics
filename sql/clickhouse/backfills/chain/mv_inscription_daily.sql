-- sql/clickhouse/backfills/chain/mv_inscription_daily.sql
-- Backfill for tidx_4217.mv_inscription_daily
-- Apply after sql/clickhouse/views/chain/mv_inscription_daily.sql

INSERT INTO tidx_4217.mv_inscription_daily
SELECT
  toDate(block_timestamp),
  JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'op'),
  upper(JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'tick')),
  count()
FROM tidx_4217.txs WHERE startsWith(lower(input), '0x7b')
GROUP BY toDate(block_timestamp),
         JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'op'),
         upper(JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'tick'));
