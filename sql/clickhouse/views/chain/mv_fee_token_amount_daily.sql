-- @name:         mv_fee_token_amount_daily
-- @domain:       chain
-- @kind:         materialized_view
-- @purpose:      Daily fee token USD amounts paid (gas_used × effective_gas_price / 1e18)
-- @upstream:     tidx_4217.receipts, tidx_4217.txs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_fee_token_amount_daily
(
  day       Date,
  fee_token String,
  fee_usd   Float64
)
ENGINE = SummingMergeTree
ORDER BY (day, fee_token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_fee_token_amount_daily_view
TO tidx_4217.mv_fee_token_amount_daily
AS
SELECT
  toDate(r.block_timestamp)                                                         AS day,
  t.fee_token                                                                        AS fee_token,
  sum(toFloat64(r.gas_used) * toFloat64OrZero(r.effective_gas_price) / 1e18)        AS fee_usd
FROM tidx_4217.receipts r
JOIN tidx_4217.txs t ON t.hash = r.tx_hash
WHERE t.fee_token IS NOT NULL AND t.fee_token != ''
GROUP BY day, fee_token;
