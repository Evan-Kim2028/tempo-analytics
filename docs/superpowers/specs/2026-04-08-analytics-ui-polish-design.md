# Tempo Analytics UI Polish — Design Spec

**Date:** 2026-04-08
**Scope:** Analytics/Overview page, Stablecoins page, DEX page

---

## Goals

- Restructure the Analytics page into a curated Overview that surfaces key stats from Stablecoins and DEX
- Polish the Stablecoins and DEX deep-dive pages (simplicity theme, chart cleanup)
- Add loading skeletons so pages never show a blank screen while data fetches
- Fix a mislabeled chart and replace it with a real historical supply chart backed by a new ClickHouse view
- Remove redundant charts
- Small cross-cutting cleanup (stat card consistency, stale comments, nav label)

Out of scope: Home, Blocks, NFTs, and all detail pages (address/block/tx). No streaming/Suspense, no date range pickers, no new navigation structure beyond the label rename.

---

## 1. Navigation

Rename the "Analytics" nav link to "Overview" in `src/app/layout.tsx`.

Final nav order: Home / Blocks / Overview / Stablecoins / DEX / NFTs

---

## 2. Overview Page (`/app/analytics/page.tsx`)

Replace the current 9-chart analytics dump with four focused sections. Each section has stat cards, one chart, and a link to the relevant deep-dive page. No other content.

### Section order

1. **AA Features**
   - Stat cards: Batch Call Txs (30d), Sponsored Txs (30d)
   - Chart: existing `TempoFeaturesChart` (grouped bar: batch vs sponsored daily)
   - No deep-dive link (AA stats live only here)

2. **Stablecoins**
   - Stat cards: Total Circulating Supply, 30d Transfer Volume, 30d Transfers
   - Chart: existing `StablecoinVolumeChart` (pathUSD & USDC.e daily volume line)
   - Link: "View Stablecoins →" to `/stablecoins`

3. **Protocol DEX** (enshrined)
   - Stat cards: 30d Swaps, 30d Volume, TVL
   - Chart: `DexVolumeChart` in purple accent
   - Link: "View DEX →" to `/dex`

4. **Community DEX**
   - Stat cards: 30d Volume, 30d Swaps
   - Chart: `DexVolumeChart` in blue accent
   - Link: "View DEX →" to `/dex`

### Dropped from current Analytics page

- Signature type pie chart
- Transaction category breakdown (user/inscriptions/protocol stacked area)
- Inscriptions chart
- NFT activity stats
- Data export section
- 30-day activity line chart (total txs / unique senders)

These are either low-signal for this audience or belong on their own pages.

---

## 3. Stablecoins Page (`/app/stablecoins/page.tsx`)

### New: Historical Supply Chart

Replace `StablecoinTVLChart` (which shows volume, not TVL — a mislabeled duplicate) with a new `StablecoinSupplyChart` component showing circulating supply per stablecoin over the last 30 days.

**Data source:** New ClickHouse materialized view `mv_stablecoin_supply_daily`.

**View logic:**
- Source table: `tidx_4217.logs`
- Mints: Transfer events where `topic1` = zero address (`0x000…000`) (from = zero)
- Burns: Transfer events where `topic2` = zero address (to = zero)
- Filter: whitelisted stablecoin addresses only (pathUSD + USDC.e initially; extensible)
- Output columns: `day Date`, `token String`, `net_raw Int64` (mints minus burns in raw uint64 units)
- Engine: `SummingMergeTree ORDER BY (day, token)`

**App-layer query (`getStablecoinSupplyHistory`):**
- Fetch daily net changes for the last N days
- Compute cumulative sum per token to derive supply at each day
- Divide raw values by `1e6` (6 decimals for both pathUSD and USDC.e)
- Returns: `{ day: string, pathUSD: number, usdc_e: number }[]`

**Chart:** Stacked area, same styling as existing charts. Y-axis in compact USD notation. Two series: pathUSD (green) and USDC.e (blue).

### Existing content

Keep as-is: summary stat cards, daily volume chart (`StablecoinVolumeChart`), full stablecoin table.

