# DEX TVL + Account DeFi Activity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time TVL to each section of the DEX page, and add a DeFi Activity panel to the address page showing token transfers, DEX swap stats, and LP activity.

**Architecture:** Two separate concerns share one infrastructure module (`lib/defi.ts`): (1) TVL uses RPC `balanceOf` calls on verified stablecoins at the Protocol DEX precompile and community pool addresses; (2) Per-address DeFi analytics query ClickHouse logs using the padded 32-byte topic format (`0x000000000000000000000000` + address). The address page gains a new server-rendered DeFi Activity section below the transaction list.

**Tech Stack:** Next.js 15 App Router, ClickHouse 24.8 direct HTTP (port 8123), viem 2.x publicClient, Redis/ioredis

---

## Background & Data Reality

### Topic padding format (critical for ClickHouse queries)

ERC-20 Transfer topics: `topic1` = `from`, `topic2` = `to` — each stored as 32-byte hex: `0x000000000000000000000000` + 40-char address. To match address `0xabcd...ef12`, query `topic1 = '0x000000000000000000000000abcd...ef12'`.

**Helper:** `const padded = (addr: string) => '0x000000000000000000000000' + addr.toLowerCase().slice(2)`

### Available selectors (verified in ClickHouse)
- ERC-20 Transfer: `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`
- Uniswap V2 Swap: `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822` — topic2=sender, topic3=to (both indexed addresses)
- Protocol DEX Swap: address `0xdec0000000000000000000000000000000000000`, selector `0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd` — topic3=user address
- Uniswap V2 Mint: `0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f` — topic2=sender (971 events)
- Uniswap V2 Burn: `0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496` — topic2=sender, topic3=to (388 events)

### TVL approach
- **Protocol DEX TVL**: `balanceOf(0xdec0..., stablecoin)` for each verified stablecoin (12 calls, sum = total USD held by the enshrined DEX precompile)
- **Community DEX TVL**: For each top pool from `getTopPools`, call `balanceOf(pool_address, stablecoin_side)`, multiply result ×2 (Uniswap V2 invariant: stablecoin side ≈ 50% of pool at equilibrium). Top 10 pools only (performance).

### ClickHouse query performance
- 5.57M total logs rows. Full scan filtering on topic1/topic2 (no primary key index) takes ~1-2s in ClickHouse due to columnar vectorized execution. All per-address queries cache 60s in Redis.

---

## File Map

```
tidx/explorer/
  src/lib/
    defi.ts                        CREATE — TVL queries (RPC), per-address DeFi queries (ClickHouse)

  src/app/dex/
    page.tsx                       MODIFY — add TVL cards to each of the 3 sections

  src/components/
    AddressDefiActivity.tsx        CREATE — DeFi Activity panel for address page

  src/app/address/[addr]/
    page.tsx                       MODIFY — fetch DeFi data + render AddressDefiActivity
```

---

## Task 1: `lib/defi.ts` — TVL + Per-Address DeFi

**Files:**
- Create: `explorer/src/lib/defi.ts`

This module has two responsibilities: (1) TVL queries using RPC balanceOf, (2) per-address DeFi activity queries using ClickHouse.

- [ ] **Step 1: Create `explorer/src/lib/defi.ts`**

