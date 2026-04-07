# Analytics & Decoding Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add decoded tx/event labels, ClickHouse materialized views for 1000x analytics speedup, transaction category analytics, TIP-20 inscription analytics, WhatsABI calldata decoding, stablecoin/DEX/NFT analytics, and a data validation harness to the Tempo Explorer.

**Architecture:** Static signature registries handle ~95% of decoding at zero cost (no RPC). ClickHouse AggregatingMergeTree/SummingMergeTree materialized views pre-compute daily rollups so analytics queries scan ~30 rows instead of 15M. WhatsABI handles the remaining "unknown contract" case on the tx detail page only (on-demand, cached in Redis per contract address).

**Tech Stack:** Next.js 15 App Router, ClickHouse 24.8 (direct HTTP API at port 8123), Redis (best-effort cache), recharts 2.x, `@shazow/whatsabi`, viem 2.43+

---

## Background & Data Reality

Before building, understand the actual Tempo transaction distribution (from live data):

| Category | Count | % | Notes |
|---|---|---|---|
| Tempo protocol txs (`to = 0x0000`) | ~13.2M | ~84% | System precompiles: `0xc0000000` (block record), `0xf9...f8` family (consensus/fee ops) |
| ERC-20/TIP-20 (transfer, approve) | ~1.1M | ~7% | Standard known selectors |
| Other user/DeFi | ~1.2M | ~8% | Uniswap V2 live, other protocols |
| TIP-20 inscriptions (`input` starts `{"`) | ~80K | ~0.5% | JSON calldata: `{"p":"tip-20","op":"mint","tick":"TEMP","amt":"420"}` |

Key schema facts (ClickHouse, database `tidx_4217`):
- `txs`: `block_timestamp`, `idx`, `hash`, `from`, `to`, `input`, `call_count`, `fee_payer`, `signature_type`, `calls` (JSON batch), `fee_token`
- `logs`: `block_timestamp`, `log_idx`, `tx_hash`, `address`, `selector` (= topic0, 32 bytes), `topic1`, `topic2`, `topic3`, `data`
- `blocks`: `num`, `hash`, `parent_hash`, `timestamp`, `miner`, `gas_limit`, `gas_used`
- The tidx HTTP API (`localhost:8080`) **blocks** ClickHouse-specific functions (`toStartOfDay`, `uniq`, `countIf`). All analytics queries go to ClickHouse directly at `http://clickhouse:8123` via `lib/clickhouse.ts`

---

## File Map

```
tidx/
  scripts/
    setup-clickhouse-views.sql     CREATE — One-time MV setup + backfill (run with docker exec)

tidx/explorer/
  src/lib/
    signatures.ts                  CREATE — Static 4-byte selector + event registry + tx classifier
    inscriptions.ts                CREATE — TIP-20 inscription ClickHouse queries
    whatsabi.ts                    CREATE — On-demand calldata decoder (WhatsABI, cached per contract)
    analytics.ts                   MODIFY — Add categorized stats, inscription stats, migrate to MVs
    chain.ts                       CREATE — Shared viem chain + publicClient (extracted from mpp.ts)
    mpp.ts                         MODIFY — Import tempoChain from lib/chain.ts instead of inline define

  src/components/charts/
    TxCategoryChart.tsx            CREATE — Stacked area: protocol / user / inscription split
    InscriptionChart.tsx           CREATE — Bar chart: daily inscription counts by top ticker

  src/app/analytics/
    page.tsx                       MODIFY — Add category breakdown section + inscription section

  src/app/tx/[hash]/
    page.tsx                       MODIFY — Pass decoded calldata to TxDetail

  src/components/
    TxDetail.tsx                   MODIFY — Show decoded function name row + input type label

  __tests__/lib/
    signatures.test.ts             CREATE — Registry lookup + tx classifier unit tests
    inscriptions.test.ts           CREATE — Inscription input parser unit tests
    whatsabi.test.ts               CREATE — Decoder with mocked fetch + cache
```

---

## Task 1: Static Signature + Event Registry

**Files:**
- Create: `explorer/src/lib/signatures.ts`
- Create: `explorer/__tests__/lib/signatures.test.ts`

This module is pure data + pure functions. Zero external deps. Covers ~95% of all decoding needs at query time (no RPC).

- [ ] **Step 1: Write the failing tests**

```typescript
// explorer/__tests__/lib/signatures.test.ts
import {
  lookupSelector, lookupEvent, classifyTx,
  KNOWN_SELECTORS, KNOWN_EVENTS,
} from '@/lib/signatures'

test('lookupSelector: known ERC-20 transfer', () => {
  expect(lookupSelector('0xa9059cbb')).toBe('transfer(address,uint256)')
})

test('lookupSelector: known ERC-20 approve', () => {
  expect(lookupSelector('0x095ea7b3')).toBe('approve(address,uint256)')
})

test('lookupSelector: Tempo protocol block record', () => {
  expect(lookupSelector('0xc0000000')).toBe('[Tempo] protocol block record')
})

test('lookupSelector: case-insensitive', () => {
  expect(lookupSelector('0xA9059CBB')).toBe('transfer(address,uint256)')
})

test('lookupSelector: returns undefined for unknown', () => {
  expect(lookupSelector('0xdeadbeef')).toBeUndefined()
})

test('lookupEvent: ERC-20 Transfer', () => {
  expect(lookupEvent('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'))
    .toBe('Transfer(address,address,uint256)')
})

test('lookupEvent: Uniswap V2 Swap', () => {
  expect(lookupEvent('0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'))
    .toBe('Swap(address,uint256,uint256,uint256,uint256,address)')
})

test('lookupEvent: returns undefined for unknown', () => {
  expect(lookupEvent('0x' + 'aa'.repeat(32))).toBeUndefined()
})

test('classifyTx: protocol tx (to=0x0000)', () => {
  expect(classifyTx('0x0000000000000000000000000000000000000000', '0xc0000000deadbeef'))
    .toBe('protocol')
})

test('classifyTx: inscription (JSON input)', () => {
  const jsonHex = '0x' + Buffer.from('{"p":"tip-20","op":"mint"}').toString('hex')
  expect(classifyTx('0x0000000000000000000000000000000000000000', jsonHex))
    .toBe('inscription')
})

test('classifyTx: user tx', () => {
  expect(classifyTx('0x20c0000000000000000000000000000000000000', '0xa9059cbb0000'))
    .toBe('user')
})

test('classifyTx: contract deploy (to=null)', () => {
  expect(classifyTx(null, '0x6080604052')).toBe('deploy')
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/signatures.test.ts
# Expected: Cannot find module '@/lib/signatures'
```

- [ ] **Step 3: Implement the registry**

```typescript
// explorer/src/lib/signatures.ts

export const KNOWN_SELECTORS: Record<string, string> = {
  // ERC-20 / TIP-20
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x095ea7b3': 'approve(address,uint256)',
  '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0xd0def521': 'mint(address,uint256)',
  '0x40c10f19': 'mint(address,uint256)',   // alternate selector
  '0x42966c68': 'burn(uint256)',
  '0x70a08231': 'balanceOf(address)',
  '0x18160ddd': 'totalSupply()',
  '0xdd62ed3e': 'allowance(address,address)',
  // Uniswap V2
  '0x38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  '0x8803dbee': 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)',
  '0xe8e33700': 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)',
  '0xbaa2abde': 'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)',
  '0x0902f1ac': 'getReserves()',
  // Tempo protocol (address 0x0000, sequential block args)
  '0xc0000000': '[Tempo] protocol block record',
  '0xf901ecf8': '[Tempo] protocol operation A',
  '0xf903d8f8': '[Tempo] protocol operation B',
  '0xf904cef8': '[Tempo] protocol operation C',
  '0xf90453f8': '[Tempo] protocol operation D',
  '0xf90549f8': '[Tempo] protocol operation E',
  '0xf902e2f8': '[Tempo] protocol operation F',
  '0xf90171f8': '[Tempo] protocol operation G',
  '0xf90267f8': '[Tempo] protocol operation H',
  // Misc
  '0x3161b7f6': 'unknown()',  // high-freq on Tempo, not in 4byte DB yet
  '0x95777d59': 'unknown()',
  '0x26092b83': 'unknown()',
}

export const KNOWN_EVENTS: Record<string, string> = {
  // ERC-20 / TIP-20
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef':
    'Transfer(address,address,uint256)',
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925':
    'Approval(address,address,uint256)',
  '0x0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885':
    'Mint(address,uint256)',
  // Uniswap V2
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1':
    'Sync(uint112,uint112)',
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822':
    'Swap(address,uint256,uint256,uint256,uint256,address)',
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f':
    'Mint(address,uint256,uint256)',
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4cf2e500ce3b2e59496':
    'Burn(address,uint256,uint256,address)',
}

export function lookupSelector(selector: string): string | undefined {
  return KNOWN_SELECTORS[selector.toLowerCase()]
}

export function lookupEvent(topic0: string): string | undefined {
  return KNOWN_EVENTS[topic0.toLowerCase()]
}

export type TxCategory = 'protocol' | 'inscription' | 'user' | 'deploy'

export function classifyTx(to: string | null, input: string): TxCategory {
  if (to === null) return 'deploy'
  if (to === '0x0000000000000000000000000000000000000000') {
    // Inscriptions are JSON calldata, even when sent to 0x0000
    if (input.toLowerCase().startsWith('0x7b')) return 'inscription'
    return 'protocol'
  }
  return 'user'
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/signatures.test.ts
# Expected: PASS, 14 tests
```