The `StablecoinTVLChart` component file is deleted.

---

## 4. DEX Page (`/app/dex/page.tsx`)

### Chart cleanup

- **Remove `DexActivityChart`** — daily swap counts are already visible in the `DexVolumeChart` tooltip. The standalone swap count chart is redundant.
- **Protocol DEX chart** — add an optional `color` prop to `DexVolumeChart` (default: existing blue `#0057FF`). Pass `color="#8B5CF6"` for Protocol DEX.
- **Community DEX chart** — uses `DexVolumeChart` with no color prop (existing blue default).

### Stat card consistency

Replace the inline `div` stat cards on the DEX page with the shared `StatCard` component used on all other pages.

### Stale comment removal

Remove the `// coming soon` comment on DEX USD volume — whitelisted-pool USD volume is already implemented.

### Sections stay separate

Fee AMM, Protocol DEX, and Community DEX remain as three distinct sections. They are genuinely different mechanisms (gas fee conversion vs enshrined swap precompile vs community Uniswap V2 pools).

---

## 5. Loading States

Add `loading.tsx` to:
- `src/app/analytics/loading.tsx`
- `src/app/stablecoins/loading.tsx`
- `src/app/dex/loading.tsx`

Each skeleton mirrors the page's actual layout using gray shimmer placeholders (`animate-pulse bg-tempo-border`). Stat card grid, chart placeholder box, table placeholder rows — all at the correct dimensions so there's no layout shift when real content arrives.

No Suspense boundaries within pages. The page-level loading file covers the main perceived latency issue.

---

## 6. New Data Infrastructure

### `mv_stablecoin_supply_daily` ClickHouse view

Added to `sql/clickhouse/views/erc20-and-dex.sql`.

```sql
-- Daily net supply change per whitelisted stablecoin
-- In tidx logs: selector is stored separately; topic1 = from, topic2 = to, topic3 = NULL for ERC-20
-- Mints: Transfer where from = zero address (topic1 = zero padded to 32 bytes)
-- Burns: Transfer where to   = zero address (topic2 = zero padded to 32 bytes)
-- topic3 IS NULL filters ERC-20 from ERC-721 (same Transfer selector, ERC-721 has tokenId in topic3)
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

> **Implementation note:** Verify `topic1`/`topic2` column names and zero-address padding format against the live `tidx_4217.logs` table before applying. If the topic column naming differs (e.g. 0-indexed), adjust accordingly.

A backfill query will also be added to `sql/clickhouse/backfills/erc20-and-dex.sql` to populate historical data from genesis using the same logic against the full `logs` table.

### `getStablecoinSupplyHistory` in `src/lib/analytics.ts`

New exported function. Queries `mv_stablecoin_supply_daily`, computes running cumulative sum per token, divides by `1e6`, and returns shaped data for the chart. Cached at 900s.

---

## 7. Files Changed

| File | Change |
|------|--------|
| `src/app/layout.tsx` | "Analytics" → "Overview" in nav |
| `src/app/analytics/page.tsx` | Full rewrite — 4-section overview |
| `src/app/analytics/loading.tsx` | New — skeleton |
| `src/app/stablecoins/page.tsx` | Replace TVL chart with supply chart |
| `src/app/stablecoins/loading.tsx` | New — skeleton |
| `src/app/dex/page.tsx` | Remove DexActivityChart, use StatCard, remove stale comment, color-differentiate charts |
| `src/app/dex/loading.tsx` | New — skeleton |
| `src/components/charts/StablecoinTVLChart.tsx` | Deleted |
| `src/components/charts/StablecoinSupplyChart.tsx` | New |
| `src/components/charts/DexActivityChart.tsx` | Deleted |
| `src/lib/analytics.ts` | Add `getStablecoinSupplyHistory` |
| `sql/clickhouse/views/erc20-and-dex.sql` | Add `mv_stablecoin_supply_daily` view |
| `sql/clickhouse/backfills/erc20-and-dex.sql` | Add supply backfill |
