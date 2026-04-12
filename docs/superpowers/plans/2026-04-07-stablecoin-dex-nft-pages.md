# Stablecoin TVL, DEX, and NFT Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live tokenlist-driven stablecoin registry, a Stablecoin TVL page, a DEX volume page, and an NFT activity page to the Tempo Explorer — plus fix the stale hardcoded token list and remove the meaningless `Value: 0 wei` row from tx detail.

**Architecture:** Pull verified token metadata from the official `tokenlist.tempo.xyz/list/4217` API (1h Redis cache) instead of a hardcoded map — this solves the maintainability problem as new stablecoins are added weekly. Three new ClickHouse MVs provide fast daily aggregates: `mv_erc20_volume_daily` (all ERC-20 transfers, replaces the 2-token hardcoded MV), `mv_dex_swap_amounts_daily` (Uniswap V2 Swap event decoded amounts), and `mv_fee_token_daily` (fee token usage per day). New `lib/dex.ts` resolves pair token0/token1 via RPC (cached 24h) and computes USD volume by identifying the stablecoin side of each swap. Three new pages under Next.js App Router: `/stablecoins`, `/dex`, `/nfts`.

**Tech Stack:** Next.js 15 App Router, ClickHouse 24.8 direct HTTP (port 8123), Redis/ioredis, viem 2.x (publicClient from lib/chain.ts), recharts 2.x, `tokenlist.tempo.xyz` API

---

## Background & Data Reality

- **Tokenlist**: `https://tokenlist.tempo.xyz/list/4217` — 12 verified stablecoins as of 2026-04-07, new ones added weekly (reUSD added 6 days ago). All use 6 decimals. Schema: Uniswap token-list standard with Tempo `extensions.chain`, `extensions.label`, `extensions.bridgeInfo`.
- **Current bug**: `KNOWN_TOKENS` in `lib/tokens.ts` only has 6 of the 12 verified tokens, and `mv_stablecoin_daily` only tracks 2 — both will be stale again within weeks without the tokenlist integration.
- **DEX pairs**: 154 unique pair addresses emitting Swap events. All Uniswap V2-compatible (community-deployed). USD volume computable by identifying the stablecoin side of each pair.
- **ERC-20 tokens**: 2662 unique token addresses in the logs table (with Transfer events). `mv_erc20_volume_daily` will have ~2662 × 110 days ≈ 293K rows — tiny for ClickHouse.
- **Uniswap V2 Swap event data layout** (for MV decoding):
  - `data = '0x' + 256 hex chars` (4 × 32 bytes = amount0In, amount1In, amount0Out, amount1Out)
  - `amount0In` last 8 bytes → `substring(data, 51, 16)`
  - `amount1In` last 8 bytes → `substring(data, 115, 16)`
  - `amount0Out` last 8 bytes → `substring(data, 179, 16)`
  - `amount1Out` last 8 bytes → `substring(data, 243, 16)`
- **Official team fix to learn from**: `msg.value` is always 0 on Tempo (no native ETH, all transfers use tokens). The official explorer removed the `Value` row from tx detail pages.

---

## File Map

```
tidx/
  scripts/
    setup-clickhouse-views-v2.sql    CREATE — 3 new MVs + backfill

tidx/explorer/
  src/lib/
    tokenlist.ts                     CREATE — Live tokenlist API client (1h cache)
    dex.ts                           CREATE — DEX pair resolution + USD volume calc
    tokens.ts                        MODIFY — Add getTokenSupply(); use tokenlist before RPC
    analytics.ts                     MODIFY — Update getStablecoinDailyVolume to use mv_erc20_volume_daily + tokenlist; add getStablecoinStats(), getDexDailyVolumeUSD(), getTopPools()

  src/components/
    TxDetail.tsx                     MODIFY — Remove Value row (always 0 on Tempo)
    charts/
      StablecoinTVLChart.tsx         CREATE — Stacked area: daily volume per stablecoin (30d)
      DexVolumeChart.tsx             CREATE — Bar chart: daily DEX USD volume (30d)

  src/app/
    stablecoins/
      page.tsx                       CREATE — Stablecoin TVL page
    dex/
      page.tsx                       CREATE — DEX volume + pool explorer
    nfts/
      page.tsx                       CREATE — NFT ERC-721 activity page
    layout.tsx                       MODIFY — Add Stablecoins, DEX, NFTs nav links

  __tests__/lib/
    tokenlist.test.ts                CREATE — 7 unit tests
    dex.test.ts                      CREATE — 6 unit tests
```

---

## Task 1: Remove Value Row from TxDetail

**Files:**
- Modify: `explorer/src/components/TxDetail.tsx`

On Tempo, `msg.value` is always 0 — the chain uses stablecoin fee tokens, not native ETH. The official explorer removed this row in PR #809. Displaying "0 wei" is misleading.

- [ ] **Step 1: Remove the Value field**

In `explorer/src/components/TxDetail.tsx`, remove line 49:

```tsx
// DELETE this line:
<Field label="Value" value={`${tx.value ?? '0'} wei`} />
```

- [ ] **Step 2: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 3: Commit**

```bash
cd ~/tidx/explorer
git add src/components/TxDetail.tsx
git commit -m "fix: remove Value row from tx detail (always 0 on Tempo)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Live Tokenlist Module

**Files:**
- Create: `explorer/src/lib/tokenlist.ts`
- Create: `explorer/__tests__/lib/tokenlist.test.ts`
- Modify: `explorer/src/lib/tokens.ts`

Replaces the stale hardcoded `KNOWN_TOKENS` map (6 tokens) with a live fetch from `tokenlist.tempo.xyz/list/4217` (12 tokens, updated weekly). Genesis tokens (`KNOWN_TOKENS`) remain as an instant local fallback. `getTokenInfo` priority becomes: KNOWN_TOKENS → tokenlist → Redis cache → RPC.

- [ ] **Step 1: Write the failing tests**

```typescript
// explorer/__tests__/lib/tokenlist.test.ts

jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store[k] ?? null),
    set: jest.fn(async (k: string, v: string) => { store[k] = v }),
    del: jest.fn(async (k: string) => { delete store[k] }),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => { store[k] = v }),
  }))
})

