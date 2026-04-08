-- sql/clickhouse/backfills/dex/mv_protocol_dex_pool_dau_daily.sql
-- Backfill for tidx_4217.mv_protocol_dex_pool_dau_daily
-- Apply after sql/clickhouse/views/dex/mv_protocol_dex_pool_dau_daily.sql

INSERT INTO tidx_4217.mv_protocol_dex_pool_dau_daily
SELECT
  toDate(block_timestamp)                                               AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))       AS pool_id,
  '0x' || lower(substring(topic3, 27))                                 AS token,
  uniqState('0x' || lower(substring(topic2, 27)))                      AS dau_state
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
