# DEX Pool Explorer + NFT Minter Concentration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Protocol DEX per-pool recent-trades explorer to `/dex` and an NFT minter concentration section to `/nfts`.

**Architecture:** SQL materialized view tracks Protocol DEX swaps per pool/token per day. Two new analytics functions query it plus raw logs for on-demand trades. A client component handles toggle/sort/accordion state; an API route serves on-demand trade data. NFT minter functions query logs directly with no new MV needed.

**Tech Stack:** Next.js 15 App Router, TypeScript, ClickHouse HTTP API, Jest (jsdom), Tailwind CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `sql/clickhouse/views/protocol-dex.sql` | Modify | Append `mv_protocol_dex_pool_daily` table + MV |
| `sql/clickhouse/backfills/protocol-dex.sql` | Modify | Append backfill INSERT for pool daily data |
| `src/lib/analytics.ts` | Modify | Add 4 new exported functions + 4 new types |
| `src/components/ProtocolDexPoolExplorer.tsx` | Create | Client component: toggle, sort, accordion, trade fetching |
| `src/app/api/protocol-dex/pool-trades/route.ts` | Create | API route serving on-demand pool trades |
| `src/app/dex/page.tsx` | Modify | Fetch pool list, render `<ProtocolDexPoolExplorer>` section |
| `src/app/nfts/page.tsx` | Modify | Fetch minter data, render concentration stat + table |
| `__tests__/lib/analytics.protocol-dex-pools.test.ts` | Create | Unit tests for pool functions |
| `__tests__/lib/analytics.nft-minters.test.ts` | Create | Unit tests for minter functions |

All paths are relative to the worktree root. The worktree will be at:
`.worktrees/dex-nft-analytics/` inside the repo.

---

## Task 1: Create Worktree and Branch

**Files:** none (git operations only)

- [ ] **Step 1: Create branch and worktree from master**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics
git worktree add .worktrees/dex-nft-analytics -b feature/dex-pool-explorer-nft-concentration
```

Expected: output like `Preparing worktree (new branch 'feature/dex-pool-explorer-nft-concentration')`

- [ ] **Step 2: Copy .env.local into the worktree (not tracked by git)**

```bash
cp /home/evan/takopi-adventures/projects/tempo-analytics/.env.local \
   /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics/.env.local
```

- [ ] **Step 3: Install dependencies in worktree**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm install
```

Expected: clean install, no errors

- [ ] **Step 4: Confirm tests pass on the clean branch**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm test -- --testPathPattern='__tests__/lib' --passWithNoTests 2>&1 | tail -5
```

Expected: all existing tests pass

---

## Task 2: ClickHouse SQL — Protocol DEX Pool Daily View

**Files:**
- Modify: `sql/clickhouse/views/protocol-dex.sql`
- Modify: `sql/clickhouse/backfills/protocol-dex.sql`

Context: `protocol-dex.sql` currently has one table (`mv_protocol_dex_daily`) and its MV. We append a second pair below it.

- [ ] **Step 1: Append pool daily table + MV to views file**

Open `sql/clickhouse/views/protocol-dex.sql` and append at the bottom:

```sql

-- ─────────────────────────────────────────────
-- Protocol DEX per-pool daily stats
-- Decodes: pool_id from topic1 (lo-64 bits), token from topic3 (stripped to 20-byte)
-- Same swap event as mv_protocol_dex_daily
-- ─────────────────────────────────────────────
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

- [ ] **Step 2: Append backfill INSERT to backfills file**

Open `sql/clickhouse/backfills/protocol-dex.sql` and append at the bottom:

```sql

-- Backfill for mv_protocol_dex_pool_daily
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

- [ ] **Step 3: Apply to running ClickHouse**

```bash
curl -s 'http://localhost:8123/' \
  --data-urlencode "query=$(cat sql/clickhouse/views/protocol-dex.sql | grep -A100 'mv_protocol_dex_pool_daily')" \
  --get --data-urlencode "database=tidx_4217"
```

Simpler: apply the full views file (idempotent due to `IF NOT EXISTS`):

```bash
CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh 2>&1 | tail -10
```

Then run the backfill:

```bash
curl -s 'http://localhost:8123/?database=tidx_4217' \
  --data "INSERT INTO tidx_4217.mv_protocol_dex_pool_daily
SELECT
  toDate(block_timestamp),
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16)))),
  '0x' || lower(substring(topic3, 27)),
  count(),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token"
