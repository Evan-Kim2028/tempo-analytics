-- sql/clickhouse/views/chain/mv_daily_stats.sql
-- Domain: chain — daily transaction type breakdown
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_daily_stats
(
  day             Date,
  txs             UInt64,
  batch_txs       UInt64,
  sponsored_txs   UInt64,
  user_txs        UInt64,
  protocol_txs    UInt64,
  inscription_txs UInt64
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_daily_stats_view
TO tidx_4217.mv_daily_stats
AS SELECT
  toDate(block_timestamp)                                                       AS day,
  count()                                                                       AS txs,
  countIf(call_count > 1)                                                      AS batch_txs,
  countIf(fee_payer != from)                                                   AS sponsored_txs,
  countIf(
    to != '0x0000000000000000000000000000000000000000'
    AND NOT startsWith(lower(input), '0x7b')
  )                                                                            AS user_txs,
  countIf(
    to = '0x0000000000000000000000000000000000000000'
    AND NOT startsWith(lower(input), '0x7b')
  )                                                                            AS protocol_txs,
  countIf(startsWith(lower(input), '0x7b'))                                   AS inscription_txs
FROM tidx_4217.txs
GROUP BY day;
