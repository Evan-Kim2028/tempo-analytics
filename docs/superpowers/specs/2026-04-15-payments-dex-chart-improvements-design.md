# Design: Payments & DEX Chart Improvements

**Date:** 2026-04-15  
**Status:** Approved  
**Scope:** tempo-analytics — payments page and DEX page chart updates

---

## Context & Data Findings

Before finalising this design, the ClickHouse database was queried directly. Key discoveries:

| Token | TransferWithMemo events (30d) | Total USD volume |
|---|---|---|
| USDC.e (`0x20c0…b950`) | 138,817 | ~$289,683 |
| pathUSD (`0x20c0…0000`) | 8,833 | ~$77,437 |
| USDT0 (`0x20c0…eb73`) | 10 | ~$102 |
| Unverified tokens | ~60 | $100M+ (garbage — non-6-decimal tokens) |

- **USDC.e is the dominant payment token (94%).** The current MV only tracks pathUSD, so ~94% of payments have been invisible in the dashboard.
- **Whitelist filtering is non-negotiable.** Non-whitelisted `0x20c0…` tokens also emit `TransferWithMemo` but with inflated amounts indicating non-stablecoin decimals. Unfiltered data is unusable.
- **Empty memo is negligible.** Only 17 zero-memo events across 147k payments (<0.01%), but the semantic distinction is still worth encoding correctly.
- **`transferWithMemo` is 4% of all stablecoin movement.** Plain `transfer()` accounts for 96%. The payment function is an intentional, distinct act.
- **`receipts` table has `gas_used` (Int64) and `effective_gas_price` (Nullable(String))** — confirmed usable for fee amount computation. Parsing must use `toUInt256OrZero` (not `toUInt64OrZero`) to avoid overflow.

---

## 1. Payment Definition (canonical)

### What is a "payment"?

A **payment** is any `TransferWithMemo` event emitted by a verified TIP-20 stablecoin. Using `transferWithMemo` is an explicit act — the caller chose the payment interface over the standard `transfer`. It is distinct from:

- **Plain transfers** — standard ERC-20 `transfer()`, not tracked as payments
- **Unverified token transfers** — filtered out by the stablecoin whitelist

### Sub-categories

| Category | Condition | Label |
|---|---|---|
| **Memo-bearing** | `memo ≠ bytes32(0)` | Has reconciliation context (invoice ID, SOC, ef1e, mpps, etc.) |
| **Non-memo-bearing** | `memo = bytes32(0)` | Used the payment function, but provided no memo context |

### Page subtitle

Change from:
> `memo-bearing payment activity across Tempo`

To:
> `TIP-20 transferWithMemo activity across verified stablecoins`

This is accurate: we track all `transferWithMemo` calls, memo-bearing or not, across the full stablecoin whitelist.

---

## 2. Remove `PAYMENT_METHODS` Hardcoding

### Current state

`src/lib/payments.ts` exports a hardcoded `PAYMENT_METHODS` array with one entry (pathUSD), including `call_selector`, `event_selector`, and `decimals`. All SQL queries in the file are templated against this array.

### Target state

- **Delete `PAYMENT_METHODS`** entirely.
- The `TransferWithMemo` event selector (`0x57bc7354…`) is a TIP-20 standard — it applies to every verified stablecoin. No per-token selector needed.
- All stablecoins on the verified list use 6 decimals. No per-token decimal mapping needed.
- Replace all usages with `getVerifiedTokens()` (already cached at 1h in `src/lib/tokenlist.ts`), or `STABLECOIN_ADDRESSES` from `src/lib/tokens.ts` for the SQL IN-list.

### Affected query patterns

| Old pattern | New pattern |
|---|---|
| `PAYMENT_METHODS.map(m => ... WHERE selector = '${m.event_selector}' AND address = '${m.token}')` | `WHERE selector = '0x57bc7354…' AND lower(address) IN (${stablecoinAddressList})` |
| `amount_raw / 10 ** method.decimals` | `amount_raw / 1e6` (all verified stablecoins are 6-decimal) |
| `method.token_label` | resolved via `getTokenInfo(address)` |

---

## 3. MV Update: `mv_memo_payments_daily`

### Current state

The `TransferWithMemo` event filter in both the MV and its backfill is hardcoded to pathUSD:
```sql
AND lower(address) = '0x20c0000000000000000000000000000000000000'
```

### Target state

Replace with a whitelist IN-clause covering all verified stablecoins from `STABLECOIN_ADDRESSES`:
```sql
AND lower(address) IN (
  '0x20c0000000000000000000000000000000000000', -- pathUSD
  '0x20c000000000000000000000b9537d11c60e8b50', -- USDC.e
  '0x20c0000000000000000000001621e21f71cf12fb', -- EURC.e
  -- … full STABLECOIN_ADDRESSES list
)
```

The `token` column already exists in the MV table definition (`ORDER BY (day, token)`), so the schema is unchanged. Only the MV view body and its backfill need updating.

**Prerequisite:** MV recreation + backfill via `takopi`. The SQL files are updated in-repo; `takopi` applies them to the live database.

---

## 4. Daily Payment Amount — Stacked Bar by Stablecoin

### New data function

**`getPaymentsDailyByToken(days: number)`** in `src/lib/payments.ts`

Returns the dynamic pivot shape required by CLAUDE.md:
```ts
{ days: Array<Record<string, string | number>>, series: Array<{ id: string; label: string; total: number }> }
```

