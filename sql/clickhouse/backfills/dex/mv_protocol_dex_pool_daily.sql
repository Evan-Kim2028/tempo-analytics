-- sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql
-- Backfill for tidx_4217.mv_protocol_dex_pool_daily
-- Apply after sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql

INSERT INTO tidx_4217.mv_protocol_dex_pool_daily
SELECT
  toDate(block_timestamp)                                               AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))       AS pool_id,
  '0x' || lower(substring(topic3, 27))                                 AS token,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
