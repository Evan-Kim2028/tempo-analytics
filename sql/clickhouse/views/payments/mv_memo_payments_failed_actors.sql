-- @name:         mv_memo_payments_failed_actors
-- @domain:       payments
-- @kind:         materialized_view
-- @purpose:      Failed payment actor aggregation (sender/recipient pairs by day).
-- @upstream:     tidx_4217.receipts, tidx_4217.txs
-- @consumers:    src/app/payments/page.tsx, src/lib/payments.ts
-- @backfill:     none
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_memo_payments_failed_actors
(
    day Date,
    token LowCardinality(String),
    sender String,
    recipient String,
    failed_count UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token, sender, recipient);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_memo_payments_failed_actors_view
TO tidx_4217.mv_memo_payments_failed_actors AS
SELECT
    toDate(txs.block_timestamp) AS day,
    lower(txs.to) AS token,
    lower(txs.from) AS sender,
    lower(concat('0x', substr(txs.input, 35, 40))) AS recipient,
    count() AS failed_count
FROM tidx_4217.txs
INNER JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
WHERE startsWith(lower(txs.input), '0x95777d59')
    AND lower(txs.to) = '0x20c0000000000000000000000000000000000000'
    AND receipts.status = 0
GROUP BY day, token, sender, recipient;
