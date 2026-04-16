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
    AND lower(txs.to) IN (
      '0x20c0000000000000000000000000000000000000',
      '0x20c000000000000000000000b9537d11c60e8b50',
      '0x20c0000000000000000000001621e21f71cf12fb',
      '0x20c00000000000000000000014f22ca97301eb73',
      '0x20c0000000000000000000003554d28269e0f3c2',
      '0x20c0000000000000000000000520792dcccccccc',
      '0x20c0000000000000000000008ee4fcff88888888',
      '0x20c0000000000000000000005c0bac7cef389a11',
      '0x20c0000000000000000000007f7ba549dd0251b9',
      '0x20c000000000000000000000aeed2ec36a54d0e5',
      '0x20c0000000000000000000009a4a4b17e0dc6651',
      '0x20c000000000000000000000383a23bacb546ab9',
      '0x20c000000000000000000000ab02d39df30bd17e',
      '0x20c000000000000000000000048c8f36df1c9a4a',
      '0x20c0000000000000000000002f52d5cc21a3207b',
      '0x20c000000000000000000000bd95bfb69fbe6ce3',
      '0x20c000000000000000000000ae247a1130450f09'
    )
    AND receipts.status = 0
GROUP BY day, token, sender, recipient;