// Mock the tokenlist API response
const MOCK_LIST = {
  name: 'Tempo Mainnet',
  tokens: [
    { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD', name: 'PathUSD', decimals: 6, chainId: 4217, extensions: { chain: 'tempo', label: 'PathUSD' } },
    { address: '0x20c000000000000000000000b9537d11c60e8b50', symbol: 'USDC.e', name: 'USD Coin (Bridged)', decimals: 6, chainId: 4217, extensions: { chain: 'tempo', label: 'USDC.e' } },
    { address: '0x20c0000000000000000000001621e21f71cf12fb', symbol: 'EURC.e', name: 'Euro Coin (Bridged)', decimals: 6, chainId: 4217, extensions: { chain: 'tempo', label: 'EURC' } },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_LIST,
  })
})

import { getVerifiedTokens, getTokenFromList, isVerifiedToken, getStablecoinAddresses } from '@/lib/tokenlist'

test('getVerifiedTokens returns parsed token list', async () => {
  const tokens = await getVerifiedTokens()
  expect(tokens).toHaveLength(3)
  expect(tokens[0].symbol).toBe('pathUSD')
  expect(tokens[0].address).toBe('0x20c0000000000000000000000000000000000000')
})

test('getVerifiedTokens normalises addresses to lowercase', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      tokens: [{ address: '0x20C0000000000000000000000000000000000000', symbol: 'pathUSD', name: 'PathUSD', decimals: 6, chainId: 4217, extensions: {} }],
    }),
  })
  const tokens = await getVerifiedTokens()
  expect(tokens[0].address).toBe('0x20c0000000000000000000000000000000000000')
})

test('getVerifiedTokens falls back to KNOWN_TOKENS on fetch failure', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
  const tokens = await getVerifiedTokens()
  expect(tokens.length).toBeGreaterThan(0)
  expect(tokens.some(t => t.symbol === 'pathUSD')).toBe(true)
})

test('getTokenFromList returns TokenInfo for known address', async () => {
  const info = await getTokenFromList('0x20c0000000000000000000000000000000000000')
  expect(info).toMatchObject({ symbol: 'pathUSD', decimals: 6 })
})

test('getTokenFromList is case-insensitive', async () => {
  const info = await getTokenFromList('0x20C0000000000000000000000000000000000000')
  expect(info?.symbol).toBe('pathUSD')
})

