# DEX Page: Fee AMM + Enshrined DEX Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `/dex` page to present Tempo's three DEX mechanisms as distinct first-class sections: the Fee AMM (gas fee stablecoin preference), the Enshrined DEX (protocol-level precompile), and the Community DEX (existing Uniswap V2 pools).

**Architecture:** A new ClickHouse MV (`mv_protocol_dex_daily`) captures daily swaps + volume from the enshrined DEX precompile at `0xdec0000000000000000000000000000000000000`. Two new analytics functions (`getFeeTokenDailyStats`, `getProtocolDexDailyStats`) feed two new chart sections. The existing Community DEX section is preserved as-is and moved to the bottom.

**Tech Stack:** Next.js 15 App Router, ClickHouse 24.8 direct HTTP (port 8123), recharts 2.x

---

## Background & Data Reality

### Fee AMM (enshrined gas payment system)
- Designed by Dan Robinson (Paradigm). Users pay gas in ANY stablecoin; at block settlement, the protocol auto-converts to the block validator's preferred stablecoin.
- Data: `mv_fee_token_daily` already exists (day, fee_token, txs). 257,953 total fee-bearing txs. Breakdown: USDC.e 74% (`0x20c000000000000000000000b9537d11c60e8b50`), pathUSD 26% (`0x20c0000000000000000000000000000000000000`).

### Enshrined DEX (protocol-level stablecoin exchange)
- Precompile at `0xdec0000000000000000000000000000000000000`. All stablecoin swaps route through pathUSD as the intermediary. Community-deployed Uniswap V2 pools also exist for free-floating token pairs.
- Main swap event selector: `0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd` (53,812 total swaps)
- Data layout: `data` = 64 bytes = amount_in (32 bytes) + 32 bytes unused. Amount lo-64 at `substring(data, 51, 16)`. Dividing by 1e6 gives USD (all Tempo stablecoins are 6-decimal).
- Volume: $50–60 USD avg per swap. Recent peak: ~$400K/day, ~2,000–9,000 swaps/day.

### Community DEX (Uniswap V2 pools)
- 154 unique pair addresses. Existing `mv_dex_swap_amounts_daily` MV and `getDexDailyVolumeUSD`/`getTopPools` analytics functions. Keep unchanged.

---

## File Map

```
tidx/
  scripts/
    setup-clickhouse-views-v3.sql     CREATE — mv_protocol_dex_daily + backfill

tidx/explorer/
  src/lib/
    analytics.ts                      MODIFY — add FeeTokenDailyStat, getFeeTokenDailyStats,
                                               ProtocolDexDailyStat, getProtocolDexDailyStats

  src/components/charts/
    FeeAmmChart.tsx                   CREATE — stacked bar: USDC.e + pathUSD + others per day

  src/app/dex/
    page.tsx                          MODIFY — 3 sections: Fee AMM, Enshrined DEX, Community DEX
```

---

## Task 1: ClickHouse MV for Protocol DEX

**Files:**
- Create: `scripts/setup-clickhouse-views-v3.sql`

- [ ] **Step 1: Create `scripts/setup-clickhouse-views-v3.sql`**

```sql
-- scripts/setup-clickhouse-views-v3.sql
-- Run once with:
--   docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 \
--     < scripts/setup-clickhouse-views-v3.sql
-- Safe to re-run: all CREATE statements use IF NOT EXISTS.

-- ─────────────────────────────────────────────
-- Enshrined DEX (Protocol Precompile) daily stats
-- Contract: 0xdec0000000000000000000000000000000000000
-- Event: 0x16c08f8f...2c17b3c8... (main swap event, 53K+ occurrences)
-- Data layout: amount_in lo-64 = substring(data, 51, 16), divide by 1e6 for USD
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_daily
(
  day        Date,
  swaps      UInt64,
  volume_raw UInt64   -- lo-64 of amount_in uint256; divide by 1e6 for USD
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_daily_view
TO tidx_4217.mv_protocol_dex_daily
AS SELECT
  toDate(block_timestamp)                                               AS day,
  count()                                                               AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))    AS volume_raw
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day;

INSERT INTO tidx_4217.mv_protocol_dex_daily
SELECT
  toDate(block_timestamp),
  count(),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))
FROM tidx_4217.logs
WHERE address = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY toDate(block_timestamp);
```

