-- sql/clickhouse/backfills/chain/mv_daily_uniq.sql
-- Backfill for tidx_4217.mv_daily_uniq
-- Apply after sql/clickhouse/views/chain/mv_daily_uniq.sql

INSERT INTO tidx_4217.mv_daily_uniq
SELECT toDate(block_timestamp), uniqState(from)
FROM tidx_4217.txs GROUP BY toDate(block_timestamp);
