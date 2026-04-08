-- sql/clickhouse/backfills/protocol-dex.sql
-- Derived from scripts/setup-clickhouse-views-v3.sql
-- Apply after sql/clickhouse/views/protocol-dex.sql

INSERT INTO tidx_4217.mv_protocol_dex_daily
SELECT
  toDate(block_timestamp),
  count(),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY toDate(block_timestamp);

-- Backfill for mv_protocol_dex_pool_daily
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