- [ ] **Step 5: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/signatures.ts __tests__/lib/signatures.test.ts
git commit -m "feat: add static signature + event registry with tx classifier"
```

---

## Task 2: ClickHouse Materialized Views (One-Time Setup)

**Files:**
- Create: `scripts/setup-clickhouse-views.sql`

This is the highest-leverage change in the plan. Reduces analytics query time from ~140ms (full 15M-row scan) to <1ms (30-row MV scan). Run once; MVs auto-update as tidx writes new blocks.

**Why this design:**
- `mv_daily_stats` uses `SummingMergeTree` — sums simple counters per day
- `mv_daily_uniq` uses `AggregatingMergeTree` — stores HyperLogLog sketch for exact-ish unique sender counts
- `mv_token_transfers_daily` enables token volume analytics
- `mv_inscription_daily` enables inscription analytics with pre-parsed JSON

- [ ] **Step 1: Create the SQL setup script**

```sql
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
```

- [ ] **Step 2: Run the setup script**

```bash
cd ~/tidx
docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 \
  < scripts/setup-clickhouse-views.sql
# Expected: no errors, ~30-60s for backfill
```

- [ ] **Step 3: Verify MVs are populated**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT 'mv_daily_stats' as tbl, count() FROM tidx_4217.mv_daily_stats
  UNION ALL
  SELECT 'mv_daily_uniq', count() FROM tidx_4217.mv_daily_uniq
  UNION ALL
  SELECT 'mv_token_transfers_daily', count() FROM tidx_4217.mv_token_transfers_daily
  UNION ALL
  SELECT 'mv_inscription_daily', count() FROM tidx_4217.mv_inscription_daily
"
# Expected: each table has ~80-110 rows (one per day since chain genesis)
```

- [ ] **Step 4: Verify a query returns correct totals**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT sum(txs) as total_txs, sum(user_txs) as user, sum(protocol_txs) as protocol,
         sum(inscription_txs) as inscriptions
  FROM tidx_4217.mv_daily_stats
"
# Expected: total_txs ≈ 15.7M, protocol ≈ 13.2M, inscriptions ≈ 80K
```

- [ ] **Step 5: Commit**

```bash
cd ~/tidx
git add scripts/setup-clickhouse-views.sql
git commit -m "feat: add ClickHouse materialized views for daily stats, uniq senders, token transfers, inscriptions"
```

---

## Task 3: Migrate Analytics to Use Materialized Views

**Files:**
- Modify: `explorer/src/lib/analytics.ts`

Replace the three full-scan queries (`getDailyStats`, `getNetworkSummary`, `getSignatureTypeStats`) with MV-backed queries. Same return types — this is a pure performance upgrade, nothing changes in the UI.

- [ ] **Step 1: Update `getDailyStats` to use MVs**

Replace the current `getDailyStats` function body in `explorer/src/lib/analytics.ts`:

```typescript
export async function getDailyStats(days = 30): Promise<DailyStat[]> {
  const key = `analytics:daily:${days}`
  const cached = await getCached<DailyStat[]>(key)
  if (cached) return cached

  // Join mv_daily_stats (SummingMergeTree) with mv_daily_uniq (AggregatingMergeTree)
  const rows = await queryClickHouse<{
    day: string; txs: string; unique_senders: string
    batch_txs: string; sponsored_txs: string
  }>(`
    SELECT
      s.day                             AS day,
      sum(s.txs)                        AS txs,
      uniqMerge(u.unique_senders_state) AS unique_senders,
      sum(s.batch_txs)                  AS batch_txs,
      sum(s.sponsored_txs)              AS sponsored_txs
    FROM mv_daily_stats s
    ANY LEFT JOIN (
      SELECT day, uniqMerge(unique_senders_state) AS unique_senders_state
      FROM mv_daily_uniq
      GROUP BY day
    ) u ON s.day = u.day
    WHERE s.day >= today() - ${days}
    GROUP BY s.day
    ORDER BY s.day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    txs: Number(r.txs),
    unique_senders: Number(r.unique_senders),
    batch_txs: Number(r.batch_txs),
    sponsored_txs: Number(r.sponsored_txs),
  }))

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 2: Update `getNetworkSummary` to use MVs**

Replace the current `getNetworkSummary` function body:

```typescript
export async function getNetworkSummary(): Promise<NetworkSummary> {
  const key = 'analytics:summary'
  const cached = await getCached<NetworkSummary>(key)
  if (cached) return cached

  const [statsRows, uniqRows, receiptRows] = await Promise.all([
    queryClickHouse<{
      total_txs: string; batch_txs: string; sponsored_txs: string
      contract_deployments: string
    }>(`
      SELECT
        sum(txs)               AS total_txs,
        sum(batch_txs)         AS batch_txs,
        sum(sponsored_txs)     AS sponsored_txs,
        sum(inscription_txs)   AS inscription_txs
      FROM mv_daily_stats
    `),
    queryClickHouse<{ total_addresses: string }>(`
      SELECT uniqMerge(unique_senders_state) AS total_addresses
      FROM mv_daily_uniq
    `),
    // contract deploys not in mv_daily_stats — small full scan (32K rows) is acceptable
    queryClickHouse<{ contract_deployments: string }>(`
      SELECT countIf(to IS NULL) AS contract_deployments FROM txs
    `),
  ])

  const s = statsRows[0]
  const result: NetworkSummary = {
    total_txs: Number(s.total_txs),
    total_addresses: Number(uniqRows[0].total_addresses),
    contract_deployments: Number(receiptRows[0].contract_deployments),
    batch_txs: Number(s.batch_txs),
    sponsored_txs: Number(s.sponsored_txs),
  }

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 3: Remove the old `getSignatureTypeStats` full scan and replace with a 30-day MV-backed version**

`signature_type` is not in the MVs. It's a small cardinality column (3 values) and a 30-day window scan is fast enough (~50ms). Leave `getSignatureTypeStats` as-is (full scan on `txs`), but add a WHERE to limit to last 90 days to bound the cost:

```typescript
export async function getSignatureTypeStats(): Promise<SigTypeStat[]> {
  const key = 'analytics:sig_types'
  const cached = await getCached<SigTypeStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ signature_type: number | null; txs: string }>(`
    SELECT signature_type, count() as txs
    FROM txs
    WHERE block_timestamp >= now() - INTERVAL 90 DAY
    GROUP BY signature_type
    ORDER BY txs DESC
  `)

  const result = rows.map(r => ({
    signature_type: r.signature_type,
    txs: Number(r.txs),
  }))

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 4: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build, no type errors
```

- [ ] **Step 5: Spot-check query speed**

```bash
# Query the MV directly to confirm speed
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT sum(txs), sum(batch_txs) FROM tidx_4217.mv_daily_stats
  WHERE day >= today() - 30 GROUP BY day ORDER BY day
  FORMAT JSON
" 2>&1 | grep elapsed
# Expected: elapsed < 0.005 (vs 0.14 before)
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/analytics.ts
git commit -m "perf: migrate analytics queries to ClickHouse materialized views"
```

---

## Task 4: Transaction Category Analytics

**Files:**
- Modify: `explorer/src/lib/analytics.ts` — add `getDailyStatsCategorized()`
- Create: `explorer/src/components/charts/TxCategoryChart.tsx`
- Modify: `explorer/src/app/analytics/page.tsx`

Adds a new chart showing the protocol/user/inscription split, making Tempo's unusual tx composition visible and understandable.

- [ ] **Step 1: Add `getDailyStatsCategorized` to analytics.ts**

Add to `explorer/src/lib/analytics.ts` (after existing exports):

```typescript
export interface DailyStatCategorized {
  day: string
  user_txs: number
  protocol_txs: number
  inscription_txs: number
}

export async function getDailyStatsCategorized(days = 30): Promise<DailyStatCategorized[]> {
  const key = `analytics:categorized:${days}`
  const cached = await getCached<DailyStatCategorized[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; user_txs: string; protocol_txs: string; inscription_txs: string
  }>(`
    SELECT
      day,
      sum(user_txs)        AS user_txs,
      sum(protocol_txs)    AS protocol_txs,
      sum(inscription_txs) AS inscription_txs
    FROM mv_daily_stats
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    user_txs: Number(r.user_txs),
    protocol_txs: Number(r.protocol_txs),
    inscription_txs: Number(r.inscription_txs),
  }))

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 2: Create `TxCategoryChart.tsx`**

