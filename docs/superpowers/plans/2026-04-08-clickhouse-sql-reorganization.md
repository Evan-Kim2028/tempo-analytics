# ClickHouse SQL Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize 3 flat ClickHouse SQL files (6 files total with backfills) into 26 one-file-per-view domain-organized files, rename `mv_protocol_dex_daily` → `mv_protocol_dex_volume_totals_daily`, update the apply script with recursive glob and parallel backfill support, and keep `analytics.ts` and `docs/data-assets.md` in sync.

**Architecture:** Pure file reorganization — SQL logic is copied verbatim, just split from multi-view files into single-view files organized by domain (`chain/`, `tokens/`, `stablecoins/`, `dex/`, `nfts/`). The only semantic change is the protocol DEX view rename. The apply script switches from an explicit file list to a `find`-based recursive glob with `xargs -P` for parallel backfills.

**Tech Stack:** Bash, SQL (ClickHouse SummingMergeTree / AggregatingMergeTree), TypeScript/Jest, git

---

## File Map

**Created (views):**
- `sql/clickhouse/views/chain/mv_daily_stats.sql`
- `sql/clickhouse/views/chain/mv_daily_uniq.sql`
- `sql/clickhouse/views/chain/mv_inscription_daily.sql`
- `sql/clickhouse/views/chain/mv_fee_token_daily.sql`
- `sql/clickhouse/views/tokens/mv_token_transfers_daily.sql`
- `sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql`
- `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`
- `sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql`
- `sql/clickhouse/views/dex/mv_dex_daily.sql`
- `sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql`
- `sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql` ← renamed from mv_protocol_dex_daily
- `sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql`
- `sql/clickhouse/views/nfts/mv_nft_daily.sql`

**Created (backfills — mirror tree):**
- `sql/clickhouse/backfills/chain/mv_daily_stats.sql`
- `sql/clickhouse/backfills/chain/mv_daily_uniq.sql`
- `sql/clickhouse/backfills/chain/mv_inscription_daily.sql`
- `sql/clickhouse/backfills/chain/mv_fee_token_daily.sql`
- `sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql`
- `sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql`
- `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql`
- `sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql`
- `sql/clickhouse/backfills/dex/mv_dex_daily.sql`
- `sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql`
- `sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql` ← renamed
- `sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql`
- `sql/clickhouse/backfills/nfts/mv_nft_daily.sql`

**Modified:**
- `scripts/apply-clickhouse-assets.sh` — recursive find glob, `xargs -P` parallel backfills, ordering comment
- `src/lib/analytics.ts:669` — `getProtocolDexDailyStats()` query updated to new table name
- `docs/data-assets.md` — traceability table updated with new paths and rename

**Deleted:**
- `sql/clickhouse/views/core.sql`
- `sql/clickhouse/views/erc20-and-dex.sql`
- `sql/clickhouse/views/protocol-dex.sql`
- `sql/clickhouse/backfills/core.sql`
- `sql/clickhouse/backfills/erc20-and-dex.sql`
- `sql/clickhouse/backfills/protocol-dex.sql`

**Test added:**
- `__tests__/lib/analytics.protocol-dex-daily.test.ts` — verifies `getProtocolDexDailyStats()` queries the renamed table

---

### Task 1: Create views/chain/ domain files

**Files:**
- Create: `sql/clickhouse/views/chain/mv_daily_stats.sql`
- Create: `sql/clickhouse/views/chain/mv_daily_uniq.sql`
- Create: `sql/clickhouse/views/chain/mv_inscription_daily.sql`
- Create: `sql/clickhouse/views/chain/mv_fee_token_daily.sql`

- [ ] **Step 1: Create the 4 chain view files**

`sql/clickhouse/views/chain/mv_daily_stats.sql`:
```sql
-- sql/clickhouse/views/chain/mv_daily_stats.sql
-- Domain: chain — daily transaction type breakdown
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_daily_stats
(
  day             Date,
  txs             UInt64,
  batch_txs       UInt64,
  sponsored_txs   UInt64,
  user_txs        UInt64,
  protocol_txs    UInt64,
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
```

