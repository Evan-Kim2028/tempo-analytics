-- @name:         mv_inscription_daily
-- @domain:       chain
-- @kind:         materialized_view
-- @purpose:      Daily inscription activity (transactions with JSON payload input)
-- @upstream:     tidx_4217.txs
-- @consumers:    src/app/analytics/page.tsx, src/lib/inscriptions.ts
-- @backfill:     sql/clickhouse/backfills/chain/mv_inscription_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_inscription_daily
(
  day    Date,
  op     String,
  tick   String,
  count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, op, tick);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_inscription_daily_view
TO tidx_4217.mv_inscription_daily
AS SELECT
  toDate(block_timestamp)                                                       AS day,
  JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'op')            AS op,
  upper(JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'tick'))   AS tick,
  count()                                                                       AS count
FROM tidx_4217.txs
WHERE startsWith(lower(input), '0x7b')
GROUP BY day, op, tick;