```typescript
// explorer/src/components/charts/TxCategoryChart.tsx
'use client'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { DailyStatCategorized } from '@/lib/analytics'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function TxCategoryChart({ data }: { data: DailyStatCategorized[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => v.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => fmt.format(v)}
          width={48}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number) => [v.toLocaleString(), '']}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="user_txs"
          name="User"
          stackId="1"
          stroke="#0057FF"
          fill="#0057FF"
          fillOpacity={0.6}
        />
        <Area
          type="monotone"
          dataKey="inscription_txs"
          name="Inscriptions"
          stackId="1"
          stroke="#F59E0B"
          fill="#F59E0B"
          fillOpacity={0.6}
        />
        <Area
          type="monotone"
          dataKey="protocol_txs"
          name="Protocol"
          stackId="1"
          stroke="#374151"
          fill="#374151"
          fillOpacity={0.8}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: Add the chart to analytics/page.tsx**

In `explorer/src/app/analytics/page.tsx`, add to the imports:

```typescript
import { getDailyStatsCategorized } from '@/lib/analytics'
import { TxCategoryChart } from '@/components/charts/TxCategoryChart'
```

Add `getDailyStatsCategorized(30)` to the `Promise.all` in `AnalyticsPage`:

```typescript
const [daily, categorized, sigTypes, summary] = await Promise.all([
  getDailyStats(30),
  getDailyStatsCategorized(30),
  getSignatureTypeStats(),
  getNetworkSummary(),
])
```

Add the chart card after the existing daily activity chart:

```tsx
<div className="mb-6">
  <ChartCard title="Transaction Breakdown — user vs protocol vs inscriptions">
    <p className="text-tempo-muted text-xs mb-3">
      ~84% of Tempo transactions are protocol-level operations (block records, consensus). 
      User and inscription activity is shown separately.
    </p>
    <TxCategoryChart data={categorized} />
  </ChartCard>
</div>
```

- [ ] **Step 4: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/components/charts/TxCategoryChart.tsx src/app/analytics/page.tsx
git commit -m "feat: add transaction category breakdown chart (user/protocol/inscriptions)"
```

---

## Task 5: TIP-20 Inscription Analytics

**Files:**
- Create: `explorer/src/lib/inscriptions.ts`
- Create: `explorer/src/components/charts/InscriptionChart.tsx`
- Create: `explorer/__tests__/lib/inscriptions.test.ts`
- Modify: `explorer/src/app/analytics/page.tsx`

TIP-20 inscriptions (`{"p":"tip-20","op":"mint","tick":"TEMP","amt":"420"}`) are a distinct Tempo-native activity with their own analytics story: what tickers are being minted, how inscription volume tracks over time.

- [ ] **Step 1: Write the failing inscription parser tests**

```typescript
// explorer/__tests__/lib/inscriptions.test.ts
import { parseInscriptionInput } from '@/lib/inscriptions'

function hexEncode(str: string): string {
  return '0x' + Buffer.from(str).toString('hex')
}

test('parses a valid TIP-20 mint inscription', () => {
  const input = hexEncode('{"p":"tip-20","op":"mint","tick":"TEMP","amt":"420"}')
  expect(parseInscriptionInput(input)).toEqual({
    p: 'tip-20', op: 'mint', tick: 'TEMP', amt: '420',
  })
})

test('parses a deploy inscription', () => {
  const input = hexEncode('{"p":"tip-20","op":"deploy","tick":"TIME","max":"21000000"}')
  expect(parseInscriptionInput(input)).toMatchObject({ op: 'deploy', tick: 'TIME' })
})

test('returns null for non-JSON input', () => {
  expect(parseInscriptionInput('0xa9059cbb0000')).toBeNull()
})

test('returns null for 0x-only input', () => {
  expect(parseInscriptionInput('0x')).toBeNull()
})

test('returns null for malformed JSON hex', () => {
  // "not json" as hex
  expect(parseInscriptionInput('0x' + Buffer.from('not json').toString('hex'))).toBeNull()
})

test('normalizes tick to uppercase', () => {
  const input = hexEncode('{"p":"tip-20","op":"mint","tick":"temp","amt":"1"}')
  const result = parseInscriptionInput(input)
  expect(result?.tick).toBe('TEMP')
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/inscriptions.test.ts
# Expected: Cannot find module '@/lib/inscriptions'
```

- [ ] **Step 3: Implement `inscriptions.ts`**

```typescript
// explorer/src/lib/inscriptions.ts
import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'

export interface InscriptionData {
  p: string
  op: string
  tick: string
  amt?: string
  max?: string
  lim?: string
}

export function parseInscriptionInput(input: string): InscriptionData | null {
  if (!input || input === '0x' || !input.toLowerCase().startsWith('0x7b')) return null
  try {
    const raw = Buffer.from(input.slice(2), 'hex').toString('utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    if (parsed.tick) parsed.tick = String(parsed.tick).toUpperCase()
    return parsed as InscriptionData
  } catch {
    return null
  }
}

export interface InscriptionTotals {
  tick: string
  mints: number
}

export interface DailyInscriptionStat {
  day: string
  op: string
  tick: string
  count: number
}

export async function getInscriptionTotals(): Promise<InscriptionTotals[]> {
  const key = 'analytics:inscriptions:totals'
  const cached = await getCached<InscriptionTotals[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ tick: string; mints: string }>(`
    SELECT tick, sum(count) AS mints
    FROM mv_inscription_daily
    WHERE op = 'mint' AND tick != ''
    GROUP BY tick
    ORDER BY mints DESC
    LIMIT 10
  `)

  const result = rows.map(r => ({ tick: r.tick, mints: Number(r.mints) }))
  await setCached(key, result, 900)
  return result
}

export async function getDailyInscriptionStats(days = 30): Promise<DailyInscriptionStat[]> {
  const key = `analytics:inscriptions:daily:${days}`
  const cached = await getCached<DailyInscriptionStat[]>(key)
  if (cached) return cached

  // Get top 5 tickers by all-time mint volume to constrain the chart
  const topTickers = await queryClickHouse<{ tick: string }>(`
    SELECT tick FROM mv_inscription_daily
    WHERE op = 'mint' AND tick != ''
    GROUP BY tick ORDER BY sum(count) DESC LIMIT 5
  `)
  const tickers = topTickers.map(r => `'${r.tick}'`).join(', ')

  const rows = await queryClickHouse<{
    day: string; op: string; tick: string; count: string
  }>(`
    SELECT day, op, tick, sum(count) AS count
    FROM mv_inscription_daily
    WHERE day >= today() - ${days}
      AND op IN ('mint', 'deploy', 'list', 'buy')
      AND tick IN (${tickers || "''"})
    GROUP BY day, op, tick
    ORDER BY day ASC, count DESC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    op: r.op,
    tick: r.tick,
    count: Number(r.count),
  }))

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/inscriptions.test.ts
# Expected: PASS, 6 tests
```

- [ ] **Step 5: Create `InscriptionChart.tsx`**

```typescript
// explorer/src/components/charts/InscriptionChart.tsx
'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts'
import type { InscriptionTotals } from '@/lib/inscriptions'

const COLORS = ['#F59E0B', '#0057FF', '#10B981', '#8B5CF6', '#EF4444',
                '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1']

interface Props {
  totals: InscriptionTotals[]
}

