-- @name:         mv_TEMPLATE
-- @domain:       REPLACE_ME
-- @kind:         materialized_view
-- @purpose:      One-line description of what this view computes.
-- @upstream:     tidx_4217.txs
-- @consumers:    src/lib/analytics.ts::REPLACE_ME
-- @backfill:     sql/clickhouse/backfills/REPLACE_ME/mv_TEMPLATE.sql
-- @owner:        evan
-- @since:        YYYY-MM-DD
--
-- NOTES: free-form prose; non-obvious filters, caveats, rationale.

CREATE TABLE IF NOT EXISTS tidx_4217.mv_TEMPLATE
(
  day    Date,
  -- add columns
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_TEMPLATE_view
TO tidx_4217.mv_TEMPLATE
AS SELECT
  toDate(block_timestamp) AS day
  -- add aggregates
FROM tidx_4217.txs
GROUP BY day;