`sql/clickhouse/views/chain/mv_daily_uniq.sql`:
```sql
-- sql/clickhouse/views/chain/mv_daily_uniq.sql
-- Domain: chain — daily unique senders (HyperLogLog sketch via uniqState)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

`sql/clickhouse/views/chain/mv_inscription_daily.sql`:
```sql
-- sql/clickhouse/views/chain/mv_inscription_daily.sql
-- Domain: chain — daily inscription activity (pre-parsed JSON)
-- Inscriptions: tx input starts with 0x7b ('{' in hex = JSON payload)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

`sql/clickhouse/views/chain/mv_fee_token_daily.sql`:
```sql
-- sql/clickhouse/views/chain/mv_fee_token_daily.sql
-- Domain: chain — daily fee token usage (AA: fee paid in stablecoin vs native)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

- [ ] **Step 2: Commit**

```bash
git add sql/clickhouse/views/chain/
git commit -m "refactor(sql): add chain domain view files"
```

---

### Task 2: Create views/tokens/, views/stablecoins/, views/nfts/ domain files

**Files:**
- Create: `sql/clickhouse/views/tokens/mv_token_transfers_daily.sql`
- Create: `sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql`
- Create: `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`
- Create: `sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql`
- Create: `sql/clickhouse/views/nfts/mv_nft_daily.sql`

- [ ] **Step 1: Create token view files**

`sql/clickhouse/views/tokens/mv_token_transfers_daily.sql`:
```sql
-- sql/clickhouse/views/tokens/mv_token_transfers_daily.sql
-- Domain: tokens — daily Transfer event count by token address (ERC-20 + ERC-721)
-- topic3 is not filtered: counts both ERC-20 and ERC-721 Transfer events
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

`sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql`:
```sql
-- sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql
-- Domain: tokens — daily ERC-20 transfer volume across all tokens (~2600+ tokens)
-- topic3 IS NULL distinguishes ERC-20 from ERC-721 (same Transfer selector)
-- volume_raw: raw uint256 lo-64 (divide by 10^decimals at query time)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

- [ ] **Step 2: Create stablecoin view files**

`sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`:
```sql
-- sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql
-- Domain: stablecoins — daily transfer volume for whitelisted stablecoins
-- Tracks pathUSD (0x20c0...0000) and USDC.e (0x20c0...b9537d11c60e8b50) only
-- volume_u6: raw uint256 lo-64 (divide by 1e6 for USD — both tokens have decimals=6)
-- topic3 IS NULL: distinguishes ERC-20 Transfer from ERC-721 Transfer
-- Apply with scripts/apply-clickhouse-assets.sh

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
    '0x20c0000000000000000000000000000000000000',  -- pathUSD
    '0x20c000000000000000000000b9537d11c60e8b50'   -- USDC.e
  )
GROUP BY day, token;
```

`sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql`:
```sql
-- sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql
-- Domain: stablecoins — daily net supply change per whitelisted stablecoin
-- Mints: Transfer from zero address (topic1 = 32-byte zero-padded)
-- Burns: Transfer to zero address (topic2 = 32-byte zero-padded)
-- topic3 IS NULL: distinguishes ERC-20 Transfer from ERC-721 Transfer
-- net_raw: Int64 mints_raw - burns_raw (lo-64 of uint256; divide by 1e6 for USD)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

- [ ] **Step 3: Create nfts view file**