```

- [ ] **Step 4: Verify the view has data**

```bash
curl -s 'http://localhost:8123/?database=tidx_4217&query=SELECT+token,sum(swaps)+as+s,sum(volume_raw)+as+v+FROM+mv_protocol_dex_pool_daily+GROUP+BY+token+ORDER+BY+s+DESC+LIMIT+5'
```

Expected: rows with token addresses, swap counts, volume numbers. Top token should have thousands of swaps.

- [ ] **Step 5: Commit**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
git add sql/clickhouse/views/protocol-dex.sql sql/clickhouse/backfills/protocol-dex.sql
git commit -m "sql: add mv_protocol_dex_pool_daily view and backfill"
```

---

## Task 3: Analytics Functions — Protocol DEX Pools

**Files:**
- Modify: `src/lib/analytics.ts`
- Create: `__tests__/lib/analytics.protocol-dex-pools.test.ts`

Context: `analytics.ts` already imports `queryClickHouse`, `getCached`, `setCached`, `getTokenInfo`. No new imports needed. The existing `getProtocolDexDailyStats` at the bottom of the file is a good reference for structure.

Note: `padAddr` lives in `defi.ts` which imports from `analytics.ts`, creating a circular dep if we import it back. Instead we inline the padding as a SQL string expression.

- [ ] **Step 1: Write the failing tests first**

Create `__tests__/lib/analytics.protocol-dex-pools.test.ts`:

```typescript
jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/tokens', () => ({
  getTokenInfo: jest.fn(),
  getTokenSupply: jest.fn(),
  KNOWN_TOKENS: {},
  EXCLUDED_TOKENS: new Set(),
  STABLECOIN_ADDRESSES: [],
}))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
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
import { getTokenInfo } from '@/lib/tokens'
import { getProtocolDexPools, getProtocolDexPoolTrades } from '@/lib/analytics'

const mockQuery = queryClickHouse as jest.Mock
const mockGetTokenInfo = getTokenInfo as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('getProtocolDexPools marks known tokens as whitelisted', async () => {
  mockQuery.mockResolvedValueOnce([
    { pool_id: '7', token: '0x20c000000000000000000000b9537d11c60e8b50', swaps: '100', volume_raw: '500000000' },
    { pool_id: '3', token: '0xdeadbeef00000000000000000000000000000001', swaps: '50', volume_raw: '200000000' },
  ])
  mockGetTokenInfo
    .mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin', decimals: 6, address: '0x20c000000000000000000000b9537d11c60e8b50' })
    .mockResolvedValueOnce(null)

  const pools = await getProtocolDexPools(30)

  expect(pools).toHaveLength(2)
  expect(pools[0].whitelisted).toBe(true)
  expect(pools[0].symbol).toBe('USDC.e')
  expect(pools[0].volume_usd).toBeCloseTo(500)
  expect(pools[1].whitelisted).toBe(false)
  expect(pools[1].volume_usd).toBe(0)
})

test('getProtocolDexPools avg_trade is volume_usd / swaps_30d', async () => {
  mockQuery.mockResolvedValueOnce([
    { pool_id: '7', token: '0x20c000000000000000000000b9537d11c60e8b50', swaps: '10', volume_raw: '100000000' },
  ])
  mockGetTokenInfo.mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin', decimals: 6, address: '0x...' })

  const [pool] = await getProtocolDexPools(30)
  expect(pool.avg_trade).toBeCloseTo(10) // 100 USD / 10 swaps
})

test('getProtocolDexPools symbol falls back to shortened address for unknown tokens', async () => {
  mockQuery.mockResolvedValueOnce([
    { pool_id: '1', token: '0xabcdef1234567890abcdef1234567890abcdef12', swaps: '5', volume_raw: '0' },
  ])
  mockGetTokenInfo.mockResolvedValueOnce(null)

  const [pool] = await getProtocolDexPools(30)
  expect(pool.symbol).toMatch(/^0x/)
  expect(pool.symbol).toContain('…')
})

test('getProtocolDexPoolTrades decodes taker, amount, and direction from log data', async () => {
  const paddedTaker = '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12'
  // uint256 = 32 bytes = 64 hex chars. Amount 10_000_000 = 0x989680, direction = 1
  const amountUint256    = '0000000000000000000000000000000000000000000000000000000000989680'
  const directionUint256 = '0000000000000000000000000000000000000000000000000000000000000001'
  const data = '0x' + amountUint256 + directionUint256

  mockQuery.mockResolvedValueOnce([
    { block_timestamp: '2026-04-08 12:00:00', topic2: paddedTaker, data },
  ])
  mockGetTokenInfo.mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin', decimals: 6, address: '0x...' })

  const trades = await getProtocolDexPoolTrades('0x20c000000000000000000000b9537d11c60e8b50')

  expect(trades).toHaveLength(1)
  expect(trades[0].taker).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  expect(trades[0].amount_raw).toBe(10_000_000)
  expect(trades[0].amount_usd).toBeCloseTo(10)
  expect(trades[0].direction).toBe(1)
})

test('getProtocolDexPoolTrades sets amount_usd null for unknown tokens', async () => {
  const paddedTaker = '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12'
  const data = '0x' + '0'.repeat(128)

  mockQuery.mockResolvedValueOnce([
    { block_timestamp: '2026-04-08 12:00:00', topic2: paddedTaker, data },
  ])
  mockGetTokenInfo.mockResolvedValueOnce(null) // token unknown

  const trades = await getProtocolDexPoolTrades('0xdeadbeef00000000000000000000000000000001')
  expect(trades[0].amount_usd).toBeNull()
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm test -- --testPathPattern='analytics.protocol-dex-pools' 2>&1 | tail -15
```

