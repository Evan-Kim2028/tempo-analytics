-- sql/clickhouse/views/chain/mv_daily_uniq.sql
-- Domain: chain — daily unique senders (HyperLogLog sketch via uniqState)
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_daily_uniq
(
  day                   Date,
  unique_senders_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_daily_uniq_view
TO tidx_4217.mv_daily_uniq
AS SELECT
  toDate(block_timestamp)  AS day,
  uniqState(from)          AS unique_senders_state
FROM tidx_4217.txs
GROUP BY day;