- Queries `mv_memo_payments_daily GROUP BY day, token`
- Resolves symbol per token via `getTokenInfo(address, { skipRPC: true })`, falling back to truncated address
- Pivots server-side: each row in `days` is `{ day, [tokenAddress]: amount, … }`
- `series` is sorted by all-period total descending

### Contract test

`expectPivotContract(data.days, data.series.map(s => ({ key: s.id })))` in `__tests__/lib/chart-data-contracts.test.ts`.

### New chart component

**`PaymentsAmountChart`** (rewrite of existing file `src/components/charts/PaymentsAmountChart.tsx`)

- Stacked `BarChart` using Recharts, same pattern as `FeeTokenAllChart`
- One `<Bar>` per `series` entry, keyed by token address (the dataKey)
- Y-axis: USD amount, formatted as `$X.XX`
- Tooltip per segment: `"SYMBOL: $amount"`
- Custom legend: `symbol · $total` (period total)
- Palette: reuse the same 8-color `PALETTE` constant from `FeeTokenAllChart`

### Data wiring

`PaymentsPageData` gains a `dailyByToken` field. The existing `daily: PaymentsDailyPoint[]` stays for the count and memo-pattern charts (no changes to those charts).

`PaymentsNarrative` passes `dailyByToken` to the rewritten `PaymentsAmountChart`.

---

## 5. DEX — Daily Fee Token Amount Chart

### New MV: `mv_fee_token_amount_daily`

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS tidx_4217.mv_fee_token_amount_daily
(
  day        Date,
  fee_token  String,
  fee_usd    Float64
)
ENGINE = SummingMergeTree
ORDER BY (day, fee_token);
```

**MV body** (triggered by inserts into `receipts`):
```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_fee_token_amount_daily_view
TO tidx_4217.mv_fee_token_amount_daily
AS
SELECT
  toDate(r.block_timestamp)                                             AS day,
  t.fee_token                                                          AS fee_token,
  sum(toFloat64(r.gas_used) * toFloat64OrZero(r.effective_gas_price) / 1e18)  AS fee_usd
FROM tidx_4217.receipts r
JOIN tidx_4217.txs t ON t.hash = r.tx_hash
WHERE t.fee_token IS NOT NULL AND t.fee_token != ''
GROUP BY day, fee_token;
```

**Parsing note:** `effective_gas_price` is stored as a decimal string (e.g. `"20000000000"`). Cast both operands to Float64 before multiplying to avoid signed/unsigned integer overflow (confirmed issue in ad-hoc queries). USD formula: `gas_used × effective_gas_price / 10^18` (confirmed against sample data: ~$0.001/tx).

**Prerequisite:** MV creation + backfill via `takopi`.

### New data function

**`getFeeTokenAmountDailyStats(days: number)`** in `src/lib/analytics.ts`

Returns a new exported type **`FeeTokenAmountDailyStat`**:
```ts
interface FeeTokenAmountDailyStat {
  days:   Array<Record<string, string | number>>  // keyed by fee_token address → fee_usd
  tokens: Array<{ address: string; symbol: string; total: number }>
}
```
Same pivot structure as `FeeTokenAllDailyStat` but values are `fee_usd` (USD float) instead of tx counts. Reuses same token symbol resolution path via `getTokenInfo`.

### New chart component

**`FeeTokenAmountChart`** in `src/components/charts/FeeTokenAmountChart.tsx`

Near-identical to `FeeTokenAllChart` with these differences:
- Y-axis formatter: `$X.XX` (USD) instead of count
- Y-axis label: `"Fee Amount (USD)"`
- Tooltip value: USD formatted

### Placement in DEX page

In the Fee AMM section of `src/app/dex/page.tsx`, add the new chart directly below the existing `FeeTokenAllChart` card:

```
[ Daily Fee Token Usage (30d) ]   ← existing count chart
[ Daily Fee Token Amount (30d) ]  ← new USD amount chart
```

### Contract test

`expectPivotContract(data.days, data.series.map(s => ({ key: s.id })))` for `getFeeTokenAmountDailyStats`.

---

## File Change Summary

| File | Change |
|---|---|
| `sql/clickhouse/views/payments/mv_memo_payments_daily.sql` | Expand address filter to full stablecoin whitelist |
| `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql` | Same expansion |
| `sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql` | New MV + table |
| `sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql` | New backfill |
| `src/lib/payments.ts` | Delete `PAYMENT_METHODS`; add `getPaymentsDailyByToken()`; update all queries to use stablecoin whitelist |
| `src/lib/analytics.ts` | Add `getFeeTokenAmountDailyStats()` and `FeeTokenAmountDailyStat` type |
| `src/app/payments/page.tsx` | Update subtitle |
| `src/components/charts/PaymentsAmountChart.tsx` | Rewrite as stacked stablecoin chart |
| `src/components/charts/FeeTokenAmountChart.tsx` | New component |
| `src/app/dex/page.tsx` | Add `FeeTokenAmountChart` below existing count chart |
| `src/components/payments/PaymentsNarrative.tsx` | Pass `dailyByToken` to `PaymentsAmountChart` |
| `__tests__/lib/chart-data-contracts.test.ts` | Add contract tests for both new data functions |

---

## Out of Scope

- Changes to memo-pattern chart, count chart, or leaderboard tables
- Changing the payment page period toggle (stays at 30d fixed)
- Reclassifying plain `transfer()` events as payments
- Changing DEX volume, TVL, or pool explorer sections
