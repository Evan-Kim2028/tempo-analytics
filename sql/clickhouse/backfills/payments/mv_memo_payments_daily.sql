-- sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql
-- Backfill for tidx_4217.mv_memo_payments_daily
-- Apply after sql/clickhouse/views/payments/mv_memo_payments_daily.sql

INSERT INTO tidx_4217.mv_memo_payments_daily
SELECT
  toDate(block_timestamp) AS day,
  lower(address) AS token,
  count() AS successful_payments,
  0 AS failed_attempts,
  sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6) AS total_amount,
  countIf(
    lower(topic3) != '0x0000000000000000000000000000000000000000000000000000000000000000'
    AND match(substr(lower(topic3), 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9e]){32}$')
  ) AS readable_memos,
  countIf(
    lower(topic3) != '0x0000000000000000000000000000000000000000000000000000000000000000'
    AND NOT match(substr(lower(topic3), 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9e]){32}$')
  ) AS opaque_memos,
  countIf(
    lower(topic3) = '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) AS empty_memos
FROM tidx_4217.logs
WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
  AND lower(address) = '0x20c0000000000000000000000000000000000000'
GROUP BY day, token

UNION ALL

SELECT
  toDate(txs.block_timestamp) AS day,
  lower(txs.to) AS token,
  0 AS successful_payments,
  count() AS failed_attempts,
  0.0 AS total_amount,
  countIf(
    lower(concat('0x', substr(txs.input, 139, 64))) != '0x0000000000000000000000000000000000000000000000000000000000000000'
    AND match(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9e]){32}$')
  ) AS readable_memos,
  countIf(
    lower(concat('0x', substr(txs.input, 139, 64))) != '0x0000000000000000000000000000000000000000000000000000000000000000'
    AND NOT match(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9e]){32}$')
  ) AS opaque_memos,
  countIf(
    lower(concat('0x', substr(txs.input, 139, 64))) = '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) AS empty_memos
FROM tidx_4217.txs
LEFT JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
WHERE startsWith(lower(txs.input), '0x95777d59')
  AND lower(txs.to) = '0x20c0000000000000000000000000000000000000'
  AND (receipts.status = 0 OR receipts.status = '0')
GROUP BY day, token;