```typescript
// explorer/src/lib/defi.ts
import { getCached, setCached } from './cache'
import { queryClickHouse } from './clickhouse'
import { publicClient } from './chain'
import { getStablecoinAddresses } from './tokenlist'
import { getTokenInfo } from './tokens'
import { getDexPairInfo, isWhitelistedPair } from './dex'
import { getTopPools } from './analytics'

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

const BALANCE_OF_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** Pads a 20-byte address to 32-byte topic format used in ClickHouse logs */
function padAddr(addr: string): string {
  return '0x000000000000000000000000' + addr.toLowerCase().slice(2)
}

// ─────────────────────────────────────────────
// TVL
// ─────────────────────────────────────────────

const PROTOCOL_DEX = '0xdec0000000000000000000000000000000000000' as const

export async function getProtocolDexTVL(): Promise<number> {
  const key = 'defi:tvl:protocol_dex'
  const cached = await getCached<number>(key)
  if (cached !== null) return cached

  const stableAddrs = await getStablecoinAddresses()
  const balances = await Promise.allSettled(
    stableAddrs.map(token =>
      publicClient.readContract({
        address: token as `0x${string}`,
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [PROTOCOL_DEX],
      })
    )
  )

  // All Tempo stablecoins are 6-decimal
  const tvl = balances.reduce((sum, r) => {
    if (r.status === 'fulfilled') return sum + Number(r.value) / 1e6
    return sum
  }, 0)

  await setCached(key, tvl, 900) // 15 min
  return tvl
}

export async function getCommunityDexTVL(): Promise<number> {
  const key = 'defi:tvl:community_dex'
  const cached = await getCached<number>(key)
  if (cached !== null) return cached

  const pools = await getTopPools(10)
  let tvl = 0

  for (const pool of pools) {
    // Determine stablecoin side
    const [isT0Stable, isT1Stable] = await Promise.all([
      isWhitelistedPair(pool.token0, pool.token0),
      isWhitelistedPair(pool.token1, pool.token1),
    ])
    const stablecoinToken = isT0Stable ? pool.token0 : isT1Stable ? pool.token1 : null
    if (!stablecoinToken) continue

    try {
      const balance = await publicClient.readContract({
        address: stablecoinToken as `0x${string}`,
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [pool.pair as `0x${string}`],
      })
      // ×2: V2 pool is 50/50, stablecoin side = half the TVL
      tvl += (Number(balance) / 1e6) * 2
    } catch { /* skip pools that fail */ }
  }

  await setCached(key, tvl, 900)
  return tvl
}

// ─────────────────────────────────────────────
// Per-address DeFi activity (ClickHouse)
// ─────────────────────────────────────────────

export interface AddressTransfer {
  block_timestamp: string
  token: string
  token_symbol: string
  direction: 'in' | 'out'
  counterparty: string
  amount_raw: string
  hash: string
}

export interface AddressDefiStats {
  transfers_in: number
  transfers_out: number
  community_swaps: number
  protocol_swaps: number
  lp_adds: number
  lp_removes: number
  recent_transfers: AddressTransfer[]
}

export async function getAddressDefiStats(address: string): Promise<AddressDefiStats> {
  const lower = address.toLowerCase()
  const key = `defi:addr:${lower}`
  const cached = await getCached<AddressDefiStats>(key)
  if (cached) return cached

  const padded = padAddr(lower)
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const SWAP_V2  = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
  const SWAP_PDX = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
  const MINT_V2  = '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f'
  const BURN_V2  = '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496'

  const [transferRows, swapRows, lpRows] = await Promise.all([
    // Last 20 ERC-20 transfers, plus in/out totals
    queryClickHouse<{
      block_timestamp: string; address: string; topic1: string; topic2: string
      data: string; hash: string
    }>(`
      SELECT block_timestamp, address, topic1, topic2,
             substring(data, 1, 66) AS data, hash
      FROM logs
      WHERE selector = '${TRANSFER}'
        AND (topic1 = '${padded}' OR topic2 = '${padded}')
        AND topic3 IS NULL
      ORDER BY block_timestamp DESC
      LIMIT 20
    `),
    // Swap counts: community + protocol DEX
    queryClickHouse<{ community: string; protocol_dex: string }>(`
      SELECT
        countIf(selector = '${SWAP_V2}' AND (topic2 = '${padded}' OR topic3 = '${padded}')) AS community,
        countIf(selector = '${SWAP_PDX}' AND topic3 = '${padded}') AS protocol_dex
      FROM logs
      WHERE (selector = '${SWAP_V2}' AND (topic2 = '${padded}' OR topic3 = '${padded}'))
         OR (selector = '${SWAP_PDX}' AND address = '${PROTOCOL_DEX}' AND topic3 = '${padded}')
    `),
    // LP activity: Mint + Burn events involving address
    queryClickHouse<{ lp_adds: string; lp_removes: string }>(`
      SELECT
        countIf(selector = '${MINT_V2}') AS lp_adds,
        countIf(selector = '${BURN_V2}') AS lp_removes
      FROM logs
      WHERE selector IN ('${MINT_V2}', '${BURN_V2}')
        AND (topic2 = '${padded}' OR topic3 = '${padded}')
    `),
  ])

  // Count transfers in/out
  let transfers_in = 0
  let transfers_out = 0
  for (const r of transferRows) {
    if (r.topic2.toLowerCase() === padded) transfers_in++
    else transfers_out++
  }

  // Resolve token symbols for recent transfers (best-effort)
  const recent_transfers: AddressTransfer[] = await Promise.all(
    transferRows.map(async r => {
      const info = await getTokenInfo(r.address).catch(() => null)
      return {
        block_timestamp: r.block_timestamp,
        token: r.address,
        token_symbol: info?.symbol ?? r.address.slice(-6),
        direction: (r.topic2.toLowerCase() === padded ? 'in' : 'out') as 'in' | 'out',
        counterparty: r.topic2.toLowerCase() === padded
          ? '0x' + r.topic1.slice(-40)
          : '0x' + r.topic2.slice(-40),
        amount_raw: r.data,
        hash: r.hash,
      }
    })
  )

  const swapData = swapRows[0] ?? { community: '0', protocol_dex: '0' }
  const lpData = lpRows[0] ?? { lp_adds: '0', lp_removes: '0' }

  const result: AddressDefiStats = {
    transfers_in,
    transfers_out,
    community_swaps: Number(swapData.community),
    protocol_swaps: Number(swapData.protocol_dex),
    lp_adds: Number(lpData.lp_adds),
    lp_removes: Number(lpData.lp_removes),
    recent_transfers,
  }

  await setCached(key, result, 60)
  return result
}
```