Expected: FAIL — `getProtocolDexPools is not a function` (or similar)

- [ ] **Step 3: Add types and functions to analytics.ts**

Append to `src/lib/analytics.ts` after the last existing export (after `getProtocolDexDailyStats`):

```typescript
// ─── Protocol DEX Pool Explorer ──────────────────────────────────

export interface ProtocolDexPool {
  poolId:      number
  token:       string   // 20-byte lowercase address
  symbol:      string   // resolved symbol or shortened address
  swaps_30d:   number
  volume_usd:  number   // volume_raw / 1e6 when whitelisted, else 0
  avg_trade:   number   // volume_usd / swaps_30d
  whitelisted: boolean  // true when getTokenInfo returns non-null
}

export interface ProtocolDexTrade {
  timestamp:  string        // ISO datetime string
  taker:      string        // 20-byte lowercase address
  amount_raw: number        // raw amount (lo-64 bits of first data word)
  amount_usd: number | null // amount_raw / 1e6 when whitelisted, else null
  direction:  0 | 1         // lo-64 bits of second data word (0=buy pathUSD, 1=sell)
}

export async function getProtocolDexPools(days = 30): Promise<ProtocolDexPool[]> {
  const key = `analytics:protocol_dex:pools:${days}`
  const cached = await getCached<ProtocolDexPool[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    pool_id: string; token: string; swaps: string; volume_raw: string
  }>(`
    SELECT pool_id, token, sum(swaps) AS swaps, sum(volume_raw) AS volume_raw
    FROM mv_protocol_dex_pool_daily
    WHERE day >= today() - ${days}
    GROUP BY pool_id, token
    ORDER BY volume_raw DESC
  `)

  const result: ProtocolDexPool[] = await Promise.all(rows.map(async r => {
    const info = await getTokenInfo(r.token)
    const whitelisted = info !== null
    const swaps_30d = Number(r.swaps)
    const volume_usd = whitelisted ? Number(r.volume_raw) / 1e6 : 0
    return {
      poolId:    Number(r.pool_id),
      token:     r.token,
      symbol:    info?.symbol ?? `${r.token.slice(0, 6)}…${r.token.slice(-4)}`,
      swaps_30d,
      volume_usd,
      avg_trade: swaps_30d > 0 ? volume_usd / swaps_30d : 0,
      whitelisted,
    }
  }))

  await setCached(key, result, 900)
  return result
}

const PROTOCOL_DEX_ADDR = '0xdec0000000000000000000000000000000000000'
const PROTOCOL_DEX_SWAP = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'

export async function getProtocolDexPoolTrades(token: string, limit = 50): Promise<ProtocolDexTrade[]> {
  const lower = token.toLowerCase()
  // Pad token to 32-byte topic format (inline to avoid circular dep with defi.ts)
  const paddedToken = '0x000000000000000000000000' + lower.slice(2)
  const info = await getTokenInfo(lower)
  const whitelisted = info !== null

  const rows = await queryClickHouse<{
    block_timestamp: string; topic2: string; data: string
  }>(`
    SELECT block_timestamp, topic2, data
    FROM logs
    WHERE address  = '${PROTOCOL_DEX_ADDR}'
      AND selector = '${PROTOCOL_DEX_SWAP}'
      AND topic3   = '${paddedToken}'
    ORDER BY block_timestamp DESC
    LIMIT ${limit}
  `)

  return rows.map(r => {
    // data = "0x" + uint256_0 (64 hex) + uint256_1 (64 hex)
    // lo-64 bits of uint256_0: chars 50-65 (0-indexed)
    const amount_raw = parseInt(r.data.slice(50, 66), 16)
    // lo-64 bits of uint256_1: chars 114-129 (0-indexed)
    const direction = parseInt(r.data.slice(114, 130), 16) as 0 | 1
    // topic2: "0x" + 24 zero-chars + 40-char address
    const taker = '0x' + r.topic2.slice(26)
    return {
      timestamp:  r.block_timestamp,
      taker,
      amount_raw,
      amount_usd: whitelisted ? amount_raw / 1e6 : null,
      direction,
    }
  })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm test -- --testPathPattern='analytics.protocol-dex-pools' 2>&1 | tail -10
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts __tests__/lib/analytics.protocol-dex-pools.test.ts
git commit -m "feat: add getProtocolDexPools and getProtocolDexPoolTrades analytics functions"
```

