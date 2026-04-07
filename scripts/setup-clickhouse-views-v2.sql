-- scripts/setup-clickhouse-views-v2.sql
-- Run once with:
--   docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 \
--     < scripts/setup-clickhouse-views-v2.sql
-- Safe to re-run: all CREATE statements use IF NOT EXISTS.

-- ─────────────────────────────────────────────
-- 1. All ERC-20 daily transfer volume
--    Replaces the 2-token mv_stablecoin_daily.
--    ~2662 unique tokens × 110 days ≈ 293K rows — tiny.
--    volume_raw = raw uint256 lo-64 (divide by 10^decimals at query time)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_erc20_volume_daily
(
  day        Date,
  token      String,
  volume_raw UInt64,
  transfers  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_erc20_volume_daily_view
TO tidx_4217.mv_erc20_volume_daily
AS SELECT
  toDate(block_timestamp)                                                AS day,
  address                                                               AS token,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw,
  count()                                                               AS transfers
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
GROUP BY day, token;

INSERT INTO tidx_4217.mv_erc20_volume_daily
SELECT
  toDate(block_timestamp),
  address,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))),
  count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
GROUP BY toDate(block_timestamp), address;

-- ─────────────────────────────────────────────
-- 2. Uniswap V2 Swap event decoded amounts
--    data layout: 4 × 32 bytes = 256 hex chars
--    amount0In  last 8 bytes → substring(data, 51,  16)
--    amount1In  last 8 bytes → substring(data, 115, 16)
--    amount0Out last 8 bytes → substring(data, 179, 16)
--    amount1Out last 8 bytes → substring(data, 243, 16)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_dex_swap_amounts_daily
(
  day         Date,
  pair        String,
  amount0In   UInt64,
  amount1In   UInt64,
  amount0Out  UInt64,
  amount1Out  UInt64,
  swap_count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, pair);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_dex_swap_amounts_daily_view
TO tidx_4217.mv_dex_swap_amounts_daily
AS SELECT
  toDate(block_timestamp)                                                AS day,
  address                                                               AS pair,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51,  16)))))   AS amount0In,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 115, 16)))))   AS amount1In,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 179, 16)))))   AS amount0Out,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 243, 16)))))   AS amount1Out,
  count()                                                               AS swap_count
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY day, pair;

INSERT INTO tidx_4217.mv_dex_swap_amounts_daily
SELECT
  toDate(block_timestamp), address,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51,  16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 115, 16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 179, 16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 243, 16))))),
  count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;

-- ─────────────────────────────────────────────
-- 3. Daily fee token usage
--    ~2 fee tokens × 110 days ≈ 220 rows
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_fee_token_daily
(
  day       Date,
  fee_token String,
  txs       UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, fee_token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_fee_token_daily_view
TO tidx_4217.mv_fee_token_daily
AS SELECT
  toDate(block_timestamp) AS day,
  fee_token,
  count()                 AS txs
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY day, fee_token;

INSERT INTO tidx_4217.mv_fee_token_daily
SELECT toDate(block_timestamp), fee_token, count()
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY toDate(block_timestamp), fee_token;
