-- scripts/setup-clickhouse-views.sql
-- Run once with:
--   docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 < scripts/setup-clickhouse-views.sql
-- Safe to re-run: all CREATE statements use IF NOT EXISTS.

-- ─────────────────────────────────────────────
-- 1. Daily transaction stats
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_daily_stats
(
  day          Date,
  txs          UInt64,
  batch_txs    UInt64,
  sponsored_txs UInt64,
  user_txs     UInt64,
  protocol_txs UInt64,
  inscription_txs UInt64
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_daily_stats_view
TO tidx_4217.mv_daily_stats
AS SELECT
  toDate(block_timestamp)                                                       AS day,
  count()                                                                       AS txs,
  countIf(call_count > 1)                                                      AS batch_txs,
  countIf(fee_payer != from)                                                   AS sponsored_txs,
  countIf(
    to != '0x0000000000000000000000000000000000000000'
    AND NOT startsWith(lower(input), '0x7b')
  )                                                                            AS user_txs,
  countIf(to = '0x0000000000000000000000000000000000000000')                  AS protocol_txs,
  countIf(startsWith(lower(input), '0x7b'))                                   AS inscription_txs
FROM tidx_4217.txs
GROUP BY day;

-- ─────────────────────────────────────────────
-- 2. Daily unique senders (HyperLogLog sketch)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_daily_uniq
(
  day                   Date,
  unique_senders_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_daily_uniq_view
TO tidx_4217.mv_daily_uniq
AS SELECT
  toDate(block_timestamp)  AS day,
  uniqState(from)          AS unique_senders_state
FROM tidx_4217.txs
GROUP BY day;

-- ─────────────────────────────────────────────
-- 3. Daily token transfer volume
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_token_transfers_daily
(
  day             Date,
  token           String,
  transfer_count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_token_transfers_daily_view
TO tidx_4217.mv_token_transfers_daily
AS SELECT
  toDate(block_timestamp)   AS day,
  address                   AS token,
  count()                   AS transfer_count
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
GROUP BY day, token;

-- ─────────────────────────────────────────────
-- 4. Daily inscription activity (pre-parsed JSON)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_inscription_daily
(
  day    Date,
  op     String,
  tick   String,
  count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, op, tick);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_inscription_daily_view
TO tidx_4217.mv_inscription_daily
AS SELECT
  toDate(block_timestamp)                                                       AS day,
  JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'op')            AS op,
  upper(JSONExtractString(toValidUTF8(unhex(substring(input, 3))), 'tick'))   AS tick,
  count()                                                                       AS count
FROM tidx_4217.txs
WHERE startsWith(lower(input), '0x7b')
GROUP BY day, op, tick;

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
  countIf(to = '0x0000000000000000000000000000000000000000'),
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