---

## Task 4: Analytics Functions — NFT Minter Concentration

**Files:**
- Modify: `src/lib/analytics.ts`
- Create: `__tests__/lib/analytics.nft-minters.test.ts`

Context: No new imports needed. NFT_MINT_FILTERS is a local string constant to avoid repeating the WHERE clause.

- [ ] **Step 1: Write failing tests first**

Create `__tests__/lib/analytics.nft-minters.test.ts`:

```typescript
jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/tokens', () => ({
  getTokenInfo: jest.fn(),
  getTokenSupply: jest.fn(),
  KNOWN_TOKENS: {},
  EXCLUDED_TOKENS: new Set(),
  STABLECOIN_ADDRESSES: [],
}))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
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
import { getNFTMinterConcentration, getTopNFTMinters } from '@/lib/analytics'

const mockQuery = queryClickHouse as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('getNFTMinterConcentration computes top10 share percentage', async () => {
  mockQuery
    .mockResolvedValueOnce([{ total_mints: '100', unique_minters: '25' }])
    .mockResolvedValueOnce([
      { mints: '30' }, { mints: '15' }, { mints: '10' }, { mints: '8' }, { mints: '5' },
      { mints: '4' }, { mints: '3' }, { mints: '2' }, { mints: '2' }, { mints: '1' },
    ])

  const result = await getNFTMinterConcentration()

  expect(result.total_mints).toBe(100)
  expect(result.unique_minters).toBe(25)
  expect(result.top10_share_pct).toBe(80) // (30+15+10+8+5+4+3+2+2+1)/100 = 80%
})

test('getNFTMinterConcentration handles zero mints gracefully', async () => {
  mockQuery
    .mockResolvedValueOnce([{ total_mints: '0', unique_minters: '0' }])
    .mockResolvedValueOnce([])

  const result = await getNFTMinterConcentration()
  expect(result.top10_share_pct).toBe(0)
})

test('getTopNFTMinters returns ranked list with correct fields', async () => {
  mockQuery.mockResolvedValueOnce([
    { minter: '0xabc0000000000000000000000000000000000001', mints: '50', pct_total: '34.50', collections: '3' },
    { minter: '0xabc0000000000000000000000000000000000002', mints: '20', pct_total: '13.79', collections: '1' },
  ])

  const minters = await getTopNFTMinters(10)

  expect(minters).toHaveLength(2)
  expect(minters[0].rank).toBe(1)
  expect(minters[0].minter).toBe('0xabc0000000000000000000000000000000000001')
  expect(minters[0].mints).toBe(50)
  expect(minters[0].pct_total).toBeCloseTo(34.5)
  expect(minters[0].collections).toBe(3)
  expect(minters[1].rank).toBe(2)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm test -- --testPathPattern='analytics.nft-minters' 2>&1 | tail -10
```

Expected: FAIL — `getNFTMinterConcentration is not a function`

- [ ] **Step 3: Append NFT minter functions to analytics.ts**

Append to `src/lib/analytics.ts` after the Protocol DEX Pool Explorer block:

```typescript
// ─── NFT Minter Concentration ─────────────────────────────────────

export interface NFTMinterConcentration {
  total_mints:     number
  unique_minters:  number
  top10_share_pct: number  // percentage of all mints by top 10 addresses
}

export interface TopNFTMinter {
  rank:        number
  minter:      string  // 20-byte lowercase address
  mints:       number
  pct_total:   number  // rounded to 2dp
  collections: number  // unique collections minted from
}

// WHERE clause shared between both NFT minter queries
const NFT_MINT_FILTER = `
  selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic3 IS NOT NULL
  AND topic1 = '0x0000000000000000000000000000000000000000000000000000000000000000'