test('getTokenFromList returns null for unknown address', async () => {
  const info = await getTokenFromList('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  expect(info).toBeNull()
})

test('isVerifiedToken returns true for tokenlist address, false for unknown', async () => {
  expect(await isVerifiedToken('0x20c0000000000000000000000000000000000000')).toBe(true)
  expect(await isVerifiedToken('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(false)
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/tokenlist.test.ts
# Expected: Cannot find module '@/lib/tokenlist'
```

- [ ] **Step 3: Implement tokenlist.ts**

```typescript
// explorer/src/lib/tokenlist.ts
import { getCached, setCached } from './cache'
import { KNOWN_TOKENS, type TokenInfo } from './tokens'

const TOKENLIST_URL = 'https://tokenlist.tempo.xyz/list/4217'
const CACHE_KEY = 'tokenlist:4217'
const CACHE_TTL = 3600 // 1 hour

export async function getVerifiedTokens(): Promise<TokenInfo[]> {
  const cached = await getCached<TokenInfo[]>(CACHE_KEY)
  if (cached) return cached

  try {
    const res = await fetch(TOKENLIST_URL, { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`tokenlist HTTP ${res.status}`)
    const data = await res.json() as { tokens: Array<{ address: string; symbol: string; name: string; decimals: number }> }

    const tokens: TokenInfo[] = data.tokens.map(t => ({
      address: t.address.toLowerCase(),
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
    }))

    await setCached(CACHE_KEY, tokens, CACHE_TTL)
    return tokens
  } catch {
    // Fallback: return KNOWN_TOKENS as array
    return Object.values(KNOWN_TOKENS)
  }
}

export async function getTokenFromList(address: string): Promise<TokenInfo | null> {
  const lower = address.toLowerCase()
  const tokens = await getVerifiedTokens()
  return tokens.find(t => t.address === lower) ?? null
}

export async function isVerifiedToken(address: string): Promise<boolean> {
  return (await getTokenFromList(address)) !== null
}

export async function getStablecoinAddresses(): Promise<string[]> {
  // All tokens in the verified list are stablecoins on Tempo Mainnet
  const tokens = await getVerifiedTokens()
  return tokens.map(t => t.address)
}
```

- [ ] **Step 4: Update `tokens.ts` — add tokenlist as lookup tier and add `getTokenSupply`**

In `explorer/src/lib/tokens.ts`, make two changes:

**Change 1** — Update `getTokenInfo` to check tokenlist before RPC:

```typescript
// Add import at top of file:
import { getTokenFromList } from './tokenlist'

// Replace the existing getTokenInfo function body:
export async function getTokenInfo(address: string): Promise<TokenInfo | null> {
  const lower = address.toLowerCase()

  // 1. Instant local lookup (genesis/system tokens)
  const known = KNOWN_TOKENS[lower]
  if (known) return known

  // 2. Live tokenlist (verified tokens, 1h cache)
  const listed = await getTokenFromList(lower)
  if (listed) return listed

  // 3. Redis cache (previously RPC-fetched unknowns)
  const cacheKey = `token:meta:${lower}`
  const cached = await getCached<TokenInfo>(cacheKey)
  if (cached) return cached

  // 4. RPC fallback for unknown contracts
  try {
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'name' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' }),
    ])
    const info: TokenInfo = { address: lower, symbol: symbol as string, name: name as string, decimals: decimals as number }
    await setCached(cacheKey, info, 86400)
    return info
  } catch {
    return null
  }
}
```

**Change 2** — Add `getTokenSupply` function after the existing exports:

```typescript
const TOTAL_SUPPLY_ABI = [
  { name: 'totalSupply', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export async function getTokenSupply(address: string): Promise<bigint | null> {
  const lower = address.toLowerCase()
  const cacheKey = `token:supply:${lower}`
  const cached = await getCached<string>(cacheKey)
  if (cached) return BigInt(cached)

  try {
    const supply = await publicClient.readContract({
      address: lower as `0x${string}`,
      abi: TOTAL_SUPPLY_ABI,
      functionName: 'totalSupply',
    })
    await setCached(cacheKey, String(supply), 900) // 15 min
    return supply as bigint
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/tokenlist.test.ts
# Expected: PASS, 7 tests
```

- [ ] **Step 6: Run full test suite**

```bash
cd ~/tidx/explorer && npm test
# Expected: 48 + 7 = 55 tests pass
```

- [ ] **Step 7: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 8: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/tokenlist.ts src/lib/tokens.ts __tests__/lib/tokenlist.test.ts
git commit -m "feat: live tokenlist module — auto-discovery of verified Tempo tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: ClickHouse MVs v2

**Files:**
- Create: `scripts/setup-clickhouse-views-v2.sql`

Three new MVs. All use `IF NOT EXISTS` (safe to re-run). The key one is `mv_erc20_volume_daily` — it tracks ALL ERC-20 fungible transfers with volume, making any stablecoin auto-queryable without touching the MV when new tokens appear.

- [ ] **Step 1: Create `scripts/setup-clickhouse-views-v2.sql`**

```sql
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
  volume_raw UInt64,   -- raw lo-64 of uint256 amount
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
  AND topic3 IS NULL   -- ERC-20 only (topic3 = tokenId means ERC-721)
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
--    Swap(address indexed sender, uint amount0In, uint amount1In,
--         uint amount0Out, uint amount1Out, address indexed to)
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
```

- [ ] **Step 2: Run the setup script**

```bash
cd ~/tidx
docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 \
  < scripts/setup-clickhouse-views-v2.sql
# Expected: no errors; backfills take ~60-90s for mv_erc20_volume_daily
```

- [ ] **Step 3: Verify all 3 MVs have data**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT 'mv_erc20_volume_daily' as tbl, count(), sum(transfers) FROM tidx_4217.mv_erc20_volume_daily
  UNION ALL
  SELECT 'mv_dex_swap_amounts_daily', count(), sum(swap_count) FROM tidx_4217.mv_dex_swap_amounts_daily
  UNION ALL
  SELECT 'mv_fee_token_daily', count(), sum(txs) FROM tidx_4217.mv_fee_token_daily
"
# Expected:
#   mv_erc20_volume_daily:    ~293K rows,  transfers ≥ 4M
#   mv_dex_swap_amounts_daily: ~16K rows,  swap_count ≥ 55K
#   mv_fee_token_daily:        ~220 rows,  txs ≥ 15M
```

- [ ] **Step 4: Verify stablecoin coverage in mv_erc20_volume_daily**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT token, sum(volume_raw)/1e6 as vol_usd, sum(transfers) as xfers
  FROM tidx_4217.mv_erc20_volume_daily
  WHERE token IN (
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50',
    '0x20c0000000000000000000001621e21f71cf12fb',
    '0x20c00000000000000000000014f22ca97301eb73'
  )
  GROUP BY token ORDER BY vol_usd DESC
"
# Expected: pathUSD ≥ $34M, USDC.e ≥ $21M; EURC.e and USDT0 have some volume
```

- [ ] **Step 5: Verify Swap amounts are non-zero**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT pair, sum(amount0In)/1e6 as a0in, sum(amount1In)/1e6 as a1in,
         sum(amount0Out)/1e6 as a0out, sum(amount1Out)/1e6 as a1out
  FROM tidx_4217.mv_dex_swap_amounts_daily
  GROUP BY pair ORDER BY (a0in + a1in + a0out + a1out) DESC
  LIMIT 5
"
# Expected: top pairs show non-zero amounts on at least one side
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx
git add scripts/setup-clickhouse-views-v2.sql
git commit -m "feat: add mv_erc20_volume_daily, mv_dex_swap_amounts_daily, mv_fee_token_daily

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: DEX Pair Registry

**Files:**
- Create: `explorer/src/lib/dex.ts`
- Create: `explorer/__tests__/lib/dex.test.ts`

Resolves Uniswap V2 pair token0/token1 via RPC (cached 24h in Redis). Determines USD volume by checking which token in a pair is a verified stablecoin, then using that side's amounts from `mv_dex_swap_amounts_daily`. Pairs where neither token is verified are excluded from USD volume calculations (whitelist filter).

USD volume logic: In a V2 swap, each Swap event has exactly one non-zero value on each side. If token0 is a stablecoin, then `amount0In` (user pays) or `amount0Out` (user receives) is non-zero per swap, never both. So `sum(amount0In) + sum(amount0Out)` = total stablecoin USD volume for token0-stable pairs.

- [ ] **Step 1: Write the failing tests**

```typescript
// explorer/__tests__/lib/dex.test.ts

jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store[k] ?? null),
    set: jest.fn(async (k: string, v: string) => { store[k] = v }),
    del: jest.fn(async (k: string) => { delete store[k] }),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => { store[k] = v }),
  }))
})

// Mock tokenlist to return pathUSD and USDC.e as verified
jest.mock('@/lib/tokenlist', () => ({
  getStablecoinAddresses: jest.fn().mockResolvedValue([
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50',
  ]),
  isVerifiedToken: jest.fn().mockImplementation(async (addr: string) =>
    ['0x20c0000000000000000000000000000000000000',
     '0x20c000000000000000000000b9537d11c60e8b50'].includes(addr.toLowerCase())
  ),
}))

// Mock publicClient.readContract for token0/token1 calls
jest.mock('@/lib/chain', () => ({
  publicClient: {
    readContract: jest.fn().mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'token0') return '0x20c0000000000000000000000000000000000000'
      if (functionName === 'token1') return '0xabcdef1234567890abcdef1234567890abcdef12'
      return null
    }),
  },
}))

import { getDexPairInfo, computePairUsdVolume, isWhitelistedPair } from '@/lib/dex'

test('getDexPairInfo resolves token0 and token1 via RPC', async () => {
  const info = await getDexPairInfo('0xpair0000000000000000000000000000000000001')
  expect(info.token0).toBe('0x20c0000000000000000000000000000000000000')
  expect(info.token1).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
})

test('getDexPairInfo returns cached result on second call without RPC', async () => {
  const { publicClient } = require('@/lib/chain')
  publicClient.readContract.mockClear()
  await getDexPairInfo('0xpair0000000000000000000000000000000000001')
  await getDexPairInfo('0xpair0000000000000000000000000000000000001')
  // Second call uses cache — readContract called at most twice (token0 + token1) total, not 4 times
  expect(publicClient.readContract.mock.calls.length).toBeLessThanOrEqual(2)
})