`sql/clickhouse/views/nfts/mv_nft_daily.sql`:
```sql
-- sql/clickhouse/views/nfts/mv_nft_daily.sql
-- Domain: nfts — daily ERC-721 transfer activity by collection
-- topic3 IS NOT NULL distinguishes ERC-721 from ERC-20 (same Transfer selector)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

- [ ] **Step 4: Commit**

```bash
git add sql/clickhouse/views/tokens/ sql/clickhouse/views/stablecoins/ sql/clickhouse/views/nfts/
git commit -m "refactor(sql): add tokens, stablecoins, nfts domain view files"
```

---

### Task 3: Create views/dex/ domain files (including rename)

**Files:**
- Create: `sql/clickhouse/views/dex/mv_dex_daily.sql`
- Create: `sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql`
- Create: `sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql`
- Create: `sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql`

Note: `mv_protocol_dex_volume_totals_daily` is a rename of `mv_protocol_dex_daily`. Both the ClickHouse table name and the view name are updated — this is a new table definition, not an ALTER.

- [ ] **Step 1: Create mv_dex_daily.sql**

`sql/clickhouse/views/dex/mv_dex_daily.sql`:
```sql
-- sql/clickhouse/views/dex/mv_dex_daily.sql
-- Domain: dex — daily Uniswap V2-compatible DEX swap activity by pair (swap count only)
-- Uniswap V2 Swap event: 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
-- See mv_dex_swap_amounts_daily for decoded amounts
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

- [ ] **Step 2: Create mv_dex_swap_amounts_daily.sql**

`sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql`:
```sql
-- sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql
-- Domain: dex — decoded Uniswap V2 Swap amounts by pair
-- data layout: 4 × 32 bytes = 256 hex chars (1-indexed after 0x prefix)
--   amount0In  last 8 bytes → substring(data, 51,  16)
--   amount1In  last 8 bytes → substring(data, 115, 16)
--   amount0Out last 8 bytes → substring(data, 179, 16)
--   amount1Out last 8 bytes → substring(data, 243, 16)
-- Apply with scripts/apply-clickhouse-assets.sh

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
```

- [ ] **Step 3: Create mv_protocol_dex_volume_totals_daily.sql (renamed from mv_protocol_dex_daily)**

`sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql`:
```sql
-- sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql
-- Domain: dex — Protocol DEX (enshrined precompile) daily volume totals
-- Aggregate across all pools — see mv_protocol_dex_pool_daily for per-pool breakdown
-- Renamed from mv_protocol_dex_daily: "volume_totals" clarifies this is swap count + USD volume,
-- aggregated across all pools, for the enshrined Protocol DEX precompile.
-- Contract: 0xdec0000000000000000000000000000000000000
-- Event: 0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd (main swap event, 53K+ occurrences)
-- volume_raw: lo-64 of amount_in uint256 (divide by 1e6 for USD)
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_volume_totals_daily
(
  day        Date,
  swaps      UInt64,
  volume_raw UInt64   -- lo-64 of amount_in uint256; divide by 1e6 for USD
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_volume_totals_daily_view
TO tidx_4217.mv_protocol_dex_volume_totals_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day;
```

- [ ] **Step 4: Create mv_protocol_dex_pool_daily.sql**

`sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql`:
```sql
-- sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql
-- Domain: dex — Protocol DEX (enshrined precompile) per-pool daily stats
-- Decodes pool_id from topic1 (lo-64 bits) and token from topic3 (stripped to 20-byte address)
-- Same swap event as mv_protocol_dex_volume_totals_daily
-- Apply with scripts/apply-clickhouse-assets.sh

CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_pool_daily
(
  day        Date,
  pool_id    UInt64,
  token      String,
  swaps      UInt64,
  volume_raw UInt64   -- lo-64 of amount_in uint256; divide by 1e6 for USD
)
ENGINE = SummingMergeTree
ORDER BY (day, pool_id, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_pool_daily_view
TO tidx_4217.mv_protocol_dex_pool_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))       AS pool_id,
  '0x' || lower(substring(topic3, 27))                                 AS token,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
```

- [ ] **Step 5: Commit**

```bash
git add sql/clickhouse/views/dex/
git commit -m "refactor(sql): add dex domain view files (rename mv_protocol_dex_daily -> mv_protocol_dex_volume_totals_daily)"
```