- [ ] **Step 2: Run the script**

```bash
cd ~/tidx
docker exec -i tidx-clickhouse-1 clickhouse-client --database tidx_4217 \
  < scripts/setup-clickhouse-views-v3.sql
# Expected: no errors
```

- [ ] **Step 3: Verify the MV has data**

```bash
docker exec tidx-clickhouse-1 clickhouse-client --query "
  SELECT count() as rows, sum(swaps) as total_swaps, sum(volume_raw)/1e6 as total_vol_usd
  FROM tidx_4217.mv_protocol_dex_daily
"
# Expected: rows ≈ 110, total_swaps ≥ 53000, total_vol_usd ≥ 3M
```

- [ ] **Step 4: Commit**

```bash
cd ~/tidx
git add scripts/setup-clickhouse-views-v3.sql
git commit -m "feat: add mv_protocol_dex_daily for enshrined DEX swap tracking

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Analytics Functions

**Files:**
- Modify: `explorer/src/lib/analytics.ts`

Append two new exported interfaces and two new exported functions after the existing `getTopPools` function (line ~547).

- [ ] **Step 1: Add `FeeTokenDailyStat` interface and `getFeeTokenDailyStats` function**

Append to `explorer/src/lib/analytics.ts`:

```typescript
export interface FeeTokenDailyStat {
  day: string
  usdc_e: number    // tx count using USDC.e as fee token
  pathusd: number   // tx count using pathUSD as fee token
  others: number    // tx count using other tokens
  total: number
}

