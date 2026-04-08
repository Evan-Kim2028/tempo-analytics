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