export function InscriptionChart({ totals }: Props) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={totals} layout="vertical" margin={{ top: 4, right: 32, left: 40, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)}
        />
        <YAxis
          type="category"
          dataKey="tick"
          tick={{ fill: '#fff', fontSize: 12 }}
          width={48}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number) => [v.toLocaleString(), 'mints']}
        />
        <Bar dataKey="mints" radius={[0, 4, 4, 0]}>
          {totals.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 6: Add inscription section to analytics/page.tsx**

Add to imports:

```typescript
import { getInscriptionTotals } from '@/lib/inscriptions'
import { InscriptionChart } from '@/components/charts/InscriptionChart'
```

Add to `Promise.all`:

```typescript
const [daily, categorized, sigTypes, summary, inscriptionTotals] = await Promise.all([
  getDailyStats(30),
  getDailyStatsCategorized(30),
  getSignatureTypeStats(),
  getNetworkSummary(),
  getInscriptionTotals(),
])
```

Add after the feature charts row:

```tsx
{inscriptionTotals.length > 0 && (
  <div className="mb-8">
    <ChartCard title="TIP-20 Inscriptions — all-time mint volume by ticker">
      <p className="text-tempo-muted text-xs mb-3">
        TIP-20 inscriptions use JSON calldata ({"p":"tip-20","op":"mint",...}) — the BRC-20 
        pattern on Tempo. Tickers like TEMP, MEME, and tempodz have active mint communities.
      </p>
      <InscriptionChart totals={inscriptionTotals} />
    </ChartCard>
  </div>
)}
```

- [ ] **Step 7: Run all tests and build**

```bash
cd ~/tidx/explorer && npm test && npm run build
# Expected: 19+ tests pass, clean build
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/inscriptions.ts src/components/charts/InscriptionChart.tsx \
        src/app/analytics/page.tsx __tests__/lib/inscriptions.test.ts
git commit -m "feat: TIP-20 inscription analytics with ticker breakdown"
```

---

## Task 6: WhatsABI Calldata Decoding (Tx Detail Page)

**Files:**
- Create: `explorer/src/lib/chain.ts`
- Modify: `explorer/src/lib/mpp.ts`
- Create: `explorer/src/lib/whatsabi.ts`
- Create: `explorer/__tests__/lib/whatsabi.test.ts`
- Modify: `explorer/src/app/tx/[hash]/page.tsx`
- Modify: `explorer/src/components/TxDetail.tsx`

Decoding priority for any transaction input:
1. `to = null` → "Contract Deploy"
2. `to = 0x0000` + JSON prefix → TIP-20 inscription (decode JSON)
3. `to = 0x0000` → `[Tempo] protocol` (label from registry)
4. First 4 bytes in `KNOWN_SELECTORS` → use registry label (no RPC)
5. Otherwise → WhatsABI (fetch bytecode once, cache 1h in Redis, decode with viem)

- [ ] **Step 1: Extract shared chain definition**

```typescript
// explorer/src/lib/chain.ts
import { createPublicClient, http, defineChain } from 'viem'

export const tempoChain = defineChain({
  id: 4217,
  name: 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.TEMPO_RPC_URL ?? 'https://rpc.mainnet.tempo.xyz'] },
  },
})

export const publicClient = createPublicClient({
  chain: tempoChain,
  transport: http(),
})
```

- [ ] **Step 2: Update mpp.ts to import from chain.ts**

In `explorer/src/lib/mpp.ts`, replace the inline `defineChain` + `createPublicClient` call with:

```typescript
import { parseUnits } from 'viem'
import { publicClient } from '@/lib/chain'
import { getCached, setCached } from '@/lib/cache'
import { randomBytes } from 'crypto'
// Remove: import { createPublicClient, http, parseUnits, defineChain } from 'viem'
// Remove: const tempo = defineChain({ ... })
// Change: const client = createPublicClient({ chain: tempo, transport: http() })
// To use:  publicClient  directly
```

The full updated `verifyPayment` function replaces `const client = createPublicClient(...)` with just `publicClient`:

```typescript
const receipt = await publicClient.getTransactionReceipt({
  hash: txHash as `0x${string}`,
})
```

- [ ] **Step 3: Install WhatsABI**

```bash
cd ~/tidx/explorer && npm install @shazow/whatsabi
```

- [ ] **Step 4: Write failing whatsabi tests**

```typescript
// explorer/__tests__/lib/whatsabi.test.ts
import { decodeCalldata } from '@/lib/whatsabi'

// Mock ioredis (required by cache.ts)
jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store[k] ?? null),
    set: jest.fn(async (k: string, v: string) => { store[k] = v }),
    del: jest.fn(async (k: string) => { delete store[k] }),
  }))
})

const TRANSFER_INPUT =
  '0xa9059cbb' +
  '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12' +
  '0000000000000000000000000000000000000000000000000000000005F5E100'

test('decodes known selector from registry without RPC', async () => {
  // fetch should NOT be called for known selectors
  global.fetch = jest.fn().mockRejectedValue(new Error('should not call fetch'))
  const result = await decodeCalldata(
    '0x20c0000000000000000000000000000000000000',
    TRANSFER_INPUT,
  )
  expect(result?.functionName).toBe('transfer(address,uint256)')
  expect(fetch).not.toHaveBeenCalled()
})

test('returns protocol label for 0x0000 address without RPC', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('should not call fetch'))
  const result = await decodeCalldata(
    '0x0000000000000000000000000000000000000000',
    '0xc0000000' + '0'.repeat(64),
  )
  expect(result?.functionName).toBe('[Tempo] protocol block record')
  expect(fetch).not.toHaveBeenCalled()
})

test('returns inscription label for JSON input', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('should not call fetch'))
  const jsonHex = '0x' + Buffer.from('{"p":"tip-20","op":"mint","tick":"TEMP","amt":"420"}').toString('hex')
  const result = await decodeCalldata(
    '0x0000000000000000000000000000000000000000',
    jsonHex,
  )
  expect(result?.functionName).toBe('[TIP-20] mint TEMP × 420')
  expect(fetch).not.toHaveBeenCalled()
})

test('returns null for empty input', async () => {
  const result = await decodeCalldata('0x1234000000000000000000000000000000000000', '0x')
  expect(result).toBeNull()
})

test('returns null on RPC failure without throwing', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
  const result = await decodeCalldata(
    '0x1234000000000000000000000000000000000000',
    '0xdeadbeef' + '0'.repeat(64),
  )
  expect(result).toBeNull()
})
```

- [ ] **Step 5: Run tests — verify they fail**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/whatsabi.test.ts
# Expected: Cannot find module '@/lib/whatsabi'
```

- [ ] **Step 6: Implement `whatsabi.ts`**

```typescript
// explorer/src/lib/whatsabi.ts
import { decodeFunctionData } from 'viem'
import { getCached, setCached } from '@/lib/cache'
import { lookupSelector, classifyTx } from '@/lib/signatures'
import { parseInscriptionInput } from '@/lib/inscriptions'
import { publicClient } from '@/lib/chain'

export interface DecodedCalldata {
  functionName: string
  args?: string[]
}

export async function decodeCalldata(
  to: string | null,
  input: string,
): Promise<DecodedCalldata | null> {
  if (!input || input === '0x') return null

  const category = classifyTx(to, input)

  // Protocol tx — label from registry, no RPC
  if (category === 'protocol') {
    const selector = input.slice(0, 10).toLowerCase()
    return { functionName: lookupSelector(selector) ?? `[Tempo] protocol (${selector})` }
  }

  // TIP-20 inscription — decode JSON, no RPC
  if (category === 'inscription') {
    const parsed = parseInscriptionInput(input)
    if (parsed) {
      const label = parsed.amt
        ? `[TIP-20] ${parsed.op} ${parsed.tick} × ${parsed.amt}`
        : `[TIP-20] ${parsed.op} ${parsed.tick}`
      return { functionName: label }
    }
    return { functionName: '[TIP-20] inscription' }
  }

  // Contract deploy
  if (category === 'deploy') return { functionName: 'Contract Deploy' }

  // User tx: check static registry first (no RPC)
  if (input.length >= 10) {
    const selector = input.slice(0, 10).toLowerCase()
    const knownName = lookupSelector(selector)
    if (knownName) return { functionName: knownName }

    // Unknown selector: try WhatsABI (with Redis cache per contract)
    if (to) {
      return decodeWithWhatsABI(to as `0x${string}`, input as `0x${string}`)
    }
  }

  return null
}

async function decodeWithWhatsABI(
  address: `0x${string}`,
  input: `0x${string}`,
): Promise<DecodedCalldata | null> {
  const cacheKey = `whatsabi:abi:${address.toLowerCase()}`

  try {
    // Check cache first (ABI is stable per contract)
    let abi = await getCached<unknown[]>(cacheKey)

    if (!abi) {
      // Fetch bytecode via viem, infer ABI with whatsabi
      const { whatsabi } = await import('@shazow/whatsabi')
      const bytecode = await publicClient.getBytecode({ address })
      if (!bytecode || bytecode === '0x') return null

      const rawAbi = whatsabi.abiFromBytecode(bytecode)

      // Optionally resolve function names from 4byte.directory
      try {
        const loader = new whatsabi.loaders.SignatureLookup()
        abi = await whatsabi.resolveABINames(rawAbi, loader) as unknown[]
      } catch {
        abi = rawAbi as unknown[]
      }

      await setCached(cacheKey, abi, 3600) // 1h — ABI doesn't change
    }

    const { functionName, args } = decodeFunctionData({
      abi: abi as Parameters<typeof decodeFunctionData>[0]['abi'],
      data: input,
    })

    return {
      functionName: String(functionName),
      args: args ? (args as unknown[]).map(a => String(a)) : undefined,
    }
  } catch {
    return null // never throw — decoding is best-effort
  }
}
```

- [ ] **Step 7: Run tests — verify they pass**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/whatsabi.test.ts
# Expected: PASS, 5 tests
```

- [ ] **Step 8: Pass decoded calldata to TxDetail**

In `explorer/src/app/tx/[hash]/page.tsx`, import `decodeCalldata` and call it inside `getTx`:

```typescript
import { decodeCalldata, type DecodedCalldata } from '@/lib/whatsabi'
```

Update the cached type and the `getTx` return:

```typescript
// Update cache type
const cached = await getCached<{
  tx: TidxRow; receipt: TidxRow | null; transfers: TokenTransfer[]; decoded: DecodedCalldata | null
}>(key)

// Add to the parallel fetches (no new fetch, just decode from tx data)
// After txResult/receiptResult/logsResult are fetched:
const decoded = await decodeCalldata(
  txResult.rows[0].to as string | null,
  txResult.rows[0].input as string,
)

const data = {
  tx: txResult.rows[0],
  receipt: receiptResult.rows[0] ?? null,
  transfers: decodeTransfers(logsResult.rows),
  decoded,
}
```

Pass `decoded` to `TxDetail`:

```tsx
<TxDetail tx={data.tx} receipt={data.receipt} decoded={data.decoded} />
```

- [ ] **Step 9: Show decoded calldata in TxDetail.tsx**

Update `TxDetailProps` and add the decoded row:

```typescript
// In TxDetail.tsx
import type { DecodedCalldata } from '@/lib/whatsabi'

interface TxDetailProps {
  tx: Record<string, string | number | null>
  receipt: Record<string, string | number | null> | null
  decoded?: DecodedCalldata | null
}
```

Add a `Function` row just before the `Nonce Key` field:

```tsx
{decoded && (
  <Field
    label="Function"
    value={
      <span>
        {decoded.functionName}
        {decoded.args && decoded.args.length > 0 && (
          <span className="text-tempo-muted ml-2 text-xs">
            ({decoded.args.slice(0, 3).join(', ')}{decoded.args.length > 3 ? ', …' : ''})
          </span>
        )}
      </span>
    }
    mono={false}
  />
)}
```

- [ ] **Step 10: Run all tests and build**

```bash
cd ~/tidx/explorer && npm test && npm run build
# Expected: all tests pass, clean build
```

- [ ] **Step 11: Rebuild and redeploy**

```bash
cd ~/tidx && docker compose build explorer && docker compose up -d explorer
sleep 5 && curl -s -o /dev/null -w "%{http_code}" http://localhost/
# Expected: 200
```

- [ ] **Step 12: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/chain.ts src/lib/mpp.ts src/lib/whatsabi.ts \
        src/app/tx/[hash]/page.tsx src/components/TxDetail.tsx \
        __tests__/lib/whatsabi.test.ts
git commit -m "feat: WhatsABI calldata decoding on tx detail page (registry-first, RPC fallback)"
```

---

## Task 7: Trace Investigation + Implementation

**Files:**
- Modify: `explorer/src/app/tx/[hash]/page.tsx` (if RPC supports traces)
- Create: `explorer/src/components/TraceTree.tsx` (if RPC supports traces)

Traces require `debug_traceTransaction` from the Tempo RPC. This task starts with a probe — if the endpoint isn't available, the task is shelved pending RPC support.

- [ ] **Step 1: Probe the Tempo RPC for trace support**

Pick any tx hash from the live explorer, then:

```bash
TX_HASH="<paste any tx hash from http://localhost/>"
curl -s -X POST https://rpc.mainnet.tempo.xyz \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"debug_traceTransaction\",\"params\":[\"$TX_HASH\",{}],\"id\":1}" \
  | python3 -m json.tool | head -30
```

**If response contains `"error": {"code": -32601`** (method not found) → traces not supported. Stop here and open a GitHub issue against the Tempo team requesting the endpoint. No further work in this task.

**If response contains `"result": {"gas":...,"structLogs":[...]}`** → continue to Step 2.

- [ ] **Step 2 (only if Step 1 succeeds): Add trace fetching to `getTx`**

In `explorer/src/lib/analytics.ts` — actually in `explorer/src/app/tx/[hash]/page.tsx`, add a `getTrace` function:

```typescript
async function getTrace(hash: string): Promise<TraceFrame[] | null> {
  const key = `trace:${hash}`
  const cached = await getCached<TraceFrame[]>(key)
  if (cached) return cached

  try {
    const res = await fetch(`${process.env.TEMPO_RPC_URL ?? 'https://rpc.mainnet.tempo.xyz'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'debug_traceTransaction',
        params: [hash, { tracer: 'callTracer' }],
        id: 1,
      }),
      cache: 'no-store',
    })
    const data = await res.json()
    if (data.error || !data.result) return null

    const trace = flattenCallTrace(data.result)
    await setCached(key, trace, 3600) // traces are immutable
    return trace
  } catch {
    return null
  }
}

interface TraceFrame {
  depth: number
  type: string   // CALL, STATICCALL, DELEGATECALL, CREATE
  from: string
  to: string
  value: string
  input: string
  output: string
  gas: string
  gasUsed: string
  error?: string
}

function flattenCallTrace(call: Record<string, unknown>, depth = 0): TraceFrame[] {
  const frame: TraceFrame = {
    depth,
    type: String(call.type ?? 'CALL'),
    from: String(call.from ?? ''),
    to: String(call.to ?? ''),
    value: String(call.value ?? '0x0'),
    input: String(call.input ?? '0x'),
    output: String(call.output ?? '0x'),
    gas: String(call.gas ?? '0x0'),
    gasUsed: String(call.gasUsed ?? '0x0'),
    error: call.error ? String(call.error) : undefined,
  }
  const calls = Array.isArray(call.calls) ? call.calls : []
  return [frame, ...calls.flatMap((c: Record<string, unknown>) => flattenCallTrace(c, depth + 1))]
}
```

- [ ] **Step 3 (only if Step 1 succeeds): Create `TraceTree.tsx`**

```typescript
// explorer/src/components/TraceTree.tsx
import type { TraceFrame } from '@/app/tx/[hash]/page'  // or move type to lib/traces.ts

const CALL_COLORS: Record<string, string> = {
  CALL: 'text-tempo-blue',
  STATICCALL: 'text-green-400',
  DELEGATECALL: 'text-yellow-400',
  CREATE: 'text-purple-400',
  CREATE2: 'text-purple-400',
}

export function TraceTree({ frames }: { frames: TraceFrame[] }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 overflow-x-auto">
      <div className="font-mono text-xs space-y-1">
        {frames.map((frame, i) => (
          <div
            key={i}
            style={{ paddingLeft: `${frame.depth * 20}px` }}
            className={`flex items-baseline gap-2 ${frame.error ? 'opacity-50' : ''}`}
          >
            <span className={CALL_COLORS[frame.type] ?? 'text-white'}>{frame.type}</span>
            <a href={`/address/${frame.to}`} className="text-white hover:text-tempo-blue">
              {frame.to.slice(0, 10)}…{frame.to.slice(-6)}
            </a>
            <span className="text-tempo-muted">
              {frame.input.length > 10 ? frame.input.slice(0, 10) + '…' : frame.input}
            </span>
            {frame.error && <span className="text-red-400 ml-auto">{frame.error}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4 (only if Step 1 succeeds): Wire trace into tx page**

In `getTx`, add trace to `Promise.all`:

```typescript
const [txResult, receiptResult, logsResult, trace] = await Promise.all([
  queryTidx(`SELECT * FROM txs WHERE hash = '${hash}' LIMIT 1`),
  queryTidx(`SELECT * FROM receipts WHERE tx_hash = '${hash}' LIMIT 1`),
  queryTidx(`SELECT address, topic1, topic2, data, log_idx FROM logs WHERE tx_hash = '${hash}' AND topic0 = '${TRANSFER_TOPIC}' ORDER BY log_idx ASC LIMIT 50`),
  getTrace(hash),
])
```

In the page JSX, add after the token transfers section:

```tsx
{data.trace && data.trace.length > 0 && (
  <div className="mt-8">
    <h2 className="text-lg font-medium text-white mb-4">
      Call Trace ({data.trace.length} frames)
    </h2>
    <TraceTree frames={data.trace} />
  </div>
)}
```

- [ ] **Step 5: Build, test, commit (if implemented)**

```bash
cd ~/tidx/explorer && npm test && npm run build
cd ~/tidx && docker compose build explorer && docker compose up -d explorer
```

```bash
git add src/app/tx/[hash]/page.tsx src/components/TraceTree.tsx
git commit -m "feat: call trace tree on tx detail page (callTracer)"
```

---

---

## Task 8: Token Registry

**Files:**
- Create: `explorer/src/lib/tokens.ts`
- Create: `explorer/__tests__/lib/tokens.test.ts`

Known Tempo tokens (verified via RPC on 2026-04-07). All TIP-20 tokens use 6 decimals. The `DONOTUSE` token must be excluded from analytics (supply = 18.4 trillion, clearly a test/deprecated contract).

- [ ] **Step 1: Write failing tests**

```typescript
// explorer/__tests__/lib/tokens.test.ts
import { getTokenInfo, formatTokenAmount, KNOWN_TOKENS, EXCLUDED_TOKENS } from '@/lib/tokens'

jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store[k] ?? null),
    set: jest.fn(async (k: string, v: string) => { store[k] = v }),
    del: jest.fn(async (k: string) => { delete store[k] }),
  }))
})

