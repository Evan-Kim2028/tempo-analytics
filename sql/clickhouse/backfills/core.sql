-- sql/clickhouse/backfills/core.sql
-- Derived from scripts/setup-clickhouse-views.sql
-- Apply after sql/clickhouse/views/core.sql

-- ─────────────────────────────────────────────
-- Backfill all four tables from existing data
-- (takes ~30-60 seconds for 15M rows)
-- ─────────────────────────────────────────────

INSERT INTO tidx_4217.mv_daily_stats
SELECT
  toDate(block_timestamp),
  count(),
  countIf(call_count > 1),
  countIf(fee_payer != from),
  countIf(to != '0x0000000000000000000000000000000000000000' AND NOT startsWith(lower(input), '0x7b')),
  countIf(to = '0x0000000000000000000000000000000000000000' AND NOT startsWith(lower(input), '0x7b')),
  countIf(startsWith(lower(input), '0x7b'))
FROM tidx_4217.txs GROUP BY toDate(block_timestamp);

INSERT INTO tidx_4217.mv_daily_uniq
SELECT toDate(block_timestamp), uniqState(from)
FROM tidx_4217.txs GROUP BY toDate(block_timestamp);

INSERT INTO tidx_4217.mv_token_transfers_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
GROUP BY toDate(block_timestamp), address;

INSERT INTO tidx_4217.mv_inscription_daily
SELECT
  toDate(block_timestamp),
  JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'op'),
  upper(JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'tick')),
  count()
FROM tidx_4217.txs WHERE startsWith(lower(input), '0x7b')
GROUP BY toDate(block_timestamp),
         JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'op'),
         upper(JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'tick'));

INSERT INTO tidx_4217.mv_stablecoin_daily
SELECT
  toDate(block_timestamp),
  address,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))),
  count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50'
  )
GROUP BY toDate(block_timestamp), address;

INSERT INTO tidx_4217.mv_dex_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;

INSERT INTO tidx_4217.mv_nft_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
GROUP BY toDate(block_timestamp), address;
