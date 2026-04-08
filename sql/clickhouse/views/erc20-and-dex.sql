-- sql/clickhouse/views/erc20-and-dex.sql
-- Derived from scripts/setup-clickhouse-views-v2.sql
-- Apply with scripts/apply-clickhouse-assets.sh

-- ─────────────────────────────────────────────
-- 0. Daily net supply change per whitelisted stablecoin
--    In tidx logs: selector is stored separately; topic1 = from, topic2 = to, topic3 = NULL for ERC-20
--    Mints: Transfer where from = zero address (topic1 = zero padded to 32 bytes)
--    Burns: Transfer where to   = zero address (topic2 = zero padded to 32 bytes)
--    topic3 IS NULL filters ERC-20 from ERC-721 (same Transfer selector, ERC-721 has tokenId in topic3)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_stablecoin_supply_daily
(
  day      Date,
  token    String,
  net_raw  Int64    -- mints_raw - burns_raw (lo-64 of uint256)
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_stablecoin_supply_daily_view
TO tidx_4217.mv_stablecoin_supply_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  address                                                               AS token,
  sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
        topic1 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    - sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
            topic2 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    AS net_raw
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',  -- pathUSD
    '0x20c000000000000000000000b9537d11c60e8b50'   -- USDC.e
  )
GROUP BY day, token;

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