test('getTokenInfo returns static entry for pathUSD', async () => {
  const info = await getTokenInfo('0x20c0000000000000000000000000000000000000')
  expect(info).toMatchObject({ symbol: 'pathUSD', decimals: 6 })
})

test('getTokenInfo returns static entry for USDC.e', async () => {
  const info = await getTokenInfo('0x20c000000000000000000000b9537d11c60e8b50')
  expect(info).toMatchObject({ symbol: 'USDC.e', decimals: 6 })
})

test('getTokenInfo is case-insensitive', async () => {
  const info = await getTokenInfo('0x20C0000000000000000000000000000000000000')
  expect(info?.symbol).toBe('pathUSD')
})

test('EXCLUDED_TOKENS contains DONOTUSE address', () => {
  expect(EXCLUDED_TOKENS.has('0x20c00000000000000000000016c6514b53947fdc')).toBe(true)
})

test('formatTokenAmount with 6 decimals', () => {
  expect(formatTokenAmount(BigInt(1_000_000), 6)).toBe('1.00')
  expect(formatTokenAmount(BigInt(1_234_567), 6)).toBe('1.23')
  expect(formatTokenAmount(BigInt(500_000), 6)).toBe('0.50')
})

test('formatTokenAmount with 18 decimals', () => {
  expect(formatTokenAmount(BigInt('1000000000000000000'), 18)).toBe('1.00')
})