---

### Task 4: Create backfills/chain/ domain files

**Files:**
- Create: `sql/clickhouse/backfills/chain/mv_daily_stats.sql`
- Create: `sql/clickhouse/backfills/chain/mv_daily_uniq.sql`
- Create: `sql/clickhouse/backfills/chain/mv_inscription_daily.sql`
- Create: `sql/clickhouse/backfills/chain/mv_fee_token_daily.sql`

- [ ] **Step 1: Create chain backfill files**

`sql/clickhouse/backfills/chain/mv_daily_stats.sql`:
```sql
-- sql/clickhouse/backfills/chain/mv_daily_stats.sql
-- Backfill for tidx_4217.mv_daily_stats
-- Apply after sql/clickhouse/views/chain/mv_daily_stats.sql

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
```

`sql/clickhouse/backfills/chain/mv_daily_uniq.sql`:
```sql
-- sql/clickhouse/backfills/chain/mv_daily_uniq.sql
-- Backfill for tidx_4217.mv_daily_uniq
-- Apply after sql/clickhouse/views/chain/mv_daily_uniq.sql

INSERT INTO tidx_4217.mv_daily_uniq
SELECT toDate(block_timestamp), uniqState(from)
FROM tidx_4217.txs GROUP BY toDate(block_timestamp);
```

`sql/clickhouse/backfills/chain/mv_inscription_daily.sql`:
```sql
-- sql/clickhouse/backfills/chain/mv_inscription_daily.sql
-- Backfill for tidx_4217.mv_inscription_daily
-- Apply after sql/clickhouse/views/chain/mv_inscription_daily.sql

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
```

`sql/clickhouse/backfills/chain/mv_fee_token_daily.sql`:
```sql
-- sql/clickhouse/backfills/chain/mv_fee_token_daily.sql
-- Backfill for tidx_4217.mv_fee_token_daily
-- Apply after sql/clickhouse/views/chain/mv_fee_token_daily.sql

INSERT INTO tidx_4217.mv_fee_token_daily
SELECT toDate(block_timestamp), fee_token, count()
FROM tidx_4217.txs
WHERE fee_token != '' AND fee_token IS NOT NULL
GROUP BY toDate(block_timestamp), fee_token;
```

- [ ] **Step 2: Commit**

```bash
git add sql/clickhouse/backfills/chain/
git commit -m "refactor(sql): add chain domain backfill files"
```

---

### Task 5: Create backfills/tokens/, backfills/stablecoins/, backfills/nfts/ domain files

**Files:**
- Create: `sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql`
- Create: `sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql`
- Create: `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql`
- Create: `sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql`
- Create: `sql/clickhouse/backfills/nfts/mv_nft_daily.sql`

- [ ] **Step 1: Create token backfill files**

`sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql`:
```sql
-- sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql
-- Backfill for tidx_4217.mv_token_transfers_daily
-- Apply after sql/clickhouse/views/tokens/mv_token_transfers_daily.sql

INSERT INTO tidx_4217.mv_token_transfers_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
GROUP BY toDate(block_timestamp), address;
```

`sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql`:
```sql
-- sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql
-- Backfill for tidx_4217.mv_erc20_volume_daily
-- Apply after sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql

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
```

- [ ] **Step 2: Create stablecoin backfill files**

`sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql`:
```sql
-- sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql
-- Backfill for tidx_4217.mv_stablecoin_daily
-- Apply after sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql

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
```

`sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql`:
```sql
-- sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql
-- Backfill for tidx_4217.mv_stablecoin_supply_daily
-- Apply after sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql

INSERT INTO tidx_4217.mv_stablecoin_supply_daily
SELECT
  toDate(block_timestamp) AS day,
  address                 AS token,
  sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
        topic1 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    - sumIf(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))),
            topic2 = '0x0000000000000000000000000000000000000000000000000000000000000000')
    AS net_raw
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NULL
  AND address IN (
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50'
  )
GROUP BY day, token;
```

