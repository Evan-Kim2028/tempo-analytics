-- sql/clickhouse/views/core.sql
-- Derived from scripts/setup-clickhouse-views.sql
-- Apply with scripts/apply-clickhouse-assets.sh

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
  countIf(
    to = '0x0000000000000000000000000000000000000000'
    AND NOT startsWith(lower(input), '0x7b')
  )                                                                            AS protocol_txs,
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
-- 5. Daily stablecoin transfer volume
--    Tracks pathUSD + USDC.e only.
--    amount decode: last 16 hex chars of 64-char uint256 data field
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_stablecoin_daily
(
  day       Date,
  token     String,
  volume_u6 UInt64,   -- sum of raw amounts (6 decimal places for these tokens)
  transfers UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_stablecoin_daily_view
TO tidx_4217.mv_stablecoin_daily
AS SELECT
  toDate(block_timestamp)                                                AS day,
  address                                                               AS token,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_u6,
  count()                                                               AS transfers
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50'
  )
GROUP BY day, token;

-- ─────────────────────────────────────────────
-- 6. Daily DEX swap activity (Uniswap V2-compatible Swap event)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_dex_daily
(
  day        Date,
  pair       String,
  swap_count UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, pair);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_dex_daily_view
TO tidx_4217.mv_dex_daily
AS SELECT
  toDate(block_timestamp)  AS day,
  address                  AS pair,
  count()                  AS swap_count
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY day, pair;

-- ─────────────────────────────────────────────
-- 7. Daily NFT (ERC-721) transfer activity
--    topic3 IS NOT NULL distinguishes ERC-721 from ERC-20
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_nft_daily
(
  day        Date,
  collection String,
  transfers  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, collection);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_nft_daily_view
TO tidx_4217.mv_nft_daily
AS SELECT
  toDate(block_timestamp)  AS day,
  address                  AS collection,
  count()                  AS transfers
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
GROUP BY day, collection;