test('formatTokenAmount for large amounts uses compact notation', () => {
  expect(formatTokenAmount(BigInt(1_234_567_890_000), 6)).toBe('1.23M')
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/tokens.test.ts
# Expected: Cannot find module '@/lib/tokens'
```

- [ ] **Step 3: Implement `tokens.ts`**

```typescript
// explorer/src/lib/tokens.ts
import { getCached, setCached } from './cache'
import { publicClient } from './chain'

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
}

// Verified on-chain 2026-04-07. Add new tokens here as they appear.
export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0x20c0000000000000000000000000000000000000': {
    address: '0x20c0000000000000000000000000000000000000',
    symbol: 'pathUSD', name: 'pathUSD', decimals: 6,
  },
  '0x20c000000000000000000000b9537d11c60e8b50': {
    address: '0x20c000000000000000000000b9537d11c60e8b50',
    symbol: 'USDC.e', name: 'USD Coin (Bridged)', decimals: 6,
  },
  '0x20c000000000000000000000987bef2978df41f9': {
    address: '0x20c000000000000000000000987bef2978df41f9',
    symbol: 'TIMECOIN', name: 'TIMECOIN', decimals: 6,
  },
  '0x20c000000000000000000000109394a271f6aae6': {
    address: '0x20c000000000000000000000109394a271f6aae6',
    symbol: 'ENSH', name: 'ENSH', decimals: 6,
  },
  '0x20c00000000000000000000007affa1073fbc0ea': {
    address: '0x20c00000000000000000000007affa1073fbc0ea',
    symbol: 'METRONOME', name: 'Metronome', decimals: 6,
  },
  '0x0a064aecd773d3d8d09fd8fa72fcd763dd9ef3dc': {
    address: '0x0a064aecd773d3d8d09fd8fa72fcd763dd9ef3dc',
    symbol: 'PRC', name: 'PRC', decimals: 18,
  },
}

// These addresses are excluded from all analytics displays.
export const EXCLUDED_TOKENS = new Set([
  '0x20c00000000000000000000016c6514b53947fdc', // DONOTUSE — 18.4T supply, test/deprecated
])

// Stablecoin addresses used for fee payments (in tx.fee_token)
export const STABLECOIN_ADDRESSES = [
  '0x20c0000000000000000000000000000000000000', // pathUSD
  '0x20c000000000000000000000b9537d11c60e8b50', // USDC.e
]

const ERC20_ABI = [
  { name: 'symbol',   type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'name',     type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }],  stateMutability: 'view' },
] as const

export async function getTokenInfo(address: string): Promise<TokenInfo | null> {
  const lower = address.toLowerCase()
  const known = KNOWN_TOKENS[lower]
  if (known) return known

  const cacheKey = `token:meta:${lower}`
  const cached = await getCached<TokenInfo>(cacheKey)
  if (cached) return cached

  try {
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'name' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' }),
    ])
    const info: TokenInfo = { address: lower, symbol: symbol as string, name: name as string, decimals: decimals as number }
    await setCached(cacheKey, info, 86400) // 24h — token metadata is stable
    return info
  } catch {
    return null
  }
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const FIXED2   = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10 ** decimals
  const float = Number(raw) / divisor
  if (float >= 1_000_000) return COMPACT.format(float)
  return FIXED2.format(float)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/tokens.test.ts
# Expected: PASS, 7 tests
```

- [ ] **Step 5: Update signatures.ts to use STABLECOIN_ADDRESSES**

No code change needed — `STABLECOIN_ADDRESSES` is imported directly by analytics functions in the next task.

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/tokens.ts __tests__/lib/tokens.test.ts
git commit -m "feat: token registry with known Tempo tokens and amount formatter"
```

---

## Task 9: Stablecoin + DEX + NFT Materialized Views

**Files:**
- Modify: `scripts/setup-clickhouse-views.sql`

Add three new MVs. These are appended to the existing setup script — safe to re-run on a new DB since all use `IF NOT EXISTS`.

**Critical data notes confirmed from live chain:**
- Transfer event `data` field is `'0x' + 64 hex chars`. Amount is in the last 16 chars (last 8 bytes). Formula: `reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))`.
- `substring(data, 51, 16)` = chars 51-66 of the string = the last 16 hex chars of the 64-char uint256 payload. Safe for amounts < $18.4T.
- ERC-721 vs ERC-20 distinction: `topic3 IS NOT NULL` = NFT (tokenId is indexed); `topic3 IS NULL` = fungible.
- `DONOTUSE` (`0x20c000...16c6`) is excluded from all stablecoin MVs.

- [ ] **Step 1: Append new MVs to setup-clickhouse-views.sql**

Append to the end of `scripts/setup-clickhouse-views.sql`:

```sql
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

INSERT INTO tidx_4217.mv_dex_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;

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

INSERT INTO tidx_4217.mv_nft_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
GROUP BY toDate(block_timestamp), address;
```

- [ ] **Step 2: Run the new MVs**

```bash
cd ~/tidx
docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 \
  < scripts/setup-clickhouse-views.sql
# Expected: no errors (IF NOT EXISTS means the first 4 MVs skip silently)
```

- [ ] **Step 3: Verify new MVs**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT 'stablecoin' as tbl, count(), sum(transfers) as xfers FROM tidx_4217.mv_stablecoin_daily
  UNION ALL
  SELECT 'dex', count(), sum(swap_count) FROM tidx_4217.mv_dex_daily
  UNION ALL
  SELECT 'nft', count(), sum(transfers) FROM tidx_4217.mv_nft_daily
"
# Expected:
#   stablecoin  ~160 rows  ~3.9M total transfers
#   dex         ~2000 rows ~55K total swaps
#   nft         ~2000 rows ~100K total transfers
```

- [ ] **Step 4: Spot-check stablecoin amounts against RPC supply**

```bash
# Total pathUSD volume should be plausible vs 3.94M current supply
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT
    token,
    sum(volume_u6) / 1e6 as total_volume_usd,
    sum(transfers) as total_transfers
  FROM tidx_4217.mv_stablecoin_daily GROUP BY token
"
# Expected:
#   pathUSD:  ~34.3M total volume, ~2.75M transfers
#   USDC.e:   ~21.5M total volume, ~1.1M transfers
# Cross-check: volume >> supply is normal (tokens circulate many times over)
```

- [ ] **Step 5: Commit**

```bash
cd ~/tidx
git add scripts/setup-clickhouse-views.sql
git commit -m "feat: add stablecoin volume, DEX activity, and NFT materialized views"
```

---

## Task 10: Stablecoin, DEX, and NFT Analytics

**Files:**
- Modify: `explorer/src/lib/analytics.ts`
- Create: `explorer/src/components/charts/StablecoinVolumeChart.tsx`
- Create: `explorer/src/components/charts/DexActivityChart.tsx`
- Modify: `explorer/src/app/analytics/page.tsx`

- [ ] **Step 1: Add analytics query functions to `analytics.ts`**

Add to `explorer/src/lib/analytics.ts`:

```typescript
import { STABLECOIN_ADDRESSES } from './tokens'

// ─── Stablecoin ──────────────────────────────────────────────────
export interface StablecoinDailyStat {
  day: string
  pathUSD_volume: number   // USD (6-decimal normalized)
  usdc_e_volume: number
  pathUSD_transfers: number
  usdc_e_transfers: number
}

export async function getStablecoinDailyVolume(days = 30): Promise<StablecoinDailyStat[]> {
  const key = `analytics:stablecoins:${days}`
  const cached = await getCached<StablecoinDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; token: string; volume_u6: string; transfers: string
  }>(`
    SELECT day, token, sum(volume_u6) AS volume_u6, sum(transfers) AS transfers
    FROM mv_stablecoin_daily
    WHERE day >= today() - ${days}
    GROUP BY day, token
    ORDER BY day ASC, token ASC
  `)

  const byDay = new Map<string, StablecoinDailyStat>()
  for (const r of rows) {
    const day = String(r.day).slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, { day, pathUSD_volume: 0, usdc_e_volume: 0, pathUSD_transfers: 0, usdc_e_transfers: 0 })
    const stat = byDay.get(day)!
    if (r.token === STABLECOIN_ADDRESSES[0]) {
      stat.pathUSD_volume = Number(r.volume_u6) / 1e6
      stat.pathUSD_transfers = Number(r.transfers)
    } else {
      stat.usdc_e_volume = Number(r.volume_u6) / 1e6
      stat.usdc_e_transfers = Number(r.transfers)
    }
  }

  const result = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  await setCached(key, result, 900)
  return result
}

// ─── DEX ─────────────────────────────────────────────────────────
export interface DexDailyStat {
  day: string
  total_swaps: number
}

export async function getDexDailyActivity(days = 30): Promise<DexDailyStat[]> {
  const key = `analytics:dex:${days}`
  const cached = await getCached<DexDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ day: string; total_swaps: string }>(`
    SELECT day, sum(swap_count) AS total_swaps
    FROM mv_dex_daily
    WHERE day >= today() - ${days}
    GROUP BY day ORDER BY day ASC
  `)

  const result = rows.map(r => ({ day: String(r.day).slice(0, 10), total_swaps: Number(r.total_swaps) }))
  await setCached(key, result, 900)
  return result
}

