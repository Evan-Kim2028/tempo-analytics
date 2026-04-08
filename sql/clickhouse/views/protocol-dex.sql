-- sql/clickhouse/views/protocol-dex.sql
-- Derived from scripts/setup-clickhouse-views-v3.sql
-- Apply with scripts/apply-clickhouse-assets.sh

-- ─────────────────────────────────────────────
-- Enshrined DEX (Protocol Precompile) daily stats
-- Contract: 0xdec0000000000000000000000000000000000000
-- Event: 0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd (main swap event, 53K+ occurrences)
-- Data layout: amount_in lo-64 = substring(data, 51, 16), divide by 1e6 for USD
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_daily
(
  day        Date,
  swaps      UInt64,
  volume_raw UInt64   -- lo-64 of amount_in uint256; divide by 1e6 for USD
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_daily_view
TO tidx_4217.mv_protocol_dex_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day;