`

export async function getNFTMinterConcentration(): Promise<NFTMinterConcentration> {
  const key = 'analytics:nft:minter_concentration'
  const cached = await getCached<NFTMinterConcentration>(key)
  if (cached) return cached

  const [totalRows, top10Rows] = await Promise.all([
    queryClickHouse<{ total_mints: string; unique_minters: string }>(`
      SELECT count() AS total_mints, uniq(topic2) AS unique_minters
      FROM logs
      WHERE ${NFT_MINT_FILTER}
    `),
    queryClickHouse<{ mints: string }>(`
      SELECT count() AS mints
      FROM logs
      WHERE ${NFT_MINT_FILTER}
      GROUP BY topic2
      ORDER BY mints DESC
      LIMIT 10
    `),
  ])

  const total_mints    = Number(totalRows[0]?.total_mints    ?? 0)
  const unique_minters = Number(totalRows[0]?.unique_minters ?? 0)
  const top10_sum      = top10Rows.reduce((s, r) => s + Number(r.mints), 0)
  const top10_share_pct = total_mints > 0
    ? Math.round((top10_sum / total_mints) * 1000) / 10
    : 0

  const result: NFTMinterConcentration = { total_mints, unique_minters, top10_share_pct }
  await setCached(key, result, 900)
  return result
}

export async function getTopNFTMinters(limit = 50): Promise<TopNFTMinter[]> {
  const key = `analytics:nft:top_minters:${limit}`
  const cached = await getCached<TopNFTMinter[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    minter: string; mints: string; pct_total: string; collections: string
  }>(`
    SELECT
      '0x' || substring(topic2, 27)                          AS minter,
      count()                                                AS mints,
      round(count() * 100.0 / (
        SELECT count() FROM logs WHERE ${NFT_MINT_FILTER}
      ), 2)                                                  AS pct_total,
      uniq(address)                                          AS collections
    FROM logs
    WHERE ${NFT_MINT_FILTER}
    GROUP BY topic2
    ORDER BY mints DESC
    LIMIT ${limit}
  `)

  const result: TopNFTMinter[] = rows.map((r, i) => ({
    rank:        i + 1,
    minter:      r.minter,
    mints:       Number(r.mints),
    pct_total:   Number(r.pct_total),
    collections: Number(r.collections),
  }))

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm test -- --testPathPattern='analytics.nft-minters' 2>&1 | tail -10
```

Expected: PASS — 3 tests

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test -- --testPathPattern='__tests__/lib' 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics.ts __tests__/lib/analytics.nft-minters.test.ts
git commit -m "feat: add getNFTMinterConcentration and getTopNFTMinters analytics functions"
```

---

## Task 5: API Route — Protocol DEX Pool Trades

**Files:**
- Create: `src/app/api/protocol-dex/pool-trades/route.ts`

Context: This route serves on-demand trade data for the accordion in `ProtocolDexPoolExplorer`. It validates the `token` query param and calls `getProtocolDexPoolTrades`. No test needed — it's a thin wrapper over an already-tested function.

- [ ] **Step 1: Create the route**

Create `src/app/api/protocol-dex/pool-trades/route.ts`:

```typescript
import { NextRequest } from 'next/server'
import { getProtocolDexPoolTrades } from '@/lib/analytics'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    return Response.json({ error: 'invalid token address' }, { status: 400 })
  }

  const trades = await getProtocolDexPoolTrades(token.toLowerCase())
  return Response.json(trades)
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
git add src/app/api/protocol-dex/pool-trades/route.ts
git commit -m "feat: add /api/protocol-dex/pool-trades route"
```

---

## Task 6: Client Component — ProtocolDexPoolExplorer

**Files:**
- Create: `src/components/ProtocolDexPoolExplorer.tsx`

Context: This is a `'use client'` component. It receives the full pool list from the server component, handles filter/sort state client-side, and fetches trades via the API route when a row is expanded. Uses `Fragment` with a `key` prop for the accordion rows (not `<>` shorthand, which doesn't accept `key`).

- [ ] **Step 1: Create the component**

Create `src/components/ProtocolDexPoolExplorer.tsx`:

```typescript
'use client'
import { Fragment, useState, useCallback } from 'react'
import type { ProtocolDexPool, ProtocolDexTrade } from '@/lib/analytics'

