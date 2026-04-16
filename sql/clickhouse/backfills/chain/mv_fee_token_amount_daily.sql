-- @name:         mv_fee_token_amount_daily
-- @domain:       chain
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_fee_token_amount_daily.
-- @pairs:        sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_fee_token_amount_daily
SELECT
  toDate(r.block_timestamp)                                                         AS day,
  t.fee_token                                                                        AS fee_token,
  sum(toFloat64(r.gas_used) * toFloat64OrZero(r.effective_gas_price) / 1e18)        AS fee_usd
FROM tidx_4217.receipts r
JOIN tidx_4217.txs t ON t.hash = r.tx_hash
WHERE t.fee_token IS NOT NULL AND t.fee_token != ''
GROUP BY day, fee_token;
