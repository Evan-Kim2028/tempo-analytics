-- @name:         mv_inscription_daily
-- @domain:       chain
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_inscription_daily.
-- @pairs:        sql/clickhouse/views/chain/mv_inscription_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

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
