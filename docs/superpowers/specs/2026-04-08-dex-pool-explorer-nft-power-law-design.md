# Design: Protocol DEX Pool Explorer + NFT Minter Concentration

**Date:** 2026-04-08  
**Status:** Approved

---

## Overview

Two additive analytics features for the Tempo explorer:

1. **Protocol DEX Pool Explorer** — a sortable, filterable pools table with inline recent-trades expansion, added to the existing `/dex` page.
2. **NFT Minter Concentration** — a top-minters ranked table and concentration stat card, added to the existing `/nfts` page.

Both features are read-only analytics additions with no new pages or routes.

---

## Background & Motivation

### Protocol DEX

The enshrined Protocol DEX precompile (`0xdec0000000000000000000000000000000000000`) has emitted 55,523+ swap events across 20+ token pools. The existing `/dex` page shows only aggregate daily volume/swap counts for the Protocol DEX as a whole.

On-chain event investigation revealed four event types:
- `0x16c08f8f...` — Swap (55,523 occurrences): `topic1=poolId, topic2=taker, topic3=token, data[0]=amountIn, data[1]=direction`
- `0xc200d837...` — OrderPlaced (85 occurrences): `topic1=orderId, topic2=maker, topic3=token, data[0]=amount, data[1]=side`
- `0x06ff08ed...` — OrderCancelled (13 occurrences): `topic1=orderId`
- `0xaff90cfc...` — PoolRegistered/LiquidityAdded (19 occurrences): `topic1=key, topic2=token, topic3=pathUSD`

The orderbook component has only 85 lifetime orders — nearly all liquidity flows through the AMM. A per-pool recent-trades view is more useful than an orderbook depth chart.

One address (`0x710f8c994064211f34469f71c483e1e0ab193f2e`) appears as taker in ~75% of all swaps, suggesting bot/market-maker activity worth surfacing.

### NFT Minter Concentration

The existing `/nfts` page tracks ERC-721 transfers per collection. There is no address-level analysis. The hypothesis is that a small number of addresses account for the majority of NFT mints (farming/wash trading). Confirming this requires a top-minters table and a concentration stat.

---

## Feature 1: Protocol DEX Pool Explorer

### Data Layer

**New ClickHouse materialized view: `mv_protocol_dex_pool_daily`**

```sql
CREATE TABLE IF NOT EXISTS tidx_4217.mv_protocol_dex_pool_daily
(
  day        Date,
  pool_id    UInt64,
  token      String,
  swaps      UInt64,
  volume_raw UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, pool_id, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_protocol_dex_pool_daily_view
TO tidx_4217.mv_protocol_dex_pool_daily
AS SELECT
  toDate(block_timestamp)                                                        AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))                AS pool_id,
  '0x' || lower(substring(topic3, 27))                                          AS token,
  count()                                                                        AS swaps,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16)))))             AS volume_raw
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
```

Backfill: same query without the MV wrapper, inserting into `mv_protocol_dex_pool_daily`.

**New TypeScript types** (`src/lib/analytics.ts`):

```typescript
export type ProtocolDexPool = {
  poolId:       number
  token:        string        // 20-byte address
  symbol:       string        // resolved or truncated address
  swaps_30d:    number
  volume_usd:   number        // volume_raw / 1e6, only meaningful if token is known stablecoin
  avg_trade:    number        // volume_usd / swaps_30d
  whitelisted:  boolean       // token in known tokens + tokenlist
}

export type ProtocolDexTrade = {
  timestamp:  string          // ISO
  taker:      string          // 20-byte address
  amount_raw: number
  amount_usd: number | null   // null if token not whitelisted
  direction:  0 | 1           // 0 = buy pathUSD, 1 = sell pathUSD
}
```

**New analytics functions** (`src/lib/analytics.ts`):

- `getProtocolDexPools(days: number, sortBy: 'volume' | 'swaps' | 'avg_trade'): Promise<ProtocolDexPool[]>`
  - Aggregates `mv_protocol_dex_pool_daily` for the last `days` days
  - Resolves token symbols via `getTokenInfo()` (cache-backed)
  - Sets `whitelisted` based on token presence in combined known tokens + tokenlist
  - Sorts by the requested metric descending
  - Returns all pools (no limit — expected ~20)

- `getProtocolDexPoolTrades(token: string, limit = 50): Promise<ProtocolDexTrade[]>`
  - Queries `tidx_4217.logs` directly (no MV)
  - Filters by Protocol DEX address + swap selector + `topic3 = padAddr(token)` (topic3 is 32-byte padded in logs; use the same `padAddr()` helper already in `defi.ts`)
  - Returns the most recent `limit` trades ordered by `block_timestamp DESC`
  - Decodes: taker from topic2 (`'0x' || substring(topic2, 27)`), amount from data lo-64, direction from data second word lo-64

