-- sql/clickhouse/backfills/chain/mv_fee_token_daily.sql
-- Backfill for tidx_4217.mv_fee_token_daily
-- Apply after sql/clickhouse/views/chain/mv_fee_token_daily.sql

INSERT INTO tidx_4217.mv_fee_token_daily
SELECT toDate(block_timestamp), fee_token, count()
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY toDate(block_timestamp), fee_token;
