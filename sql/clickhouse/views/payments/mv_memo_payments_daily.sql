-- @name:         mv_memo_payments_daily
-- @domain:       payments
-- @kind:         materialized_view
-- @purpose:      Daily memo payment rollups for dashboard counts and volume (success + failed pathUSD rail)
-- @upstream:     tidx_4217.logs, tidx_4217.receipts, tidx_4217.txs
-- @consumers:    src/app/payments/page.tsx, src/lib/payments.ts
-- @backfill:     sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_memo_payments_daily
(
  day                 Date,
  token               String,
  successful_payments UInt64,
  failed_attempts     UInt64,
  total_amount        Float64,
  readable_memos      UInt64,
  opaque_memos        UInt64,
  empty_memos         UInt64,
  soc_memos           UInt64,
  ef1e_memos          UInt64,
  mpps_memos          UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_memo_payments_daily_success_view
TO tidx_4217.mv_memo_payments_daily
AS
SELECT
  day,
  token,
  count()               AS successful_payments,
  0                     AS failed_attempts,
  sum(amount_raw / 1e6) AS total_amount,
  countIf(m != '0x0000000000000000000000000000000000000000000000000000000000000000' AND (
    match(substr(m, 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9a-e]){32}$')
    OR startsWith(m, '0xef1ed712')
    OR startsWith(m, '0x6d70707368616675')
  )) AS readable_memos,
  countIf(m != '0x0000000000000000000000000000000000000000000000000000000000000000' AND NOT (
    match(substr(m, 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9a-e]){32}$')
    OR startsWith(m, '0xef1ed712')
    OR startsWith(m, '0x6d70707368616675')
  )) AS opaque_memos,
  countIf(m = '0x0000000000000000000000000000000000000000000000000000000000000000') AS empty_memos,
  countIf(startsWith(m, '0x534f432d'))         AS soc_memos,
  countIf(startsWith(m, '0xef1ed712'))          AS ef1e_memos,
  countIf(startsWith(m, '0x6d70707368616675')) AS mpps_memos
FROM (
  SELECT
    toDate(block_timestamp)  AS day,
    lower(address)           AS token,
    coalesce(lower(topic3), '0x0000000000000000000000000000000000000000000000000000000000000000') AS m,
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) AS amount_raw
  FROM tidx_4217.logs
  WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(address) = '0x20c0000000000000000000000000000000000000'
)
GROUP BY day, token;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_memo_payments_daily_failed_view
TO tidx_4217.mv_memo_payments_daily
AS
SELECT
  day,
  token,
  0       AS successful_payments,
  count() AS failed_attempts,
  0.0     AS total_amount,
  countIf(m != '0x0000000000000000000000000000000000000000000000000000000000000000' AND (
    match(substr(m, 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9a-e]){32}$')
    OR startsWith(m, '0xef1ed712')
    OR startsWith(m, '0x6d70707368616675')
  )) AS readable_memos,
  countIf(m != '0x0000000000000000000000000000000000000000000000000000000000000000' AND NOT (
    match(substr(m, 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9a-e]){32}$')
    OR startsWith(m, '0xef1ed712')
    OR startsWith(m, '0x6d70707368616675')
  )) AS opaque_memos,
  countIf(m = '0x0000000000000000000000000000000000000000000000000000000000000000') AS empty_memos,
  countIf(startsWith(m, '0x534f432d'))         AS soc_memos,
  countIf(startsWith(m, '0xef1ed712'))          AS ef1e_memos,
  countIf(startsWith(m, '0x6d70707368616675')) AS mpps_memos
FROM (
  SELECT
    toDate(txs.block_timestamp)                      AS day,
    lower(txs.to)                                    AS token,
    lower(concat('0x', substr(txs.input, 139, 64))) AS m
  FROM tidx_4217.txs
  INNER JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
  WHERE startsWith(lower(txs.input), '0x95777d59')
    AND lower(txs.to) = '0x20c0000000000000000000000000000000000000'
    AND receipts.status = 0
)
GROUP BY day, token;
