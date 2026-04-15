-- @name:         backfill_TEMPLATE
-- @domain:       REPLACE_ME
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_TEMPLATE.
-- @pairs:        sql/clickhouse/views/REPLACE_ME/mv_TEMPLATE.sql
-- @owner:        evan
-- @since:        YYYY-MM-DD

INSERT INTO tidx_4217.mv_TEMPLATE
SELECT
  toDate(block_timestamp) AS day
  -- add aggregates matching the view
FROM tidx_4217.txs
GROUP BY day;
