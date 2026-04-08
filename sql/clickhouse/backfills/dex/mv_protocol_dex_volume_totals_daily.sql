-- sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql
-- Backfill for tidx_4217.mv_protocol_dex_volume_totals_daily
-- Apply after sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql

INSERT INTO tidx_4217.mv_protocol_dex_volume_totals_daily
SELECT
  toDate(block_timestamp),
  count(),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY toDate(block_timestamp);