export interface TopDexPair {
  pair: string
  total_swaps: number
}

export async function getTopDexPairs(limit = 10): Promise<TopDexPair[]> {
  const key = `analytics:dex:pairs:${limit}`
  const cached = await getCached<TopDexPair[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ pair: string; total_swaps: string }>(`
    SELECT pair, sum(swap_count) AS total_swaps
    FROM mv_dex_daily
    GROUP BY pair ORDER BY total_swaps DESC LIMIT ${limit}
  `)

  const result = rows.map(r => ({ pair: r.pair, total_swaps: Number(r.total_swaps) }))
  await setCached(key, result, 3600)
  return result
}

// ─── NFT ─────────────────────────────────────────────────────────
export interface TopNFTCollection {
  collection: string
  total_transfers: number
  days_active: number
}

export async function getTopNFTCollections(limit = 10): Promise<TopNFTCollection[]> {
  const key = `analytics:nft:top:${limit}`
  const cached = await getCached<TopNFTCollection[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    collection: string; total_transfers: string; days_active: string
  }>(`
    SELECT
      collection,
      sum(transfers)     AS total_transfers,
      uniq(day)          AS days_active
    FROM mv_nft_daily
    GROUP BY collection
    ORDER BY total_transfers DESC
    LIMIT ${limit}
  `)

  const result = rows.map(r => ({
    collection: r.collection,
    total_transfers: Number(r.total_transfers),
    days_active: Number(r.days_active),
  }))
  await setCached(key, result, 3600)
  return result
}

export interface NftDailyStat {
  day: string
  transfers: number
  active_collections: number
}

