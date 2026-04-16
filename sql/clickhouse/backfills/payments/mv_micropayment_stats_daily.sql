-- @name:         mv_micropayment_stats_daily
-- @domain:       payments
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_micropayment_stats_daily.
-- @pairs:        sql/clickhouse/views/payments/mv_micropayment_stats_daily.sql
-- @owner:        evan
-- @since:        2026-04-15

INSERT INTO tidx_4217.mv_micropayment_stats_daily
SELECT
  toDate(block_timestamp)                                                                  AS day,
  countIf(amount < 0.01)                                                                   AS sub_cent_count,
  sumIf(amount, amount < 0.01)                                                             AS sub_cent_amount,
  countIf(amount >= 0.01 AND amount < 0.05)                                               AS sub_nickel_count,
  sumIf(amount, amount >= 0.01 AND amount < 0.05)                                         AS sub_nickel_amount,
  countIf(amount >= 0.05 AND amount < 0.10)                                               AS sub_dime_count,
  sumIf(amount, amount >= 0.05 AND amount < 0.10)                                         AS sub_dime_amount,
  countIf(amount >= 0.10)                                                                  AS large_count,
  sumIf(amount, amount >= 0.10)                                                            AS large_amount
FROM (
  SELECT
    block_timestamp,
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6 AS amount
  FROM tidx_4217.logs
  WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(address) IN (
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
)
GROUP BY day;
