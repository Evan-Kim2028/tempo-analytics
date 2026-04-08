-- sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql
-- Domain: dex — Protocol DEX (enshrined precompile) daily volume totals
-- Aggregate across all pools — see mv_protocol_dex_pool_daily for per-pool breakdown
-- Renamed from mv_protocol_dex_daily: "volume_totals" clarifies this is swap count + USD volume,
-- aggregated across all pools, for the enshrined Protocol DEX precompile.
-- Contract: 0xdec0000000000000000000000000000000000000
-- Event: 0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd (main swap event, 53K+ occurrences)
-- volume_raw: lo-64 of amount_in uint256 (divide by 1e6 for USD)
-- Apply with scripts/apply-clickhouse-assets.sh

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