- [ ] **Step 3: Create nfts backfill file**

`sql/clickhouse/backfills/nfts/mv_nft_daily.sql`:
```sql
-- sql/clickhouse/backfills/nfts/mv_nft_daily.sql
-- Backfill for tidx_4217.mv_nft_daily
-- Apply after sql/clickhouse/views/nfts/mv_nft_daily.sql

INSERT INTO tidx_4217.mv_nft_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
GROUP BY toDate(block_timestamp), address;
```

- [ ] **Step 4: Commit**

```bash
git add sql/clickhouse/backfills/tokens/ sql/clickhouse/backfills/stablecoins/ sql/clickhouse/backfills/nfts/
git commit -m "refactor(sql): add tokens, stablecoins, nfts domain backfill files"
```

---

### Task 6: Create backfills/dex/ domain files (including rename)

**Files:**
- Create: `sql/clickhouse/backfills/dex/mv_dex_daily.sql`
- Create: `sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql`
- Create: `sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql`
- Create: `sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql`

- [ ] **Step 1: Create dex backfill files**

`sql/clickhouse/backfills/dex/mv_dex_daily.sql`:
```sql
-- sql/clickhouse/backfills/dex/mv_dex_daily.sql
-- Backfill for tidx_4217.mv_dex_daily
-- Apply after sql/clickhouse/views/dex/mv_dex_daily.sql

INSERT INTO tidx_4217.mv_dex_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;
```

`sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql`:
```sql
-- sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql
-- Backfill for tidx_4217.mv_dex_swap_amounts_daily
-- Apply after sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql

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
```

`sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql`:
```sql
-- sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql
-- Backfill for tidx_4217.mv_protocol_dex_volume_totals_daily
-- Apply after sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql

INSERT INTO tidx_4217.mv_protocol_dex_volume_totals_daily
SELECT
  toDate(block_timestamp),
  count(),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY toDate(block_timestamp);
```

`sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql`:
```sql
-- sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql
-- Backfill for tidx_4217.mv_protocol_dex_pool_daily
-- Apply after sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql

INSERT INTO tidx_4217.mv_protocol_dex_pool_daily
SELECT
  toDate(block_timestamp)                                               AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))       AS pool_id,
  '0x' || lower(substring(topic3, 27))                                 AS token,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
```

- [ ] **Step 2: Commit**

```bash
git add sql/clickhouse/backfills/dex/
git commit -m "refactor(sql): add dex domain backfill files (rename mv_protocol_dex_daily -> mv_protocol_dex_volume_totals_daily)"
```

---

### Task 7: Update apply-clickhouse-assets.sh

**Files:**
- Modify: `scripts/apply-clickhouse-assets.sh`

Replace the entire file. Key changes:
- Add explicit comment that any-order application is an intentional design choice
- Replace 3 explicit `run_sql` calls with `find ... | sort | while read -r f`
- Change backfill gate from `= "1"` boolean to `-gt 0` numeric, add `export -f` and `xargs -P`
- Export env vars needed in xargs subshells

- [ ] **Step 1: Overwrite apply-clickhouse-assets.sh**

