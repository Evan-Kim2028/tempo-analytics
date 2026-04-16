-- @name:         mv_daily_stats
-- @domain:       chain
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_daily_stats.
-- @pairs:        sql/clickhouse/views/chain/mv_daily_stats.sql
-- @notes:        Keep predicates aligned with sql/clickhouse/views/chain/mv_daily_stats.sql.
-- @notes:        This backfill preserves existing explorer heuristics and does not define protocol categories.
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_daily_stats
SELECT
  toDate(block_timestamp),
  count(),
  countIf(call_count > 1),
  countIf(fee_payer != from),
  countIf(to != '0x0000000000000000000000000000000000000000' AND NOT startsWith(lower(input), '0x7b')),
  countIf(to = '0x0000000000000000000000000000000000000000' AND NOT startsWith(lower(input), '0x7b')),
  countIf(startsWith(lower(input), '0x7b'))
FROM tidx_4217.txs GROUP BY toDate(block_timestamp);
