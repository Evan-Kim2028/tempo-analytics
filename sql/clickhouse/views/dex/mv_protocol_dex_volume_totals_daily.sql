-- @name:         mv_protocol_dex_volume_totals_daily
-- @domain:       dex
-- @kind:         materialized_view
-- @purpose:      Protocol DEX (enshrined precompile) daily volume totals across all pools
-- @upstream:     tidx_4217.logs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_volume_totals_daily
(
  day        Date,
  swaps      UInt64,
  volume_raw UInt64   -- lo-64 of amount_in uint256; divide by 1e6 for USD
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_volume_totals_daily_view
TO tidx_4217.mv_protocol_dex_volume_totals_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day;