`scripts/apply-clickhouse-assets.sh`:
```bash
#!/usr/bin/env bash
# Apply repo-owned ClickHouse assets against an external ClickHouse service.
# Definitions are safe to re-run.
# Historical backfills are skipped by default to avoid double-counting SummingMergeTree data.
# Set CLICKHOUSE_RUN_BACKFILLS=N to run N backfill SQL files concurrently (e.g. CLICKHOUSE_RUN_BACKFILLS=4).

# Views are applied in arbitrary filesystem order (alphabetical by path).
# This is intentional — all views read directly from base tables (txs, logs)
# and no view depends on another. If a cross-view dependency is introduced
# in the future, this script must be updated with explicit ordering.

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL is required}"
: "${CLICKHOUSE_DB:=tidx_4217}"
: "${CLICKHOUSE_RUN_BACKFILLS:=0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLICKHOUSE_BASE_URL="${CLICKHOUSE_URL%/}"
DEFAULT_CLICKHOUSE_DB="tidx_4217"

rewrite_sql_for_db() {
  local file="$1"

  python3 - "$file" "$DEFAULT_CLICKHOUSE_DB" "$CLICKHOUSE_DB" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source_db = sys.argv[2]
target_db = sys.argv[3]

sys.stdout.write(path.read_text().replace(f"{source_db}.", f"{target_db}."))
PY
}

run_sql() {
  local file="$1"

  echo "Applying $file"
  rewrite_sql_for_db "$file" | \
  curl -fsS "${CLICKHOUSE_BASE_URL}/?database=${CLICKHOUSE_DB}" \
    --data-binary @- \
    >/dev/null
}

find "$SCRIPT_DIR/../sql/clickhouse/views" -name "*.sql" | sort | while read -r f; do
  run_sql "$f"
done

if [ -n "$CLICKHOUSE_RUN_BACKFILLS" ] && [ "$CLICKHOUSE_RUN_BACKFILLS" -gt 0 ]; then
  echo "CLICKHOUSE_RUN_BACKFILLS=$CLICKHOUSE_RUN_BACKFILLS; applying historical backfills in parallel."
  export CLICKHOUSE_BASE_URL CLICKHOUSE_DB DEFAULT_CLICKHOUSE_DB
  export -f run_sql rewrite_sql_for_db
  find "$SCRIPT_DIR/../sql/clickhouse/backfills" -name "*.sql" | sort | \
    xargs -P "$CLICKHOUSE_RUN_BACKFILLS" -I{} bash -c 'run_sql "$@"' _ {}
else
  echo "Skipping historical backfills by default."
  echo "Set CLICKHOUSE_RUN_BACKFILLS=N to run N backfill SQL files concurrently (e.g. CLICKHOUSE_RUN_BACKFILLS=4)."
fi
```

- [ ] **Step 2: Commit**

```bash
git add scripts/apply-clickhouse-assets.sh
git commit -m "refactor(scripts): apply-clickhouse-assets uses recursive glob and parallel backfills"
```

---

### Task 8: Update analytics.ts and add test for renamed table

**Files:**
- Create: `__tests__/lib/analytics.protocol-dex-daily.test.ts`
- Modify: `src/lib/analytics.ts:669`

`getProtocolDexDailyStats()` at line 669 of `src/lib/analytics.ts` queries `mv_protocol_dex_daily`. Change it to `mv_protocol_dex_volume_totals_daily`.

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/analytics.protocol-dex-daily.test.ts`:

```typescript
jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/tokens', () => ({
  getTokenInfo: jest.fn(),
  getTokenSupply: jest.fn(),
  KNOWN_TOKENS: {},
  EXCLUDED_TOKENS: new Set(),
  STABLECOIN_ADDRESSES: [],
}))
jest.mock('@/lib/tokenlist', () => ({
  getStablecoinAddresses: jest.fn().mockResolvedValue([]),
  getTokenFromList: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/dex', () => ({
  getDexPairInfo: jest.fn(),
  computePairUsdVolume: jest.fn(),
  isWhitelistedPair: jest.fn(),
}))
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({ readContract: jest.fn() })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))
jest.mock('@/lib/chain', () => ({
  publicClient: { readContract: jest.fn() },
  tempoChain: {},
}))

import { queryClickHouse } from '@/lib/clickhouse'
import { getProtocolDexDailyStats } from '@/lib/analytics'