type SortKey = 'volume' | 'swaps' | 'avg_trade'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function ProtocolDexPoolExplorer({ pools }: { pools: ProtocolDexPool[] }) {
  const [showKnownOnly, setShowKnownOnly]   = useState(false)
  const [sortBy, setSortBy]                 = useState<SortKey>('volume')
  const [expandedToken, setExpandedToken]   = useState<string | null>(null)
  const [trades, setTrades]                 = useState<ProtocolDexTrade[]>([])
  const [tradesLoading, setTradesLoading]   = useState(false)

  const filtered = pools
    .filter(p => !showKnownOnly || p.whitelisted)
    .sort((a, b) => {
      if (sortBy === 'volume')    return b.volume_usd  - a.volume_usd
      if (sortBy === 'swaps')     return b.swaps_30d   - a.swaps_30d
      return b.avg_trade - a.avg_trade
    })

  const togglePool = useCallback(async (token: string) => {
    if (expandedToken === token) {
      setExpandedToken(null)
      return
    }
    setExpandedToken(token)
    setTrades([])
    setTradesLoading(true)
    try {
      const res  = await fetch(`/api/protocol-dex/pool-trades?token=${token}`)
      const data = await res.json() as ProtocolDexTrade[]
      setTrades(data)
    } finally {
      setTradesLoading(false)
    }
  }, [expandedToken])

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      {/* Controls */}
      <div className="px-6 py-4 border-b border-tempo-border flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-tempo-muted text-xs">Filter:</span>
          <div className="flex rounded overflow-hidden border border-tempo-border text-xs">
            <button
              onClick={() => setShowKnownOnly(false)}
              className={`px-3 py-1 transition-colors ${!showKnownOnly ? 'bg-tempo-border text-white' : 'text-tempo-muted hover:text-white'}`}
            >
              All Pools
            </button>
            <button
              onClick={() => setShowKnownOnly(true)}
              className={`px-3 py-1 transition-colors ${showKnownOnly ? 'bg-tempo-border text-white' : 'text-tempo-muted hover:text-white'}`}
            >
              Known Tokens Only
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-tempo-muted text-xs">Sort:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            className="bg-tempo-card border border-tempo-border rounded px-2 py-1 text-xs text-white"
          >
            <option value="volume">Volume (30d)</option>
            <option value="swaps">Swaps (30d)</option>
            <option value="avg_trade">Avg Trade Size</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left  px-6 py-3 text-tempo-muted font-normal">Pool</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Volume</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Swaps</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Avg Trade</th>
              <th className="text-right px-6 py-3 text-tempo-muted font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(pool => (
              <Fragment key={pool.token}>
                <tr
                  onClick={() => togglePool(pool.token)}
                  className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors cursor-pointer select-none"
                >
                  <td className="px-6 py-4">
                    <span className="text-white font-medium">{pool.symbol}</span>
                    <div className="font-mono text-xs text-tempo-muted mt-0.5">
                      {pool.token.slice(0, 10)}…{pool.token.slice(-6)}
                    </div>
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">
                    {pool.whitelisted ? fmtUSD(pool.volume_usd) : '—'}
                  </td>
                  <td className="text-right px-4 py-4 text-tempo-muted">
                    {fmtCount(pool.swaps_30d)}
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">
                    {pool.whitelisted ? fmtUSD(pool.avg_trade) : '—'}
                  </td>
                  <td className="text-right px-6 py-4">
                    {pool.whitelisted ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                        Known
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-tempo-border/50 text-tempo-muted border border-tempo-border">
                        Unknown
                      </span>
                    )}
                  </td>
                </tr>

                {expandedToken === pool.token && (
                  <tr className="border-b border-tempo-border bg-tempo-border/10">
                    <td colSpan={5} className="px-6 py-4">
                      <p className="text-sm font-medium text-white mb-3">
                        Recent Trades — {pool.symbol}
                      </p>
                      {tradesLoading ? (
                        <p className="text-tempo-muted text-xs">Loading…</p>
                      ) : trades.length === 0 ? (
                        <p className="text-tempo-muted text-xs">No recent trades found.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-tempo-muted border-b border-tempo-border/50">
                              <th className="text-left  pb-2 font-normal">Time</th>
                              <th className="text-left  pb-2 font-normal">Taker</th>
                              <th className="text-right pb-2 font-normal">Amount</th>
                              <th className="text-right pb-2 font-normal">Direction</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trades.map((t, i) => (
                              <tr key={i} className="border-t border-tempo-border/30">
                                <td className="py-1.5 text-tempo-muted pr-4">{timeAgo(t.timestamp)}</td>
                                <td className="py-1.5 font-mono">
                                  <a
                                    href={`/address/${t.taker}`}
                                    className="text-tempo-blue hover:underline"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {t.taker.slice(0, 8)}…{t.taker.slice(-4)}
                                  </a>
                                </td>
                                <td className="py-1.5 text-right font-mono text-white">
                                  {t.amount_usd !== null
                                    ? fmtUSD(t.amount_usd)
                                    : t.amount_raw.toLocaleString()}
                                </td>
                                <td className="py-1.5 text-right">
                                  {t.direction === 0
                                    ? <span className="text-green-400">▲ Buy</span>
                                    : <span className="text-red-400">▼ Sell</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-tempo-muted text-sm">
                  No pools found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Confirm TypeScript compiles**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ProtocolDexPoolExplorer.tsx
git commit -m "feat: add ProtocolDexPoolExplorer client component"
```

---

## Task 7: Update DEX Page

**Files:**
- Modify: `src/app/dex/page.tsx`

Context: The page is a server component. We add `getProtocolDexPools(30)` to the existing `Promise.all`, then render `<ProtocolDexPoolExplorer pools={protocolDexPools} />` as a new section at the bottom.

- [ ] **Step 1: Update the imports in dex/page.tsx**

Add to the existing import block at the top:

```typescript
import {
  getDexDailyVolumeUSD,
  getTopPools,
  getFeeTokenDailyStats,
  getProtocolDexDailyStats,
  getProtocolDexPools,         // ADD
  type DexDailyVolumeUSD,
} from '@/lib/analytics'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'
import { FeeAmmChart } from '@/components/charts/FeeAmmChart'
import { getProtocolDexTVL, getCommunityDexTVL } from '@/lib/defi'
import { ProtocolDexPoolExplorer } from '@/components/ProtocolDexPoolExplorer'  // ADD
```

- [ ] **Step 2: Add getProtocolDexPools to the Promise.all**

Change the existing destructure from:

```typescript
const [feeDaily, protocolDaily, communityDaily, pools, protocolTVL, communityTVL] = await Promise.all([
  getFeeTokenDailyStats(30),
  getProtocolDexDailyStats(30),
  getDexDailyVolumeUSD(30),
  getTopPools(10),
  getProtocolDexTVL(),
  getCommunityDexTVL(),
])
```

To:

```typescript
const [feeDaily, protocolDaily, communityDaily, pools, protocolTVL, communityTVL, protocolDexPools] = await Promise.all([
  getFeeTokenDailyStats(30),
  getProtocolDexDailyStats(30),
  getDexDailyVolumeUSD(30),
  getTopPools(10),
  getProtocolDexTVL(),
  getCommunityDexTVL(),
  getProtocolDexPools(30),
])
```

- [ ] **Step 3: Add the Protocol DEX Pools section to the JSX**

Append inside the `<main>` element, after the closing `</section>` of Section 3 (Community DEX). The current `<section>` for Community DEX does NOT have `className="mb-12"` — it ends with a bare `</section>`. Add the new section after it:

```tsx
      {/* ── Section 4: Protocol DEX Pool Explorer ── */}
      <section className="mt-12">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Protocol DEX Pools</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Enshrined</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Per-pool breakdown of the enshrined Protocol DEX. Click any row to see recent trades.
          Volume shown only for pools with a{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener noreferrer">
            verified token ↗
          </a>
          .
        </p>
        <ProtocolDexPoolExplorer pools={protocolDexPools} />
      </section>
```

- [ ] **Step 4: Confirm TypeScript compiles**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dex/page.tsx
git commit -m "feat: add Protocol DEX Pool Explorer section to /dex page"
```

---

## Task 8: Update NFT Page

**Files:**
- Modify: `src/app/nfts/page.tsx`

Context: The page is a server component. We add two new data fetches and a new section. The existing summary card grid changes from 2 columns to 3 to accommodate the new "Top 10 Minters" card.

- [ ] **Step 1: Update imports in nfts/page.tsx**

Change:

```typescript
import { getTopNFTCollections, getNFTDailyActivity } from '@/lib/analytics'
```

To:

```typescript
import {
  getTopNFTCollections,
  getNFTDailyActivity,
  getNFTMinterConcentration,
  getTopNFTMinters,
} from '@/lib/analytics'
```

- [ ] **Step 2: Add minter data fetches to the Promise.all**

Change:

```typescript
const [collections, daily] = await Promise.all([
  getTopNFTCollections(20),
  getNFTDailyActivity(30),
])
```

To:

```typescript
const [collections, daily, concentration, topMinters] = await Promise.all([
  getTopNFTCollections(20),
  getNFTDailyActivity(30),
  getNFTMinterConcentration(),
  getTopNFTMinters(50),
])
```

- [ ] **Step 3: Update the summary card grid from 2 to 3 columns and add new card**

Change:

```tsx
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfers</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalTransfers30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Active Collections (peak 30d)</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(uniqueCollections30d)}</p>
        </div>
      </div>
```

To:

```tsx
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfers</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalTransfers30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Active Collections (peak 30d)</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(uniqueCollections30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Top 10 Minters</p>
          <p className="text-2xl font-semibold text-white">{concentration.top10_share_pct.toFixed(1)}%</p>
          <p className="text-tempo-muted text-xs mt-1">of all-time mints</p>
        </div>
      </div>
```

- [ ] **Step 4: Append Minter Concentration section after the top collections table**

Add after the closing `</div>` of the top collections table card:

```tsx
      {/* Minter Concentration */}
      <div className="mt-8 bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">Minter Concentration</h2>
          <p className="text-tempo-muted text-xs mt-1">
            {concentration.unique_minters.toLocaleString()} unique minters,{' '}
            {concentration.total_mints.toLocaleString()} total all-time mints
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left  px-6 py-3 text-tempo-muted font-normal">Rank</th>
                <th className="text-left  px-4 py-3 text-tempo-muted font-normal">Address</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">Mints</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">% of Total</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">Collections</th>
              </tr>
            </thead>
            <tbody>
              {topMinters.map(m => (
                <tr key={m.minter} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                  <td className="px-6 py-4 text-tempo-muted">{m.rank}</td>
                  <td className="px-4 py-4">
                    <a href={`/address/${m.minter}`} className="font-mono text-xs text-tempo-blue hover:underline">
                      {m.minter.slice(0, 10)}…{m.minter.slice(-6)}
                    </a>
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">{fmtCount(m.mints)}</td>
                  <td className="text-right px-4 py-4 text-tempo-muted">{m.pct_total.toFixed(1)}%</td>
                  <td className="text-right px-6 py-4 text-tempo-muted">{m.collections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
```

- [ ] **Step 5: Confirm TypeScript compiles**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/app/nfts/page.tsx
git commit -m "feat: add minter concentration stat and table to /nfts page"
```

---

## Task 9: Full Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
npm test -- --testPathPattern='__tests__/lib' 2>&1 | tail -15
```

Expected: all tests pass, including the 8 new ones

- [ ] **Step 2: TypeScript full check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output (zero errors)

- [ ] **Step 3: Dev build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes without errors. Note: build may warn about missing env vars (TIDX_URL, etc.) — those are expected in CI, not errors.

- [ ] **Step 4: Verify ClickHouse view has data (smoke test)**

```bash
curl -s 'http://localhost:8123/?database=tidx_4217' \
  --data "SELECT token, sum(swaps) as s FROM mv_protocol_dex_pool_daily GROUP BY token ORDER BY s DESC LIMIT 3"
```

Expected: 3 rows with token addresses and swap counts (top token should have thousands)

---

## Task 10: Push and Create PR

- [ ] **Step 1: Final commit check**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/dex-nft-analytics
git log --oneline master..HEAD
```

Expected: ~7 commits listed (one per task)

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/dex-pool-explorer-nft-concentration
```

- [ ] **Step 3: Create PR (do not merge)**

```bash
gh pr create \
  --title "feat: Protocol DEX pool explorer + NFT minter concentration" \
  --body "$(cat <<'EOF'
## Summary

- Adds per-pool breakdown table to `/dex` for the enshrined Protocol DEX, with toggle (All / Known Tokens Only), sort (Volume / Swaps / Avg Trade), and an accordion showing recent 50 trades per pool
- Adds minter concentration section to `/nfts`: "Top 10 Minters = X% of all mints" stat card + ranked table of top 50 minters with mint count, % of total, and unique collections touched
- New ClickHouse MV `mv_protocol_dex_pool_daily` aggregates swap events per (day, pool_id, token)
- New API route `/api/protocol-dex/pool-trades` serves on-demand trade data for the accordion
- 8 new unit tests covering all new analytics functions

## Test plan

- [ ] All existing tests still pass (`npm test`)
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] `/dex` page loads and shows Protocol DEX Pools section with data
- [ ] Toggle filters pools correctly; sort reorders the table
- [ ] Clicking a pool row expands accordion and loads recent trades
- [ ] `0x710f8c…` address visibly dominates the Taker column (expected — it's a bot)
- [ ] `/nfts` page loads with 3-column summary row including "Top 10 Minters X%"
- [ ] Minter concentration table shows ranked addresses

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed to terminal