- [ ] **Step 2: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build, no TypeScript errors
```

- [ ] **Step 3: Run all tests**

```bash
cd ~/tidx/explorer && npm test
# Expected: 62 tests pass (no new tests — ClickHouse/RPC functions tested at runtime)
```

- [ ] **Step 4: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/defi.ts
git commit -m "feat: DEX TVL and per-address DeFi analytics module

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Add TVL Cards to DEX Page

**Files:**
- Modify: `explorer/src/app/dex/page.tsx`

Add `getProtocolDexTVL()` and `getCommunityDexTVL()` to the Promise.all. Add a TVL card to the Protocol DEX and Community DEX summary grids respectively.

- [ ] **Step 1: Update `dex/page.tsx`**

The current dex/page.tsx (which is being replaced by the DEX Fee AMM upgrade plan — if that plan has not yet been run, apply these changes to the current version of the file).

**Add import:**
```typescript
import { getProtocolDexTVL, getCommunityDexTVL } from '@/lib/defi'
```

**Expand Promise.all to include TVL fetches** (add alongside existing calls):
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

**Note:** If the DEX Fee AMM upgrade plan (from `2026-04-07-dex-fee-amm-upgrade.md`) has NOT been applied yet, the page only calls `getDexDailyVolumeUSD` and `getTopPools`. Add the TVL calls alongside those too:
```typescript
const [communityDaily, pools, communityTVL] = await Promise.all([
  getDexDailyVolumeUSD(30),
  getTopPools(10),
  getCommunityDexTVL(),
])
```

**Add TVL cards:** In the Protocol DEX summary grid (if Fee AMM upgrade applied), add:
```tsx
<div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
  <p className="text-tempo-muted text-xs mb-1">TVL</p>
  <p className="text-2xl font-semibold text-white">{fmtUSD(protocolTVL)}</p>
  <p className="text-tempo-muted text-xs mt-1">stablecoins held by precompile</p>
</div>
```

In the Community DEX summary grid, add:
```tsx
<div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
  <p className="text-tempo-muted text-xs mb-1">TVL</p>
  <p className="text-2xl font-semibold text-white">{fmtUSD(communityTVL)}</p>
  <p className="text-tempo-muted text-xs mt-1">top 10 pools, stablecoin-side ×2</p>
</div>
```

**IMPORTANT:** Read the current state of `explorer/src/app/dex/page.tsx` before making changes to understand exactly which grid to modify.

- [ ] **Step 2: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 3: Commit**

```bash
cd ~/tidx/explorer
git add src/app/dex/page.tsx
git commit -m "feat: add TVL cards to Protocol DEX and Community DEX sections

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `AddressDefiActivity` Component

