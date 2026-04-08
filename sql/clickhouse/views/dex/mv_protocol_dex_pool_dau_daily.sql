-- sql/clickhouse/views/dex/mv_protocol_dex_pool_dau_daily.sql
-- Domain: dex — Protocol DEX per-pool daily active users (unique taker addresses)
-- topic2: taker address (32-byte padded); strip padding to get 20-byte address
-- Same swap event selector as mv_protocol_dex_pool_daily
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_pool_dau_daily
(
  day       Date,
  pool_id   UInt64,
  token     String,
  dau_state AggregateFunction(uniq, Nullable(String))
)
ENGINE = AggregatingMergeTree
ORDER BY (day, pool_id, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_pool_dau_daily_view
TO tidx_4217.mv_protocol_dex_pool_dau_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))       AS pool_id,
  '0x' || lower(substring(topic3, 27))                                 AS token,
  uniqState('0x' || lower(substring(topic2, 27)))                      AS dau_state
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
