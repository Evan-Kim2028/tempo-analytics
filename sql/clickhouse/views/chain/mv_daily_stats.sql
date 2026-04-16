-- @name:         mv_daily_stats
-- @domain:       chain
-- @kind:         materialized_view
-- @purpose:      Daily transaction type breakdown by chain
-- @upstream:     tidx_4217.txs
-- @consumers:    src/app/analytics/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/chain/mv_daily_stats.sql
-- @notes:        batch_txs currently uses call_count > 1 to represent multi-call Tempo envelopes.
-- @notes:        sponsored_txs currently uses fee_payer != from as the explorer sponsorship predicate.
-- @notes:        user_txs/protocol_txs/inscription_txs are explorer heuristics, not Tempo protocol categories.
-- @notes:        inscription_txs identifies calldata starting with 0x7b (ASCII "{").
-- @owner:        evan
-- @since:        2026-04-15
--

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