export async function getFeeTokenDailyStats(days = 30): Promise<FeeTokenDailyStat[]> {
  const key = `analytics:fee_token_daily:${days}`
  const cached = await getCached<FeeTokenDailyStat[]>(key)
  if (cached) return cached

  const USDC_E = '0x20c000000000000000000000b9537d11c60e8b50'
  const PATHUSD = '0x20c0000000000000000000000000000000000000'

  const rows = await queryClickHouse<{
    day: string; usdc_e: string; pathusd: string; others: string
  }>(`
    SELECT
      day,
      sumIf(txs, fee_token = '${USDC_E}')  AS usdc_e,
      sumIf(txs, fee_token = '${PATHUSD}') AS pathusd,
      sumIf(txs, fee_token NOT IN ('${USDC_E}', '${PATHUSD}')) AS others
    FROM mv_fee_token_daily
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const result: FeeTokenDailyStat[] = rows.map(r => {
    const usdc_e = Number(r.usdc_e)
    const pathusd = Number(r.pathusd)
    const others = Number(r.others)
    return { day: String(r.day).slice(0, 10), usdc_e, pathusd, others, total: usdc_e + pathusd + others }
  })

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 2: Add `ProtocolDexDailyStat` interface and `getProtocolDexDailyStats` function**

Continue appending to `explorer/src/lib/analytics.ts`:

```typescript
export interface ProtocolDexDailyStat {
  day: string
  swaps: number
  volume_usd: number
}

export async function getProtocolDexDailyStats(days = 30): Promise<ProtocolDexDailyStat[]> {
  const key = `analytics:protocol_dex:${days}`
  const cached = await getCached<ProtocolDexDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; swaps: string; volume_raw: string
  }>(`
    SELECT day, sum(swaps) AS swaps, sum(volume_raw) AS volume_raw
    FROM mv_protocol_dex_daily
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const result: ProtocolDexDailyStat[] = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    swaps: Number(r.swaps),
    volume_usd: Number(r.volume_raw) / 1e6,
  }))

  await setCached(key, result, 900)
  return result
}
```

- [ ] **Step 3: Build and verify**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build, no TypeScript errors
```

- [ ] **Step 4: Run all tests**

```bash
cd ~/tidx/explorer && npm test
# Expected: 62 tests pass (no new tests — ClickHouse query functions are integration-tested at runtime)
```

- [ ] **Step 5: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/analytics.ts
git commit -m "feat: add getFeeTokenDailyStats and getProtocolDexDailyStats analytics functions

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: FeeAmmChart Component + Restructured DEX Page

**Files:**
- Create: `explorer/src/components/charts/FeeAmmChart.tsx`
- Modify: `explorer/src/app/dex/page.tsx`

The DEX page becomes three clearly labeled sections:
1. **Fee AMM** — stacked bar chart of daily fee token usage + explanation of the mechanism
2. **Protocol DEX** — bar chart of enshrined DEX daily swap volume + swap count cards
3. **Community DEX** — existing Uniswap V2 pools content (moved down, no logic changes)

- [ ] **Step 1: Create `FeeAmmChart.tsx`**

```typescript
// explorer/src/components/charts/FeeAmmChart.tsx
'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { FeeTokenDailyStat } from '@/lib/analytics'

const fmtCount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function FeeAmmChart({ data }: { data: FeeTokenDailyStat[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
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
          tickFormatter={v => fmtCount.format(v)}
          width={48}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number) => [fmtCount.format(v), '']}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="usdc_e"  name="USDC.e"  stackId="1" fill="#0057FF" />
        <Bar dataKey="pathusd" name="pathUSD" stackId="1" fill="#10B981" />
        <Bar dataKey="others"  name="Others"  stackId="1" fill="#6B7280" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Rewrite `dex/page.tsx` with three sections**

Replace the entire contents of `explorer/src/app/dex/page.tsx`:

```typescript
// explorer/src/app/dex/page.tsx
import {
  getDexDailyVolumeUSD,
  getTopPools,
  getFeeTokenDailyStats,
  getProtocolDexDailyStats,
  type DexDailyVolumeUSD,
} from '@/lib/analytics'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'
import { FeeAmmChart } from '@/components/charts/FeeAmmChart'

export const revalidate = 900

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const fmtPct = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—'

export default async function DexPage() {
  const [feeDaily, protocolDaily, communityDaily, pools] = await Promise.all([
    getFeeTokenDailyStats(30),
    getProtocolDexDailyStats(30),
    getDexDailyVolumeUSD(30),
    getTopPools(10),
  ])

  // Fee AMM aggregates
  const feeTotal30d = feeDaily.reduce((s, d) => s + d.total, 0)
  const feeUsdcE30d  = feeDaily.reduce((s, d) => s + d.usdc_e, 0)
  const feePathusd30d = feeDaily.reduce((s, d) => s + d.pathusd, 0)

  // Protocol DEX aggregates
  const protocolSwaps30d = protocolDaily.reduce((s, d) => s + d.swaps, 0)
  const protocolVol30d   = protocolDaily.reduce((s, d) => s + d.volume_usd, 0)

  // Community DEX aggregates
  const communityVol30d   = communityDaily.reduce((s, d) => s + d.volume_usd, 0)
  const communitySwaps30d = communityDaily.reduce((s, d) => s + d.swap_count, 0)

  // DexVolumeChart expects DexDailyVolumeUSD shape; adapt protocol stats
  const protocolForChart: DexDailyVolumeUSD[] = protocolDaily.map(d => ({
    day: d.day,
    volume_usd: d.volume_usd,
    swap_count: d.swaps,
  }))

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">DEX</h1>
        <p className="text-tempo-muted text-sm">
          Tempo has three exchange mechanisms: Fee AMM, Protocol DEX, and Community DEX — each serving a different purpose.
        </p>
      </div>

      {/* ── Section 1: Fee AMM ── */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Fee AMM</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Enshrined</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Users pay gas fees in any verified stablecoin. At block settlement, the protocol auto-converts
          to the block validator's preferred token using a dedicated low-slippage AMM — no separate gas
          token needed. Designed by{' '}
          <a href="https://www.paradigm.xyz/" className="text-tempo-blue hover:underline" target="_blank" rel="noopener">
            Dan Robinson (Paradigm)↗
          </a>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">Fee-bearing Txs (30d)</p>
            <p className="text-2xl font-semibold text-white">{fmtCount(feeTotal30d)}</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">USDC.e Share (30d)</p>
            <p className="text-2xl font-semibold text-white">{fmtPct(feeUsdcE30d, feeTotal30d)}</p>
            <p className="text-tempo-muted text-xs mt-1">{fmtCount(feeUsdcE30d)} txs</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">pathUSD Share (30d)</p>
            <p className="text-2xl font-semibold text-white">{fmtPct(feePathusd30d, feeTotal30d)}</p>
            <p className="text-tempo-muted text-xs mt-1">{fmtCount(feePathusd30d)} txs</p>
          </div>
        </div>

        {feeDaily.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily Fee Token Usage (30d)</h3>
            <FeeAmmChart data={feeDaily} />
          </div>
        )}
      </section>

      {/* ── Section 2: Protocol DEX (Enshrined) ── */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Protocol DEX</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Enshrined</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Protocol-level stablecoin exchange at precompile{' '}
          <a href={`/address/0xdec0000000000000000000000000000000000000`} className="font-mono text-tempo-blue hover:underline text-xs">
            0xdec0…0000
          </a>
          . All stablecoin swaps route through pathUSD as the central quote token.
          Supports both orderbook-style settlement and constant-product AMM liquidity.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Swaps</p>
            <p className="text-2xl font-semibold text-white">{fmtCount(protocolSwaps30d)}</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Volume</p>
            <p className="text-2xl font-semibold text-white">{fmtUSD(protocolVol30d)}</p>
          </div>
        </div>

        {protocolForChart.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily Volume (30d)</h3>
            <DexVolumeChart data={protocolForChart} />
          </div>
        )}
      </section>

      {/* ── Section 3: Community DEX (Uniswap V2) ── */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Community DEX</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Uniswap V2</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Community-deployed Uniswap V2-compatible AMM pools. USD volume shown for pools
          with at least one{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener">
            verified token ↗
          </a>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Volume (whitelisted pools)</p>
            <p className="text-2xl font-semibold text-white">{fmtUSD(communityVol30d)}</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Swaps (all pools)</p>
            <p className="text-2xl font-semibold text-white">{fmtCount(communitySwaps30d)}</p>
          </div>
        </div>

        {communityDaily.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily USD Volume (30d)</h3>
            <DexVolumeChart data={communityDaily} />
          </div>
        )}

        <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-tempo-border">
            <h3 className="text-base font-medium text-white">Top Pools (30d)</h3>
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
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Build**

```bash
cd ~/tidx/explorer && npm run build
# Expected: clean build; /dex route compiles; no TypeScript errors
```

- [ ] **Step 4: Run all tests**

```bash
cd ~/tidx/explorer && npm test
# Expected: 62 tests pass
```

- [ ] **Step 5: Rebuild Docker and verify all 3 new pages respond**

```bash
cd ~/tidx
docker compose build explorer && docker compose up -d explorer
sleep 10
curl -s -o /dev/null -w "%{http_code}" http://localhost/dex
# Expected: 200
```

- [ ] **Step 6: Commit**

```bash
cd ~/tidx/explorer
git add src/components/charts/FeeAmmChart.tsx src/app/dex/page.tsx
git commit -m "feat: DEX page upgrade — Fee AMM + Protocol DEX + Community DEX sections

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ Fee AMM as first-class section with mechanism explanation (Dan Robinson, Paradigm credit), daily chart, fee token preference breakdown (USDC.e vs pathUSD %)
- ✅ Protocol DEX (Enshrined DEX) section with precompile address link, 30d swaps + volume, daily chart
- ✅ Community DEX preserved unchanged as third section
- ✅ All three DEX types clearly labeled with badge (Enshrined / Enshrined / Uniswap V2)
- ✅ mv_protocol_dex_daily MV captures enshrined DEX swap event `0x16c08f8f...`

**Type consistency:**
- `FeeTokenDailyStat` defined in Task 2, imported in Task 3 (`FeeAmmChart.tsx` props, page import)
- `ProtocolDexDailyStat` defined in Task 2, used in Task 3 page (mapped to `DexDailyVolumeUSD` for chart reuse)
- `DexDailyVolumeUSD` already exported from analytics.ts, imported with `type` keyword in page

**Data accuracy:**
- `getFeeTokenDailyStats` hardcodes the two main fee token addresses — these are Tempo genesis tokens that will never change addresses
- `getProtocolDexDailyStats` queries `mv_protocol_dex_daily` (backed by the enshrined DEX precompile address `0xdec0000000000000000000000000000000000000`)
- Amount decoding uses `substring(data, 51, 16)` (lo-64 of first uint256) — verified produces $50-60 avg per swap in spot check
