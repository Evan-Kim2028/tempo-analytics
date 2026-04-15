-- @name:         mv_daily_uniq
-- @domain:       chain
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_daily_uniq.
-- @pairs:        sql/clickhouse/views/chain/mv_daily_uniq.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_daily_uniq
SELECT toDate(block_timestamp), uniqState(from)
FROM tidx_4217.txs GROUP BY toDate(block_timestamp);