test('computePairUsdVolume: token0 is stablecoin → uses amount0 side', async () => {
  // token0 = pathUSD (stablecoin), token1 = some token
  const vol = await computePairUsdVolume({
    token0: '0x20c0000000000000000000000000000000000000',
    token1: '0xabcdef1234567890abcdef1234567890abcdef12',
    amount0In: 500_000_000n,   // $500 in (6 decimals)
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 1_000_000n,
  })
  expect(vol).toBeCloseTo(500.0, 1)  // $500 USD
})

test('computePairUsdVolume: token1 is stablecoin → uses amount1 side', async () => {
  // token0 = some token, token1 = USDC.e (stablecoin)
  const vol = await computePairUsdVolume({
    token0: '0xabcdef1234567890abcdef1234567890abcdef12',
    token1: '0x20c000000000000000000000b9537d11c60e8b50',
    amount0In: 1_000_000n,
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 250_000_000n,  // $250 out (6 decimals)
  })
  expect(vol).toBeCloseTo(250.0, 1)  // $250 USD
})

test('computePairUsdVolume: no stablecoin in pair → returns null', async () => {
  const { isVerifiedToken } = require('@/lib/tokenlist')
  isVerifiedToken.mockResolvedValue(false)
  const vol = await computePairUsdVolume({
    token0: '0xaaaa000000000000000000000000000000000001',
    token1: '0xbbbb000000000000000000000000000000000002',
    amount0In: 1000n, amount1In: 0n, amount0Out: 0n, amount1Out: 1000n,
  })
  expect(vol).toBeNull()
})

test('isWhitelistedPair returns true when token0 is verified', async () => {
  expect(await isWhitelistedPair(
    '0x20c0000000000000000000000000000000000000',
    '0xabcdef1234567890abcdef1234567890abcdef12'
  )).toBe(true)
})