const mockQuery = queryClickHouse as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('getProtocolDexDailyStats queries mv_protocol_dex_volume_totals_daily', async () => {
  mockQuery.mockResolvedValueOnce([
    { day: '2026-04-01', swaps: '100', volume_raw: '5000000000' },
  ])

  await getProtocolDexDailyStats(30)

  const sql: string = mockQuery.mock.calls[0][0]
  expect(sql).toContain('mv_protocol_dex_volume_totals_daily')
  expect(sql).not.toContain('mv_protocol_dex_daily\n')
})

test('getProtocolDexDailyStats maps volume_raw to volume_usd dividing by 1e6', async () => {
  mockQuery.mockResolvedValueOnce([
    { day: '2026-04-01', swaps: '100', volume_raw: '5000000000' },
  ])

  const [stat] = await getProtocolDexDailyStats(30)
  expect(stat.volume_usd).toBeCloseTo(5000)
  expect(stat.swaps).toBe(100)
  expect(stat.day).toBe('2026-04-01')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics
npx jest __tests__/lib/analytics.protocol-dex-daily.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `expect(sql).not.toContain('mv_protocol_dex_daily\n')` fails because the function still queries `mv_protocol_dex_daily`.

- [ ] **Step 3: Update analytics.ts line 669**

In `src/lib/analytics.ts`, change line 669 from:
```typescript
    FROM mv_protocol_dex_daily
```
to:
```typescript
    FROM mv_protocol_dex_volume_totals_daily
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
npx jest __tests__/lib/analytics.protocol-dex-daily.test.ts --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add __tests__/lib/analytics.protocol-dex-daily.test.ts src/lib/analytics.ts
git commit -m "refactor(analytics): getProtocolDexDailyStats queries mv_protocol_dex_volume_totals_daily"
```

---

### Task 9: Delete old flat SQL files

**Files:**
- Delete: `sql/clickhouse/views/core.sql`
- Delete: `sql/clickhouse/views/erc20-and-dex.sql`
- Delete: `sql/clickhouse/views/protocol-dex.sql`
- Delete: `sql/clickhouse/backfills/core.sql`
- Delete: `sql/clickhouse/backfills/erc20-and-dex.sql`
- Delete: `sql/clickhouse/backfills/protocol-dex.sql`

- [ ] **Step 1: Delete old flat files**

```bash
git rm sql/clickhouse/views/core.sql \
       sql/clickhouse/views/erc20-and-dex.sql \
       sql/clickhouse/views/protocol-dex.sql \
       sql/clickhouse/backfills/core.sql \
       sql/clickhouse/backfills/erc20-and-dex.sql \
       sql/clickhouse/backfills/protocol-dex.sql
```

- [ ] **Step 2: Run tests to confirm no regression**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Verify apply script finds views correctly**

```bash
find sql/clickhouse/views -name "*.sql" | sort | wc -l
```

Expected: `13`

- [ ] **Step 4: Verify old flat files are gone**

```bash
ls sql/clickhouse/views/*.sql 2>/dev/null && echo "ERROR: flat files remain" || echo "OK"
ls sql/clickhouse/backfills/*.sql 2>/dev/null && echo "ERROR: flat backfill files remain" || echo "OK"
```

Expected: Both print `OK`.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(sql): delete old flat SQL files replaced by domain-organized files"
```

---

### Task 10: Update docs/data-assets.md traceability table

**Files:**
- Modify: `docs/data-assets.md`

Replace the existing table (lines 10–20) with an updated table reflecting new domain paths, the `mv_protocol_dex_daily` rename, and the new stablecoin supply rows.

- [ ] **Step 1: Replace the traceability table**

The file currently contains this table (keep the header prose above it unchanged):

```markdown
| Explorer surface | App file | SQL assets |
| --- | --- | --- |
| Analytics page summary, daily activity, AA features, and transaction breakdown cards | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Analytics page inscriptions chart | `src/app/analytics/page.tsx`, `src/lib/inscriptions.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Analytics page stablecoin chart | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| Analytics page DEX activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Analytics page NFT activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Stablecoins page | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| DEX page fee-token and community pool analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| DEX page protocol DEX analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/protocol-dex.sql`, `sql/clickhouse/backfills/protocol-dex.sql` |
| NFTs page | `src/app/nfts/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
```

Replace it with:

```markdown
| Explorer surface | App file | SQL assets |
| --- | --- | --- |
| Analytics page summary, daily activity, AA features, and transaction breakdown cards | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_daily_stats.sql`, `sql/clickhouse/backfills/chain/mv_daily_stats.sql` |
| Analytics page unique senders | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_daily_uniq.sql`, `sql/clickhouse/backfills/chain/mv_daily_uniq.sql` |
| Analytics page inscriptions chart | `src/app/analytics/page.tsx`, `src/lib/inscriptions.ts` | `sql/clickhouse/views/chain/mv_inscription_daily.sql`, `sql/clickhouse/backfills/chain/mv_inscription_daily.sql` |
| Analytics page stablecoin chart | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`, `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql` |
| Analytics page DEX activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_dex_daily.sql`, `sql/clickhouse/backfills/dex/mv_dex_daily.sql` |
| Analytics page NFT activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/nfts/mv_nft_daily.sql`, `sql/clickhouse/backfills/nfts/mv_nft_daily.sql` |
| Stablecoins page volume | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`, `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql` |
| Stablecoins page historical supply chart | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql`, `sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql` |
| DEX page fee-token analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_fee_token_daily.sql`, `sql/clickhouse/backfills/chain/mv_fee_token_daily.sql` |
| DEX page community pool analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_dex_daily.sql`, `sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql`, `sql/clickhouse/backfills/dex/mv_dex_daily.sql`, `sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql` |
| DEX page Protocol DEX volume totals | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql`, `sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql` |
| DEX page Protocol DEX pool explorer | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql`, `sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql` |
| NFTs page | `src/app/nfts/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/nfts/mv_nft_daily.sql`, `sql/clickhouse/backfills/nfts/mv_nft_daily.sql` |
| Token transfers (all ERC-20/ERC-721) | `src/lib/analytics.ts` | `sql/clickhouse/views/tokens/mv_token_transfers_daily.sql`, `sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql` |
| ERC-20 volume (all tokens) | `src/lib/analytics.ts` | `sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql`, `sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql` |
```

- [ ] **Step 2: Commit**

```bash
git add docs/data-assets.md
git commit -m "docs: update data-assets.md traceability table with domain paths and mv_protocol_dex rename"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics && npm test
```

Expected: All tests pass with 0 failures.

- [ ] **Step 2: Verify 26 domain-organized SQL files exist**

```bash
find sql/clickhouse -name "*.sql" | sort
```

Expected: 26 files — 13 under `views/` and 13 under `backfills/`, each in `chain/`, `tokens/`, `stablecoins/`, `dex/`, or `nfts/` subdirectory. No files directly under `views/` or `backfills/` root.

- [ ] **Step 3: Verify old flat files are absent**

```bash
ls sql/clickhouse/views/*.sql 2>/dev/null && echo "ERROR" || echo "OK: no flat view files"
ls sql/clickhouse/backfills/*.sql 2>/dev/null && echo "ERROR" || echo "OK: no flat backfill files"
```

Expected: Both print `OK`.

- [ ] **Step 4: Verify apply script changes**

```bash
grep -n "find\|xargs\|export -f\|arbitrary\|intentional" scripts/apply-clickhouse-assets.sh
```

Expected: Lines containing the recursive `find` command, `xargs -P`, `export -f run_sql rewrite_sql_for_db`, and the ordering comment.

- [ ] **Step 5: Verify analytics.ts rename**

```bash
grep "mv_protocol_dex_daily" src/lib/analytics.ts
```

Expected: Empty output (no bare `mv_protocol_dex_daily` remaining; only `mv_protocol_dex_volume_totals_daily` and `mv_protocol_dex_pool_daily` exist).