export async function getNFTDailyActivity(days = 30): Promise<NftDailyStat[]> {
  const key = `analytics:nft:daily:${days}`
  const cached = await getCached<NftDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; transfers: string; active_collections: string
  }>(`
    SELECT day, sum(transfers) AS transfers, uniq(collection) AS active_collections
    FROM mv_nft_daily
    WHERE day >= today() - ${days}
    GROUP BY day ORDER BY day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    transfers: Number(r.transfers),
    active_collections: Number(r.active_collections),
  }))
  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 2: Create `StablecoinVolumeChart.tsx`**

```typescript
// explorer/src/components/charts/StablecoinVolumeChart.tsx
'use client'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { StablecoinDailyStat } from '@/lib/analytics'

const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

export function StablecoinVolumeChart({ data }: { data: StablecoinDailyStat[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => v.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => fmtUSD.format(v)}
          width={64}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number) => [fmtUSD.format(v), '']}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Line type="monotone" dataKey="pathUSD_volume" name="pathUSD" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="usdc_e_volume" name="USDC.e" stroke="#0057FF" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: Create `DexActivityChart.tsx`**

```typescript
// explorer/src/components/charts/DexActivityChart.tsx
'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { DexDailyStat } from '@/lib/analytics'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function DexActivityChart({ data }: { data: DexDailyStat[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => v.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={v => fmt.format(v)} width={40} />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff' }}
          formatter={(v: number) => [v.toLocaleString(), 'swaps']}
        />
        <Bar dataKey="total_swaps" name="Swaps" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 4: Update analytics/page.tsx**

Add to imports:

```typescript
import {
  getStablecoinDailyVolume, getDexDailyActivity, getTopDexPairs,
  getTopNFTCollections, getNFTDailyActivity,
} from '@/lib/analytics'
import { StablecoinVolumeChart } from '@/components/charts/StablecoinVolumeChart'
import { DexActivityChart } from '@/components/charts/DexActivityChart'
```

Add to `Promise.all` in `AnalyticsPage`:

```typescript
const [
  daily, categorized, sigTypes, summary, inscriptionTotals,
  stablecoins, dexDaily, topPairs, topNFTs, nftDaily,
] = await Promise.all([
  getDailyStats(30),
  getDailyStatsCategorized(30),
  getSignatureTypeStats(),
  getNetworkSummary(),
  getInscriptionTotals(),
  getStablecoinDailyVolume(30),
  getDexDailyActivity(30),
  getTopDexPairs(5),
  getTopNFTCollections(8),
  getNFTDailyActivity(30),
])
```

Add stablecoin section after the inscription chart:

```tsx
{/* Stablecoin transfer volume */}
<div className="mb-6">
  <ChartCard title="Stablecoin Transfer Volume — pathUSD & USDC.e daily">
    <p className="text-tempo-muted text-xs mb-3">
      pathUSD (supply: ~$3.94M) and USDC.e (supply: ~$2.54M) are the primary fee-paying
      stablecoins. High velocity: total on-chain volume far exceeds supply.
    </p>
    <StablecoinVolumeChart data={stablecoins} />
  </ChartCard>
</div>

{/* DEX + NFT side by side */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
  <ChartCard title="DEX Activity — daily swaps (Uniswap V2-compatible)">
    <p className="text-tempo-muted text-xs mb-3">
      Community-deployed V2 AMMs. Top pair: TIMECOIN/USDC.e.
      USD volume tracking requires per-pair token mapping (coming soon).
    </p>
    <DexActivityChart data={dexDaily} />
    {topPairs.length > 0 && (
      <div className="mt-4 space-y-1">
        {topPairs.map(p => (
          <div key={p.pair} className="flex justify-between text-xs">
            <a href={`/address/${p.pair}`} className="font-mono text-tempo-blue hover:underline">
              {p.pair.slice(0, 10)}…{p.pair.slice(-6)}
            </a>
            <span className="text-tempo-muted">{p.total_swaps.toLocaleString()} swaps</span>
          </div>
        ))}
      </div>
    )}
  </ChartCard>

  <ChartCard title="NFT Activity — top ERC-721 collections">
    <div className="space-y-2">
      {topNFTs.map(c => (
        <div key={c.collection} className="flex items-center justify-between text-xs">
          <a href={`/address/${c.collection}`} className="font-mono text-tempo-blue hover:underline">
            {c.collection.slice(0, 10)}…{c.collection.slice(-6)}
          </a>
          <div className="text-right">
            <span className="text-white">{c.total_transfers.toLocaleString()}</span>
            <span className="text-tempo-muted ml-2">{c.days_active}d active</span>
          </div>
        </div>
      ))}
    </div>
  </ChartCard>
</div>
```

- [ ] **Step 5: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 6: Rebuild and deploy**

```bash
cd ~/tidx && docker compose build explorer && docker compose up -d explorer
sleep 5 && curl -s -o /dev/null -w "%{http_code}" http://localhost/analytics
# Expected: 200
```

- [ ] **Step 7: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/analytics.ts src/components/charts/StablecoinVolumeChart.tsx \
        src/components/charts/DexActivityChart.tsx src/app/analytics/page.tsx
git commit -m "feat: stablecoin volume, DEX activity, and NFT analytics on analytics page"
```

---

## Task 11: Data Validation Harness

**Files:**
- Create: `scripts/validate-data.sh`
- Create: `explorer/__tests__/lib/tokens.decode.test.ts`

The official explorer (`explorer.tempo.xyz`) is a client-side SPA (TanStack Start) with no REST API. Automated validation compares against known reference values derived from direct RPC calls on 2026-04-07. Manual spot-checks against the official explorer are documented below.

**Reference values (from live chain, 2026-04-07):**

| Metric | Expected | Tolerance |
|---|---|---|
| Total txs (ClickHouse) | ≥ 15,700,000 | — |
| pathUSD total supply | ~3,940,000 | ±5% |
| USDC.e total supply | ~2,540,000 | ±5% |
| Total all-time swaps | ≥ 55,000 | — |
| pathUSD all-time volume | ≥ 34,000,000 | — |
| PG txs ≈ CH txs (within 0.1%) | both ≥ 15.7M | lag OK |

- [ ] **Step 1: Write amount-decoding unit tests**

```typescript
// explorer/__tests__/lib/tokens.decode.test.ts
// Tests for the uint256 decoding formula used in ClickHouse and JS

// The ClickHouse formula: reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))
// JS equivalent for verification:
function decodeUint256Lo(hexData: string): bigint {
  // hexData = '0x' + 64 hex chars (32-byte big-endian uint256)
  // We take the last 16 hex chars (8 bytes = UInt64) — safe for amounts < $18.4T
  const lo = hexData.slice(-16) // last 16 hex chars
  return BigInt('0x' + lo)
}

test('decodes zero', () => {
  expect(decodeUint256Lo('0x' + '0'.repeat(64))).toBe(0n)
})

test('decodes 1 USDC (1_000_000 raw = 0x...0F4240)', () => {
  const data = '0x' + '0'.repeat(58) + '0f4240'  // 1_000_000 in last 6 hex = 3 bytes
  expect(decodeUint256Lo(data)).toBe(1_000_000n)
})

test('decodes 0.031381 USDC.e (31_381 = 0x7a95)', () => {
  const data = '0x' + '0'.repeat(60) + '7a95'
  expect(decodeUint256Lo(data)).toBe(31_381n)
})

test('decodes 1000 raw (0x3e8)', () => {
  const data = '0x' + '0'.repeat(61) + '3e8'
  expect(decodeUint256Lo(data)).toBe(1_000n)
})

test('consistent with known pathUSD data field', () => {
  // From live chain: 0x0000...0000000000007a95 → 31381 raw → $0.031381
  const real = '0x0000000000000000000000000000000000000000000000000000000000007a95'
  expect(decodeUint256Lo(real)).toBe(0x7a95n) // 31381
})
```

- [ ] **Step 2: Run decode tests**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/tokens.decode.test.ts
# Expected: PASS, 5 tests
```

- [ ] **Step 3: Create the validation shell script**

```bash
#!/usr/bin/env bash
# scripts/validate-data.sh
# Run: bash scripts/validate-data.sh
# Validates on-chain data integrity against known reference values.
# Reference values established 2026-04-07 from direct RPC + ClickHouse queries.

set -euo pipefail
ERRORS=0

ch() { docker exec tidx-clickhouse-1 clickhouse-client --query "$1"; }
fail() { echo "  FAIL: $1"; ERRORS=$((ERRORS+1)); }
pass() { echo "  PASS: $1"; }

echo "=== Tempo Explorer Data Validation ==="
echo ""

# 1. Total transaction count
echo "1. Transaction count..."
TX_COUNT=$(ch "SELECT count() FROM tidx_4217.txs")
if [ "$TX_COUNT" -ge 15700000 ]; then
  pass "Total txs: $TX_COUNT (≥ 15,700,000)"
else
  fail "Total txs too low: $TX_COUNT (expected ≥ 15,700,000)"
fi

# 2. PG vs CH consistency
echo "2. PostgreSQL ↔ ClickHouse consistency..."
PG_TX=$(ch "SELECT blocks_count FROM system.tables WHERE database='tidx_4217' LIMIT 1" 2>/dev/null || echo "0")
# Use tidx status API instead
TIDX_STATUS=$(curl -s http://localhost:8080/status)
PG_TX=$(echo "$TIDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['chains'][0]['postgres']['txs_count'])")
CH_TX=$(echo "$TIDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['chains'][0]['clickhouse']['txs_count'])")
DIFF=$(python3 -c "print(abs($CH_TX - $PG_TX))")
PCT=$(python3 -c "print(f'{abs($CH_TX - $PG_TX)/$PG_TX*100:.4f}')")
if python3 -c "exit(0 if abs($CH_TX - $PG_TX) / $PG_TX < 0.001 else 1)"; then
  pass "PG ($PG_TX) ↔ CH ($CH_TX) within 0.1% (diff: $DIFF = $PCT%)"
else
  fail "PG ($PG_TX) ↔ CH ($CH_TX) diverge by $PCT% — re-run tidx or check for gaps"
fi

# 3. Daily stats MV completeness — no missing days since mainnet
echo "3. Daily stats completeness..."
DAYS_IN_MV=$(ch "SELECT uniq(day) FROM tidx_4217.mv_daily_stats")
# Mainnet launch 2026-03-18; expect at least 20 days of data
if [ "$DAYS_IN_MV" -ge 20 ]; then
  pass "Daily stats MV has $DAYS_IN_MV days"
else
  fail "Daily stats MV only has $DAYS_IN_MV days — may need backfill"
fi

# 4. Stablecoin total volume sanity (pathUSD)
echo "4. pathUSD all-time transfer volume..."
PATHUSD_VOL=$(ch "SELECT round(sum(volume_u6)/1e6) FROM tidx_4217.mv_stablecoin_daily WHERE token='0x20c0000000000000000000000000000000000000'")
if python3 -c "exit(0 if float('$PATHUSD_VOL') >= 34000000 else 1)"; then
  pass "pathUSD all-time volume: \$$PATHUSD_VOL (≥ \$34M)"
else
  fail "pathUSD volume too low: \$$PATHUSD_VOL — check amount decoding formula"
fi

# 5. USDC.e total volume sanity
echo "5. USDC.e all-time transfer volume..."
USDCE_VOL=$(ch "SELECT round(sum(volume_u6)/1e6) FROM tidx_4217.mv_stablecoin_daily WHERE token='0x20c000000000000000000000b9537d11c60e8b50'")
if python3 -c "exit(0 if float('$USDCE_VOL') >= 21000000 else 1)"; then
  pass "USDC.e all-time volume: \$$USDCE_VOL (≥ \$21M)"
else
  fail "USDC.e volume too low: \$$USDCE_VOL — check amount decoding or MV backfill"
fi

# 6. DEX swap count sanity
echo "6. DEX all-time swap count..."
SWAPS=$(ch "SELECT sum(swap_count) FROM tidx_4217.mv_dex_daily")
if [ "$SWAPS" -ge 55000 ]; then
  pass "Total DEX swaps: $SWAPS (≥ 55,000)"
else
  fail "DEX swaps too low: $SWAPS — check mv_dex_daily backfill"
fi

# 7. NFT transfer count sanity
echo "7. NFT all-time transfer count..."
NFTS=$(ch "SELECT sum(transfers) FROM tidx_4217.mv_nft_daily")
if [ "$NFTS" -ge 100000 ]; then
  pass "Total NFT transfers: $NFTS (≥ 100,000)"
else
  fail "NFT transfers too low: $NFTS — check mv_nft_daily backfill"
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "✓ All checks passed"
else
  echo "✗ $ERRORS check(s) failed"
  exit 1
fi
```

- [ ] **Step 4: Run the validation script**

```bash
cd ~/tidx && bash scripts/validate-data.sh
# Expected: all checks pass
```

- [ ] **Step 5: Document manual cross-check against explorer.tempo.xyz**

```
Manual verification steps (explorer.tempo.xyz has no REST API):

1. Open https://explorer.tempo.xyz/
   - Header shows current block number — should be within seconds of our head_num
     (check: curl -s http://localhost:8080/status | python3 -c "import json,sys; print(json.load(sys.stdin)['chains'][0]['head_num'])")

2. Open https://explorer.tempo.xyz/address/0x20c000000000000000000000b9537d11c60e8b50
   - Should show token name "USDC.e", symbol "USDC.e", decimals 6
   - Our KNOWN_TOKENS registry matches these

3. Open https://explorer.tempo.xyz/address/0x20c0000000000000000000000000000000000000
   - Should show token name "pathUSD", decimals 6

4. Pick any tx hash from our explorer (http://localhost/)
   - Search it on explorer.tempo.xyz — all fields should match
   - Specifically check: from, to, status, block number

These checks should be run after any major data layer change.
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx
chmod +x scripts/validate-data.sh
git add scripts/validate-data.sh
cd explorer
git add __tests__/lib/tokens.decode.test.ts
git commit -m "feat: data validation harness with known reference values and manual cross-check guide"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Static selector + event registry (`signatures.ts`, Task 1)
- ✅ ClickHouse materialized views (Task 2 + Task 9)
- ✅ Migrate analytics to MVs (Task 3)
- ✅ Transaction categorization (Task 4)
- ✅ TIP-20 inscription analytics (Task 5)
- ✅ WhatsABI tx detail decoding (Task 6)
- ✅ Trace investigation (Task 7)
- ✅ Token registry with DONOTUSE exclusion (Task 8)
- ✅ Stablecoin daily transfer volume (Task 9 MVs + Task 10)
- ✅ DEX activity analytics (Task 9 MVs + Task 10)
- ✅ NFT (ERC-721) analytics (Task 9 MVs + Task 10)
- ✅ Data validation against known reference values (Task 11)
- ✅ Manual cross-check guide for explorer.tempo.xyz (Task 11 Step 5)

**Known data facts baked into plan:**
- pathUSD = `0x20c0...000` — 6 decimals, $3.94M supply
- USDC.e = `0x20c0...b953` — 6 decimals, $2.54M supply
- DONOTUSE = `0x20c0...16c6` — excluded (18.4T supply, deprecated test token)
- DEX = Uniswap V2-compatible forks (community, not official Tempo protocol)
- NFT = ERC-721 (topic3 NOT NULL), minimal ERC-1155 activity
- Amount decode = `reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))` — verified on live data
- ERC-721 vs ERC-20 = `topic3 IS NOT NULL` / `topic3 IS NULL` on Transfer events

**Type consistency check:**
- `StablecoinDailyStat` — defined in `analytics.ts`, used in `StablecoinVolumeChart` ✅
- `DexDailyStat`, `TopDexPair` — defined in `analytics.ts`, used in analytics page ✅
- `TopNFTCollection`, `NftDailyStat` — defined in `analytics.ts`, used in analytics page ✅
- `TokenInfo` — defined in `tokens.ts`, used in `getTokenInfo` return + `whatsabi.ts` (via `getTokenMetadata`) ✅
- `STABLECOIN_ADDRESSES` imported from `tokens.ts` into `analytics.ts` ✅

**Column name consistency (critical — verified against live schema):**
- `logs.log_idx` (not `log_index`) ✅
- `txs.idx` (not `tx_index`) ✅
- `blocks.timestamp` (not `block_timestamp`) ✅
- `logs.selector` = topic0 (32-byte hash, not 4-byte) ✅

**No placeholders found** — all steps contain complete code.

**Test count after all tasks:**
13 (existing) + 14 (signatures) + 6 (inscriptions) + 5 (whatsabi) + 7 (tokens) + 5 (decode) = **50 tests**
