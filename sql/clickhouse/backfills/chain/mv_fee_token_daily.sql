-- @name:         mv_fee_token_daily
-- @domain:       chain
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_fee_token_daily.
-- @pairs:        sql/clickhouse/views/chain/mv_fee_token_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_fee_token_daily
SELECT toDate(block_timestamp), fee_token, count()
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY toDate(block_timestamp), fee_token;