**Files:**
- Create: `explorer/src/components/AddressDefiActivity.tsx`

Server component (no 'use client') — renders the DeFi stats returned by `getAddressDefiStats`. Shows a summary row, then a token transfers table.

- [ ] **Step 1: Create `AddressDefiActivity.tsx`**

```typescript
// explorer/src/components/AddressDefiActivity.tsx
import type { AddressDefiStats } from '@/lib/defi'

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const fmtTimestamp = (ts: string) => new Date(ts).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function AddressDefiActivity({
  stats,
  address,
}: {
  stats: AddressDefiStats
  address: string
}) {
  const totalSwaps = stats.community_swaps + stats.protocol_swaps
  const hasActivity =
    stats.transfers_in + stats.transfers_out + totalSwaps + stats.lp_adds + stats.lp_removes > 0

  if (!hasActivity) return null

  return (
    <div className="mt-8">
      <h2 className="text-lg font-medium text-white mb-4">DeFi Activity</h2>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(stats.transfers_in + stats.transfers_out) > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-4">
            <p className="text-tempo-muted text-xs mb-1">Token Transfers</p>
            <p className="text-xl font-semibold text-white">
              {fmtCount(stats.transfers_in + stats.transfers_out)}
            </p>
            <p className="text-tempo-muted text-xs mt-1">
              {fmtCount(stats.transfers_in)} in · {fmtCount(stats.transfers_out)} out
            </p>
          </div>
        )}
        {totalSwaps > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-4">
            <p className="text-tempo-muted text-xs mb-1">DEX Swaps</p>
            <p className="text-xl font-semibold text-white">{fmtCount(totalSwaps)}</p>
            <p className="text-tempo-muted text-xs mt-1">
              {stats.protocol_swaps > 0 && `${fmtCount(stats.protocol_swaps)} protocol`}
              {stats.protocol_swaps > 0 && stats.community_swaps > 0 && ' · '}
              {stats.community_swaps > 0 && `${fmtCount(stats.community_swaps)} community`}
            </p>
          </div>
        )}
        {(stats.lp_adds + stats.lp_removes) > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-4">
            <p className="text-tempo-muted text-xs mb-1">LP Activity</p>
            <p className="text-xl font-semibold text-white">
              {fmtCount(stats.lp_adds + stats.lp_removes)}
            </p>
            <p className="text-tempo-muted text-xs mt-1">
              {stats.lp_adds > 0 && `${fmtCount(stats.lp_adds)} adds`}
              {stats.lp_adds > 0 && stats.lp_removes > 0 && ' · '}
              {stats.lp_removes > 0 && `${fmtCount(stats.lp_removes)} removes`}
            </p>
          </div>
        )}
      </div>

      {/* Recent token transfers table */}
      {stats.recent_transfers.length > 0 && (
        <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-tempo-border">
            <h3 className="text-sm font-medium text-white">Recent Token Transfers</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tempo-border">
                  <th className="text-left px-6 py-3 text-tempo-muted font-normal">Time</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-normal">Token</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-normal">Direction</th>
                  <th className="text-left px-6 py-3 text-tempo-muted font-normal">Counterparty</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_transfers.map((t, i) => (
                  <tr key={`${t.hash}-${i}`} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                    <td className="px-6 py-3 text-tempo-muted text-xs">
                      {fmtTimestamp(t.block_timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <a href={`/address/${t.token}`} className="text-tempo-blue hover:underline font-medium">
                        {t.token_symbol}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        t.direction === 'in'
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }`}>
                        {t.direction === 'in' ? '↓ in' : '↑ out'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <a href={`/address/${t.counterparty}`} className="font-mono text-xs text-tempo-blue hover:underline">
                        {t.counterparty.slice(0, 10)}…{t.counterparty.slice(-6)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 3: Commit**

```bash
cd ~/tidx/explorer
git add src/components/AddressDefiActivity.tsx
git commit -m "feat: AddressDefiActivity component for per-address DeFi stats

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Wire DeFi Activity into Address Page

**Files:**
- Modify: `explorer/src/app/address/[addr]/page.tsx`

Add `getAddressDefiStats` call to the existing `getAddressData` function and render `AddressDefiActivity` below the tx list.

- [ ] **Step 1: Read the current address page**

Read `explorer/src/app/address/[addr]/page.tsx` in full before making changes.

The current file uses `queryTidx` (PostgreSQL via tidx API) for tx data. We add one ClickHouse query via `getAddressDefiStats` from `lib/defi.ts` alongside it.

- [ ] **Step 2: Update `page.tsx`**

**Add import at top:**
```typescript
import { getAddressDefiStats, type AddressDefiStats } from '@/lib/defi'
import { AddressDefiActivity } from '@/components/AddressDefiActivity'
```

**Expand the `getAddressData` function** to also call `getAddressDefiStats` in parallel:

```typescript
// Inside getAddressData, after the existing Promise.all call, add:
const defiStats = await getAddressDefiStats(lowerAddr)

const data = {
  txs: txResult.rows,
  stats: {
    ...statsResult.rows[0],
    sponsored_others: sponsoredResult.rows[0]?.count ?? 0,
  },
  defi: defiStats,
}
await setCached(key, data, 60)
return data
```

**Render `AddressDefiActivity` in the page JSX** after the existing `<AddressTxList>`:

```tsx
// After: <AddressTxList txs={...} address={addr} />
// Add:
<AddressDefiActivity
  stats={data.defi as AddressDefiStats}
  address={addr}
/>
```

**Update the TypeScript type for cached data** — the `getCached<{ txs: unknown[]; stats: unknown }>` type should be extended. Since the cache is internal and typed at runtime, just add `defi: unknown` or cast when rendering. The simplest approach: cast `data.defi` with `as AddressDefiStats` when passing to the component (as shown above).

- [ ] **Step 3: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build
```

- [ ] **Step 4: Run all tests**

```bash
cd ~/tidx/explorer && npm test
# Expected: 62 tests pass
```

- [ ] **Step 5: Rebuild Docker and verify**

```bash
cd ~/tidx
docker compose build explorer && docker compose up -d explorer
sleep 10
# Test with a known active address
curl -s -o /dev/null -w "%{http_code}" http://localhost/address/0x23570d4b18e1dbef58d8314d6bfc67092ba12d8c
# Expected: 200
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/app/address/[addr]/page.tsx
git commit -m "feat: add DeFi Activity panel to address page (transfers, swaps, LP)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ DEX liquidity (TVL) shown on DEX page — Protocol DEX TVL (balanceOf for all stablecoins) + Community DEX TVL (top 10 pools, stablecoin-side ×2)
- ✅ Account token transfers — recent 20, with token symbol, direction, counterparty
- ✅ Account DEX swaps — community + protocol DEX swap counts
- ✅ Account LP activity — Mint/Burn event counts (lp_adds, lp_removes)
- ✅ DeFi panel only shown when address has activity (null-guarded, returns null if no activity)

**Type consistency:**
- `AddressDefiStats` defined in defi.ts Task 1, used in AddressDefiActivity.tsx Task 3, imported in address page Task 4
- `AddressTransfer` defined in defi.ts, used inside AddressDefiStats as `recent_transfers: AddressTransfer[]`
- `getProtocolDexTVL` / `getCommunityDexTVL` defined in defi.ts, imported in dex/page.tsx Task 2

**Data correctness notes:**
- `isWhitelistedPair(token, token)` in getCommunityDexTVL: checks if a single address is verified — this works because isWhitelistedPair returns `isVerifiedToken(t0) || isVerifiedToken(t1)`, so passing the same address twice checks if it's verified
- Topic padding: `padAddr('0xabcd...ef12')` = `'0x000000000000000000000000abcd...ef12'` (removes 0x, prepends 24 zeros) — verified matches the stored format in ClickHouse (tested in research)
- Community DEX TVL ×2 multiplier: assumes 50/50 pool balance (Uniswap V2 invariant near equilibrium). This is an estimate, clearly labeled in the UI ("stablecoin-side ×2")
- Transfer direction detection: `topic2 === padded` → 'in' (recipient), else → 'out' (sender) — correct for ERC-20 Transfer where topic1=from, topic2=to