### UI

**Placement:** New section at the bottom of `/dex` page, below the existing Community DEX top pools table. Title: "Protocol DEX Pools".

**Controls row:**
- Toggle (left): `All Pools` | `Known Tokens Only`
  - "Known Tokens Only" filters to `whitelisted === true`
- Sort dropdown (right): `Volume (30d)` | `Swaps (30d)` | `Avg Trade Size`
  - Default: `Volume (30d)`

**Pools table columns:**
| Column | Notes |
|--------|-------|
| Pool | Token symbol (if known) or `0x1234…abcd` + grey "Unknown" badge |
| 30d Volume | USD if whitelisted, "—" if not |
| 30d Swaps | Integer |
| Avg Trade | USD if whitelisted, "—" if not |
| Status | Green "Known" badge or grey "Unknown" badge |

**Inline trades expansion (accordion):**
- Clicking any pool row toggles an inline sub-table
- Sub-table title: "Recent Trades — [Token Symbol]"
- Columns: Time (relative, e.g. "3h ago") | Taker (truncated address, monospace) | Amount | Direction (▲ Buy / ▼ Sell)
- Last 50 trades, no pagination
- Loading state shown while fetching

**Note:** The `0x710f8c...` address dominating ~75% of trades will be visually obvious in the Taker column.

---

## Feature 2: NFT Minter Concentration

### Data Layer

No new materialized views. Both queries run directly against `tidx_4217.logs`.

Zero-address (mint) filter: `topic1 = '0x0000000000000000000000000000000000000000000000000000000000000000'`

ERC-721 filter: `selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' AND topic3 IS NOT NULL`

**New TypeScript types** (`src/lib/analytics.ts`):

```typescript
export type NFTMinterConcentration = {
  total_mints:      number
  unique_minters:   number
  top10_share_pct:  number    // % of total mints by top 10 addresses
}

export type TopNFTMinter = {
  rank:        number
  minter:      string         // 20-byte address
  mints:       number
  pct_total:   number         // mints / total_mints * 100
  collections: number         // unique collection contracts minted from
}
```

**New analytics functions** (`src/lib/analytics.ts`):

- `getNFTMinterConcentration(): Promise<NFTMinterConcentration>`
  - Query 1: total mints + unique minters (single aggregation)
  - Query 2: top 10 minters by mint count, sum their mints → compute share pct
  - Cached 15 minutes

- `getTopNFTMinters(limit = 50): Promise<TopNFTMinter[]>`
  - Groups logs by topic2 (minter address), counts mints, counts distinct `address` (collection)
  - Orders by mints DESC, limit N
  - Computes pct_total in SQL: `round(mints * 100.0 / (SELECT count() FROM tidx_4217.logs WHERE ... mint filter ...), 2)`
  - Cached 15 minutes

### UI

**Placement:** New section on `/nfts` page below the existing top collections table. Title: "Minter Concentration".

**New stat card** added to the existing summary row at the top:
- Label: "Top 10 Minters"
- Value: "X% of mints"
- Sub-label: "of all-time mints"

**Ranked table columns:**
| Column | Notes |
|--------|-------|
| Rank | 1–50 |
| Address | Truncated monospace, e.g. `0x1234…abcd` |
| Mints | Integer |
| % of Total | e.g. `34.2%` |
| Collections | Count of unique collections minted from |

No sort controls — rank by mints descending is the only useful order.

---

## File Changes Summary

| File | Change |
|------|--------|
| `sql/clickhouse/views/protocol-dex.sql` | Add `mv_protocol_dex_pool_daily` table + MV |
| `sql/clickhouse/backfills/protocol-dex.sql` | Add backfill INSERT for pool daily data |
| `src/lib/analytics.ts` | Add 4 new functions + 4 new types |
| `src/app/dex/page.tsx` | Add Protocol DEX Pool Explorer section |
| `src/app/nfts/page.tsx` | Add stat card + Minter Concentration section |

No new files, no new routes, no new components (uses existing StatCard, table patterns).

---

## Out of Scope

- OrderPlaced / OrderCancelled event tracking (orderbook has only 85 lifetime orders)
- PoolRegistered event tracking (`0xaff90cfc...`, 19 occurrences)
- NFT wash-trading graph analysis (address-level transfer loops)
- Pagination on the trades drawer (50 trades is sufficient for the use case)
- Validator set tracking