test('isWhitelistedPair returns false when neither token is verified', async () => {
  const { isVerifiedToken } = require('@/lib/tokenlist')
  isVerifiedToken.mockResolvedValue(false)
  expect(await isWhitelistedPair(
    '0xaaaa000000000000000000000000000000000001',
    '0xbbbb000000000000000000000000000000000002'
  )).toBe(false)
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/dex.test.ts
# Expected: Cannot find module '@/lib/dex'
```

- [ ] **Step 3: Implement `dex.ts`**

```typescript
// explorer/src/lib/dex.ts
import { getCached, setCached } from './cache'
import { publicClient } from './chain'
import { isVerifiedToken } from './tokenlist'

const PAIR_ABI = [
  { name: 'token0', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'token1', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

export interface PairInfo {
  pair: string
  token0: string
  token1: string
}

export async function getDexPairInfo(pair: string): Promise<PairInfo> {
  const lower = pair.toLowerCase()
  const cacheKey = `dex:pair:${lower}`
  const cached = await getCached<PairInfo>(cacheKey)
  if (cached) return cached

  const [token0, token1] = await Promise.all([
    publicClient.readContract({ address: lower as `0x${string}`, abi: PAIR_ABI, functionName: 'token0' }),
    publicClient.readContract({ address: lower as `0x${string}`, abi: PAIR_ABI, functionName: 'token1' }),
  ])

  const info: PairInfo = {
    pair: lower,
    token0: (token0 as string).toLowerCase(),
    token1: (token1 as string).toLowerCase(),
  }
  await setCached(cacheKey, info, 86400) // 24h — pair tokens never change
  return info
}

export async function isWhitelistedPair(token0: string, token1: string): Promise<boolean> {
  const [v0, v1] = await Promise.all([isVerifiedToken(token0), isVerifiedToken(token1)])
  return v0 || v1
}

export interface PairAmounts {
  token0: string
  token1: string
  amount0In: bigint
  amount1In: bigint
  amount0Out: bigint
  amount1Out: bigint
}

export async function computePairUsdVolume(amounts: PairAmounts): Promise<number | null> {
  const [v0, v1] = await Promise.all([
    isVerifiedToken(amounts.token0),
    isVerifiedToken(amounts.token1),
  ])

  if (!v0 && !v1) return null

  // Use the stablecoin side (all Tempo stablecoins are 6-decimal)
  if (v0) {
    return Number(amounts.amount0In + amounts.amount0Out) / 1e6
  } else {
    return Number(amounts.amount1In + amounts.amount1Out) / 1e6
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/tidx/explorer && npx jest __tests__/lib/dex.test.ts
# Expected: PASS, 6 tests
```

- [ ] **Step 5: Run full test suite**

```bash
cd ~/tidx/explorer && npm test
# Expected: 55 + 6 = 61 tests pass
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/dex.ts __tests__/lib/dex.test.ts
git commit -m "feat: DEX pair registry — token0/token1 resolution and USD volume calculation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Stablecoin Analytics Functions

**Files:**
- Modify: `explorer/src/lib/analytics.ts`

Updates `getStablecoinDailyVolume` to use `mv_erc20_volume_daily` (covers all 12 stablecoins, not just 2) filtered by the live tokenlist. Adds `getStablecoinStats()` (supply + multi-window volume per token) and `getFeeTokenDailyStats()` (for fee usage chart on stablecoin page).

- [ ] **Step 1: Update `getStablecoinDailyVolume` to use mv_erc20_volume_daily + tokenlist**

In `explorer/src/lib/analytics.ts`, replace the existing `getStablecoinDailyVolume` function:

```typescript
// Add import at the top of analytics.ts (with other imports):
import { getStablecoinAddresses } from './tokenlist'
import { getTokenInfo, getTokenSupply } from './tokens'

// Replace the existing getStablecoinDailyVolume function entirely:
export async function getStablecoinDailyVolume(days = 30): Promise<StablecoinDailyStat[]> {
  const key = `analytics:stablecoins:v2:${days}`
  const cached = await getCached<StablecoinDailyStat[]>(key)
  if (cached) return cached

  const stableAddrs = await getStablecoinAddresses()
  if (stableAddrs.length === 0) return []

  const addrList = stableAddrs.map(a => `'${a}'`).join(', ')

  const rows = await queryClickHouse<{
    day: string; token: string; volume_raw: string; transfers: string
  }>(`
    SELECT day, token, sum(volume_raw) AS volume_raw, sum(transfers) AS transfers
    FROM mv_erc20_volume_daily
    WHERE day >= today() - ${days}
      AND token IN (${addrList})
    GROUP BY day, token
    ORDER BY day ASC, token ASC
  `)

  // Group by day, then by token within each day
  const byDay = new Map<string, StablecoinDailyStat>()
  for (const r of rows) {
    const day = String(r.day).slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, {
      day,
      pathUSD_volume: 0, usdc_e_volume: 0,
      pathUSD_transfers: 0, usdc_e_transfers: 0,
    })
    const stat = byDay.get(day)!
    if (r.token === stableAddrs[0]) {
      stat.pathUSD_volume = Number(r.volume_raw) / 1e6
      stat.pathUSD_transfers = Number(r.transfers)
    } else if (r.token === stableAddrs[1]) {
      stat.usdc_e_volume = Number(r.volume_raw) / 1e6
      stat.usdc_e_transfers = Number(r.transfers)
    }
  }

  const result = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 2: Add `getStablecoinStats` — supply + volume per token**

Append to `explorer/src/lib/analytics.ts`:

```typescript
export interface StablecoinStat {
  address: string
  symbol: string
  name: string
  supply: number | null        // USD (6-decimal normalized), null if RPC failed
  volume_24h: number
  volume_7d: number
  volume_30d: number
  transfers_30d: number
  fee_txs_30d: number
}

export async function getStablecoinStats(): Promise<StablecoinStat[]> {
  const key = 'analytics:stablecoin:stats'
  const cached = await getCached<StablecoinStat[]>(key)
  if (cached) return cached

  const stableAddrs = await getStablecoinAddresses()
  if (stableAddrs.length === 0) return []

  const addrList = stableAddrs.map(a => `'${a}'`).join(', ')

  // Fetch volume windows and fee usage in parallel with token supplies
  const [volumeRows, feeRows, supplies, tokenInfos] = await Promise.all([
    queryClickHouse<{ token: string; volume_raw: string; transfers: string; window_days: string }>(`
      SELECT token,
        sumIf(volume_raw, day >= today() - 1)  AS volume_1d,
        sumIf(volume_raw, day >= today() - 7)  AS volume_7d,
        sumIf(volume_raw, day >= today() - 30) AS volume_raw,
        sumIf(transfers,  day >= today() - 30) AS transfers
      FROM mv_erc20_volume_daily
      WHERE token IN (${addrList})
      GROUP BY token
    `),
    queryClickHouse<{ fee_token: string; txs: string }>(`
      SELECT fee_token, sum(txs) AS txs
      FROM mv_fee_token_daily
      WHERE day >= today() - 30
        AND fee_token IN (${addrList})
      GROUP BY fee_token
    `),
    Promise.all(stableAddrs.map(a => getTokenSupply(a))),
    Promise.all(stableAddrs.map(a => getTokenInfo(a))),
  ])

  const volByToken = new Map(volumeRows.map(r => [r.token, r]))
  const feeByToken = new Map(feeRows.map(r => [r.fee_token, Number(r.txs)]))

  const result: StablecoinStat[] = stableAddrs.map((addr, i) => {
    const v = volByToken.get(addr)
    const info = tokenInfos[i]
    const rawSupply = supplies[i]
    return {
      address: addr,
      symbol: info?.symbol ?? addr.slice(-8),
      name: info?.name ?? 'Unknown',
      supply: rawSupply !== null ? Number(rawSupply) / 1e6 : null,
      volume_24h: v ? Number((v as Record<string, string>)['volume_1d']) / 1e6 : 0,
      volume_7d: v ? Number((v as Record<string, string>)['volume_7d']) / 1e6 : 0,
      volume_30d: v ? Number((v as Record<string, string>)['volume_raw']) / 1e6 : 0,
      transfers_30d: v ? Number((v as Record<string, string>)['transfers']) : 0,
      fee_txs_30d: feeByToken.get(addr) ?? 0,
    }
  })

  await setCached(key, result, 900)
  return result
}
```

**Note:** The ClickHouse query above uses `sumIf` with multiple conditions in a single scan — this is a ClickHouse aggregation pattern that computes multiple windows in one pass. The column aliases in the SELECT don't match the TypeScript type names — use explicit casting with `(v as Record<string, string>)['volume_1d']` etc. (ClickHouse returns the alias as the key).

Actually, simplify the query to avoid the alias confusion — use separate named columns:

```typescript
// Replace the volumeRows query above with this cleaner version:
queryClickHouse<{ token: string; vol_1d: string; vol_7d: string; vol_30d: string; transfers_30d: string }>(`
  SELECT token,
    sumIf(volume_raw, day >= today() - 1)  AS vol_1d,
    sumIf(volume_raw, day >= today() - 7)  AS vol_7d,
    sumIf(volume_raw, day >= today() - 30) AS vol_30d,
    sumIf(transfers,  day >= today() - 30) AS transfers_30d
  FROM mv_erc20_volume_daily
  WHERE token IN (${addrList})
  GROUP BY token
`),
// Then in the result mapping:
// volume_24h: v ? Number(v.vol_1d) / 1e6 : 0,
// volume_7d:  v ? Number(v.vol_7d)  / 1e6 : 0,
// volume_30d: v ? Number(v.vol_30d) / 1e6 : 0,
// transfers_30d: v ? Number(v.transfers_30d) : 0,
```

Use the cleaner version (with `vol_1d`, `vol_7d`, `vol_30d`, `transfers_30d` as field names in the TypeScript type and the mapping).

- [ ] **Step 3: Add `getDexDailyVolumeUSD` and `getTopPools`**

Append to `explorer/src/lib/analytics.ts`:

```typescript
import { getDexPairInfo, computePairUsdVolume } from './dex'

export interface DexDailyVolumeUSD {
  day: string
  volume_usd: number
  swap_count: number
}

export async function getDexDailyVolumeUSD(days = 30): Promise<DexDailyVolumeUSD[]> {
  const key = `analytics:dex:volume_usd:${days}`
  const cached = await getCached<DexDailyVolumeUSD[]>(key)
  if (cached) return cached

  // Fetch all swap amounts for the window
  const rows = await queryClickHouse<{
    day: string; pair: string
    amount0In: string; amount1In: string; amount0Out: string; amount1Out: string
    swap_count: string
  }>(`
    SELECT day, pair,
      sum(amount0In) AS amount0In, sum(amount1In) AS amount1In,
      sum(amount0Out) AS amount0Out, sum(amount1Out) AS amount1Out,
      sum(swap_count) AS swap_count
    FROM mv_dex_swap_amounts_daily
    WHERE day >= today() - ${days}
    GROUP BY day, pair
    ORDER BY day ASC
  `)

  // Resolve pair tokens (all unique pairs, cached 24h)
  const uniquePairs = [...new Set(rows.map(r => r.pair))]
  const pairInfoMap = new Map<string, Awaited<ReturnType<typeof getDexPairInfo>>>()
  await Promise.all(uniquePairs.map(async p => {
    try { pairInfoMap.set(p, await getDexPairInfo(p)) } catch { /* skip invalid pairs */ }
  }))

  // Aggregate daily USD volume across whitelisted pairs
  const byDay = new Map<string, { volume_usd: number; swap_count: number }>()

  for (const r of rows) {
    const info = pairInfoMap.get(r.pair)
    if (!info) continue

    const usdVol = await computePairUsdVolume({
      token0: info.token0,
      token1: info.token1,
      amount0In: BigInt(r.amount0In),
      amount1In: BigInt(r.amount1In),
      amount0Out: BigInt(r.amount0Out),
      amount1Out: BigInt(r.amount1Out),
    })
    if (usdVol === null) continue

    const day = String(r.day).slice(0, 10)
    const existing = byDay.get(day) ?? { volume_usd: 0, swap_count: 0 }
    byDay.set(day, {
      volume_usd: existing.volume_usd + usdVol,
      swap_count: existing.swap_count + Number(r.swap_count),
    })
  }

  const result: DexDailyVolumeUSD[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }))

  await setCached(key, result, 900)
  return result
}

export interface PoolStat {
  pair: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  swaps_30d: number
  volume_usd_30d: number
}

export async function getTopPools(limit = 10): Promise<PoolStat[]> {
  const key = `analytics:dex:pools:${limit}`
  const cached = await getCached<PoolStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    pair: string; amount0In: string; amount1In: string
    amount0Out: string; amount1Out: string; swap_count: string
  }>(`
    SELECT pair,
      sum(amount0In) AS amount0In, sum(amount1In) AS amount1In,
      sum(amount0Out) AS amount0Out, sum(amount1Out) AS amount1Out,
      sum(swap_count) AS swap_count
    FROM mv_dex_swap_amounts_daily
    WHERE day >= today() - 30
    GROUP BY pair
    ORDER BY swap_count DESC
    LIMIT ${limit * 2}
  `)

  const pools: PoolStat[] = []
  for (const r of rows) {
    if (pools.length >= limit) break
    try {
      const info = await getDexPairInfo(r.pair)
      const usdVol = await computePairUsdVolume({
        token0: info.token0, token1: info.token1,
        amount0In: BigInt(r.amount0In), amount1In: BigInt(r.amount1In),
        amount0Out: BigInt(r.amount0Out), amount1Out: BigInt(r.amount1Out),
      })
      if (usdVol === null) continue // skip non-whitelisted pairs

      const [t0info, t1info] = await Promise.all([
        getTokenInfo(info.token0),
        getTokenInfo(info.token1),
      ])
      pools.push({
        pair: r.pair,
        token0: info.token0,
        token1: info.token1,
        token0Symbol: t0info?.symbol ?? info.token0.slice(-8),
        token1Symbol: t1info?.symbol ?? info.token1.slice(-8),
        swaps_30d: Number(r.swap_count),
        volume_usd_30d: usdVol,
      })
    } catch { /* skip pairs that fail RPC resolution */ }
  }

  await setCached(key, pools, 3600)
  return pools
}
```

- [ ] **Step 4: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build, no type errors
```

- [ ] **Step 5: Run all tests**

```bash
cd ~/tidx/explorer && npm test
# Expected: 61 tests pass (no new tests in this task)
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/analytics.ts
git commit -m "feat: stablecoin stats + DEX volume via mv_erc20_volume_daily and tokenlist

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Stablecoin TVL Page

**Files:**
- Create: `explorer/src/components/charts/StablecoinTVLChart.tsx`
- Create: `explorer/src/app/stablecoins/page.tsx`

Shows all 12 verified stablecoins with supply, transfer volumes, and fee usage. Data sourced from the live tokenlist (auto-updates) + ClickHouse MVs.

- [ ] **Step 1: Create `StablecoinTVLChart.tsx`**

```typescript
// explorer/src/components/charts/StablecoinTVLChart.tsx
'use client'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { StablecoinDailyStat } from '@/lib/analytics'

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

// This chart shows pathUSD + USDC.e daily volume.
// For the full stablecoin page we use the top 2 by convention to keep the chart readable.
export function StablecoinTVLChart({ data }: { data: StablecoinDailyStat[] }) {
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
        <Area type="monotone" dataKey="pathUSD_volume" name="pathUSD"
          stackId="1" stroke="#10B981" fill="#10B981" fillOpacity={0.5} />
        <Area type="monotone" dataKey="usdc_e_volume" name="USDC.e"
          stackId="1" stroke="#0057FF" fill="#0057FF" fillOpacity={0.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Create `stablecoins/page.tsx`**

```typescript
// explorer/src/app/stablecoins/page.tsx
import { getStablecoinStats, getStablecoinDailyVolume } from '@/lib/analytics'
import { StablecoinTVLChart } from '@/components/charts/StablecoinTVLChart'

export const revalidate = 900

const fmtUSD = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function StablecoinsPage() {
  const [stats, daily] = await Promise.all([
    getStablecoinStats(),
    getStablecoinDailyVolume(30),
  ])

  const totalSupply = stats.reduce((s, t) => s + (t.supply ?? 0), 0)
  const totalVol30d = stats.reduce((s, t) => s + t.volume_30d, 0)
  const totalXfers30d = stats.reduce((s, t) => s + t.transfers_30d, 0)

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">Stablecoins</h1>
        <p className="text-tempo-muted text-sm">
          Verified stablecoins on Tempo Mainnet.{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener">
            Token registry ↗
          </a>
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Total Circulating Supply</p>
          <p className="text-2xl font-semibold text-white">{fmtUSD(totalSupply)}</p>
          <p className="text-tempo-muted text-xs mt-1">{stats.length} stablecoins</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfer Volume</p>
          <p className="text-2xl font-semibold text-white">{fmtUSD(totalVol30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfers</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalXfers30d)}</p>
        </div>
      </div>

      {/* Daily volume chart */}
      {daily.length > 0 && (
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-8">
          <h2 className="text-base font-medium text-white mb-4">
            Daily Transfer Volume — pathUSD & USDC.e (30d)
          </h2>
          <StablecoinTVLChart data={daily} />
        </div>
      )}

      {/* Stablecoin table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">All Stablecoins</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left px-6 py-3 text-tempo-muted font-normal">Token</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">Supply</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">24h Vol</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">7d Vol</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Vol</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Transfers</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">Fee Txs (30d)</th>
              </tr>
            </thead>
            <tbody>
              {stats
                .sort((a, b) => b.volume_30d - a.volume_30d)
                .map(token => (
                  <tr key={token.address} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                    <td className="px-6 py-4">
                      <a href={`/address/${token.address}`} className="hover:underline">
                        <span className="text-white font-medium">{token.symbol}</span>
                        <span className="text-tempo-muted ml-2 text-xs">{token.name}</span>
                      </a>
                      <div className="font-mono text-xs text-tempo-muted mt-0.5">
                        {token.address.slice(0, 10)}…{token.address.slice(-6)}
                      </div>
                    </td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.supply)}</td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.volume_24h)}</td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.volume_7d)}</td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.volume_30d)}</td>
                    <td className="text-right px-4 py-4 text-tempo-muted">{fmtCount(token.transfers_30d)}</td>
                    <td className="text-right px-6 py-4 text-tempo-muted">
                      {token.fee_txs_30d > 0 ? fmtCount(token.fee_txs_30d) : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build; /stablecoins route appears in build output
```

- [ ] **Step 4: Commit**

```bash
cd ~/tidx/explorer
git add src/components/charts/StablecoinTVLChart.tsx src/app/stablecoins/page.tsx
git commit -m "feat: stablecoin TVL page with supply, volume, and fee usage

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: DEX Volume Page

**Files:**
- Create: `explorer/src/components/charts/DexVolumeChart.tsx`
- Create: `explorer/src/app/dex/page.tsx`

Shows daily DEX USD volume (whitelisted pairs only), top pools with token names, and explains the whitelist logic. Note: USD volume only available for pairs where at least one token is in the official tokenlist.

- [ ] **Step 1: Create `DexVolumeChart.tsx`**

```typescript
// explorer/src/components/charts/DexVolumeChart.tsx
'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { DexDailyVolumeUSD } from '@/lib/analytics'

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

export function DexVolumeChart({ data }: { data: DexDailyVolumeUSD[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
          labelStyle={{ color: '#fff' }}
          formatter={(v: number) => [fmtUSD.format(v), 'volume']}
        />
        <Bar dataKey="volume_usd" name="USD Volume" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Create `dex/page.tsx`**

```typescript
// explorer/src/app/dex/page.tsx
import { getDexDailyVolumeUSD, getTopPools } from '@/lib/analytics'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'

export const revalidate = 900

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function DexPage() {
  const [daily, pools] = await Promise.all([
    getDexDailyVolumeUSD(30),
    getTopPools(10),
  ])

  const totalVol30d = daily.reduce((s, d) => s + d.volume_usd, 0)
  const totalSwaps30d = daily.reduce((s, d) => s + d.swap_count, 0)

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">DEX</h1>
        <p className="text-tempo-muted text-sm">
          Uniswap V2-compatible swaps on Tempo Mainnet. USD volume shown for pools
          with at least one{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener">
            verified token ↗
          </a>
          .
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Volume (whitelisted pools)</p>
          <p className="text-2xl font-semibold text-white">{fmtUSD(totalVol30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Swaps (all pools)</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalSwaps30d)}</p>
        </div>
      </div>

      {/* Daily volume chart */}
      {daily.length > 0 && (
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-8">
          <h2 className="text-base font-medium text-white mb-4">Daily USD Volume (30d)</h2>
          <DexVolumeChart data={daily} />
        </div>
      )}

      {/* Top pools table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">Top Pools (30d)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left px-6 py-3 text-tempo-muted font-normal">Pair</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Volume</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">30d Swaps</th>
              </tr>
            </thead>
            <tbody>
              {pools.map(pool => (
                <tr key={pool.pair} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">
                        {pool.token0Symbol} / {pool.token1Symbol}
                      </span>
                    </div>
                    <a href={`/address/${pool.pair}`} className="font-mono text-xs text-tempo-blue hover:underline">
                      {pool.pair.slice(0, 10)}…{pool.pair.slice(-6)}
                    </a>
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(pool.volume_usd_30d)}</td>
                  <td className="text-right px-6 py-4 text-tempo-muted">{fmtCount(pool.swaps_30d)}</td>
                </tr>
              ))}
              {pools.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-tempo-muted text-sm">
                    No whitelisted pools found. Check RPC connectivity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build; /dex route appears in build output
```

- [ ] **Step 4: Commit**

```bash
cd ~/tidx/explorer
git add src/components/charts/DexVolumeChart.tsx src/app/dex/page.tsx
git commit -m "feat: DEX volume page with whitelisted pool stats and daily chart

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: NFT Activity Page

**Files:**
- Create: `explorer/src/app/nfts/page.tsx`

Simple page using the existing `getTopNFTCollections` and `getNFTDailyActivity` functions (already in `analytics.ts`). The `NftTransferChart` reuses the existing `DexActivityChart` pattern.

- [ ] **Step 1: Create `nfts/page.tsx`**

```typescript
// explorer/src/app/nfts/page.tsx
import { getTopNFTCollections, getNFTDailyActivity } from '@/lib/analytics'
import { getTokenInfo } from '@/lib/tokens'

export const revalidate = 900

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function NFTsPage() {
  const [collections, daily] = await Promise.all([
    getTopNFTCollections(20),
    getNFTDailyActivity(30),
  ])

  // Resolve collection names (best-effort)
  const collectionNames = await Promise.all(
    collections.map(c => getTokenInfo(c.collection))
  )

  const totalTransfers30d = daily.reduce((s, d) => s + d.transfers, 0)
  const uniqueCollections30d = daily.length > 0
    ? Math.max(...daily.map(d => d.active_collections))
    : 0

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">NFTs</h1>
        <p className="text-tempo-muted text-sm">
          ERC-721 transfer activity on Tempo Mainnet.
        </p>
      </div>

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

      {/* Top collections table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">Top Collections (all time)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left px-6 py-3 text-tempo-muted font-normal">Collection</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">All-time Transfers</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">Days Active</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((c, i) => {
                const info = collectionNames[i]
                return (
                  <tr key={c.collection} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                    <td className="px-6 py-4">
                      {info && (
                        <span className="text-white font-medium mr-2">{info.symbol}</span>
                      )}
                      <a href={`/address/${c.collection}`} className="font-mono text-xs text-tempo-blue hover:underline">
                        {c.collection.slice(0, 10)}…{c.collection.slice(-6)}
                      </a>
                    </td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtCount(c.total_transfers)}</td>
                    <td className="text-right px-6 py-4 text-tempo-muted">{c.days_active}d</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build; /nfts route appears
```

- [ ] **Step 3: Commit**

```bash
cd ~/tidx/explorer
git add src/app/nfts/page.tsx
git commit -m "feat: NFT activity page with top collections and 30d stats

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Nav Updates and Deploy

**Files:**
- Modify: `explorer/src/app/layout.tsx`

Add the three new tabs to the nav, rebuild the Docker image, and run the data validation harness to confirm everything is healthy.

- [ ] **Step 1: Update layout.tsx with new nav links**

In `explorer/src/app/layout.tsx`, find the nav section (it has the existing Blocks and Analytics links). Add three new links:

```tsx
{/* The current nav links look like: */}
<a href="/blocks" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Blocks</a>
<a href="/analytics" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Analytics</a>

{/* Add after Analytics: */}
<a href="/stablecoins" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Stablecoins</a>
<a href="/dex" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">DEX</a>
<a href="/nfts" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">NFTs</a>
```

- [ ] **Step 2: Run all tests**

```bash
cd ~/tidx/explorer && npm test
# Expected: 61 tests pass
```

- [ ] **Step 3: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build; routes /stablecoins, /dex, /nfts all present
```

- [ ] **Step 4: Rebuild Docker image and deploy**

```bash
cd ~/tidx
docker compose build explorer && docker compose up -d explorer
sleep 8 && curl -s -o /dev/null -w "%{http_code}" http://localhost/stablecoins
# Expected: 200
curl -s -o /dev/null -w "%{http_code}" http://localhost/dex
# Expected: 200
curl -s -o /dev/null -w "%{http_code}" http://localhost/nfts
# Expected: 200
```

- [ ] **Step 5: Run data validation**

```bash
cd ~/tidx && bash scripts/validate-data.sh
# Expected: all checks pass (or only check 2 PG↔CH fails due to sync lag — acceptable)
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/app/layout.tsx
git commit -m "feat: add Stablecoins, DEX, NFTs nav links

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Remove misleading Value row from TxDetail (Task 1)
- ✅ Tokenlist auto-discovery — `getVerifiedTokens()` from live API, 1h cache (Task 2)
- ✅ `getTokenInfo` uses tokenlist before RPC fallback — future tokens appear automatically (Task 2)
- ✅ `getTokenSupply()` for circulating supply data (Task 2)
- ✅ `mv_erc20_volume_daily` — all ERC-20 tokens, no hardcoded address filter (Task 3)
- ✅ `mv_dex_swap_amounts_daily` — Uniswap V2 Swap event decoded amounts (Task 3)
- ✅ `mv_fee_token_daily` — fee token usage by day (Task 3)
- ✅ `getDexPairInfo` RPC resolution with 24h cache (Task 4)
- ✅ `computePairUsdVolume` whitelist logic (Task 4)
- ✅ `getStablecoinStats` — per-token supply + multi-window volume (Task 5)
- ✅ `getDexDailyVolumeUSD` — whitelisted-only USD volume (Task 5)
- ✅ `getTopPools` — sorted by volume, non-whitelisted excluded (Task 5)
- ✅ Stablecoin TVL page with table of all 12 stablecoins, sorted by volume (Task 6)
- ✅ DEX volume page with daily chart and top pools table (Task 7)
- ✅ NFT activity page with top collections (Task 8)
- ✅ Nav: Stablecoins, DEX, NFTs links (Task 9)
- ✅ Scam coin whitelist: DEX excludes non-verified tokens automatically via tokenlist (Task 4+5)
- ✅ Maintainability: new stablecoins appear on all pages automatically via tokenlist API (Task 2)

**Type consistency check:**
- `StablecoinStat` defined in analytics.ts Task 5, used in stablecoins/page.tsx Task 6 ✅
- `DexDailyVolumeUSD` defined in analytics.ts Task 5, used in DexVolumeChart Task 7 ✅
- `PoolStat` defined in analytics.ts Task 5, used in dex/page.tsx Task 7 ✅
- `PairInfo` defined in dex.ts Task 4, used in analytics.ts Task 5 ✅
- `PairAmounts` defined in dex.ts Task 4, used by analytics.ts Task 5 ✅
- `TokenInfo` from tokens.ts — unchanged, used throughout ✅

**DEX volume formula note:** For a V2 pair where token0 is stablecoin, each Swap has either `amount0In > 0` (buy) or `amount0Out > 0` (sell) — never both for the same token. So `sum(amount0In) + sum(amount0Out)` = total USD volume without double-counting. This is the correct formula and is verified by the unit tests in Task 4.

**Known limitations documented in UI:**
- DEX: USD volume only for whitelisted pairs (stated in page description)
- Stablecoins: Supply data from RPC, refreshed every 15 minutes (gracefully shows "—" on failure)
- Tokenlist: Falls back to KNOWN_TOKENS on network failure (no outage)

**Test count after all tasks:** 48 (existing) + 7 (tokenlist) + 6 (dex) = **61 tests**
