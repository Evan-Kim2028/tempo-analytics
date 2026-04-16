# Micropayment Stats Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a micropayment statistics section to the top of the Payments page, powered by a single ClickHouse materialized view that tracks daily transaction counts and USD amounts by value tier (sub-cent, sub-nickel, sub-dime, large).

**Architecture:** A new `mv_micropayment_stats_daily` SummingMergeTree MV buckets every successful payment into one of four tiers at write time. Two new TypeScript functions (`getMicropaymentStatsDaily`, `getMicropaymentStatsSummary`) read from it server-side and return pre-shaped recharts data. Three new React components (two charts, one stat-card row) render the data at the top of `PaymentsPage`.

**Tech Stack:** ClickHouse SummingMergeTree, Next.js 14 server components, Recharts stacked bar charts, Jest + chart-contract helpers

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `sql/clickhouse/views/payments/mv_micropayment_stats_daily.sql` | MV DDL + success trigger |
| Create | `sql/clickhouse/backfills/payments/mv_micropayment_stats_daily.sql` | Historical backfill INSERT |
| Modify | `src/lib/payments.ts` | Add interfaces + two data functions |
| Modify | `__tests__/lib/chart-data-contracts.test.ts` | Contract tests for new functions |
| Create | `src/components/charts/MicropaymentTierChart.tsx` | Stacked bar: counts by tier |
| Create | `src/components/charts/MicropaymentVsLargeChart.tsx` | Stacked bar: micro vs large |
| Create | `src/components/payments/MicropaymentsSummary.tsx` | 4 stat cards |
| Modify | `src/app/payments/page.tsx` | Wire micropayments section at top |

---

## Task 1: ClickHouse Materialized View + Backfill

**Files:**
- Create: `sql/clickhouse/views/payments/mv_micropayment_stats_daily.sql`
- Create: `sql/clickhouse/backfills/payments/mv_micropayment_stats_daily.sql`

### Tier definitions
| Tier | Column prefix | Condition |
|------|---------------|-----------|
| sub-cent | `sub_cent` | `amount < 0.01` |
| sub-nickel | `sub_nickel` | `amount >= 0.01 AND amount < 0.05` |
| sub-dime | `sub_dime` | `amount >= 0.05 AND amount < 0.10` |
| large | `large` | `amount >= 0.10` |

- [ ] **Step 1: Write the MV DDL file**

Create `sql/clickhouse/views/payments/mv_micropayment_stats_daily.sql`:

```sql
-- @name:         mv_micropayment_stats_daily
-- @domain:       payments
-- @kind:         materialized_view
-- @purpose:      Daily micropayment tier rollups — counts and USD amounts by value bucket for dashboard charts
-- @upstream:     tidx_4217.logs
-- @consumers:    src/lib/payments.ts::getMicropaymentStatsDaily, getMicropaymentStatsSummary
-- @backfill:     sql/clickhouse/backfills/payments/mv_micropayment_stats_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--
-- NOTES: Only successful payments (log-based, selector 0x57bc…). Failed txs carry
-- no amount field so they cannot be bucketed by value tier. Amount decoded via
-- reinterpretAsUInt256/reverse/unhex — same formula used in mv_memo_payments_daily.

CREATE TABLE IF NOT EXISTS tidx_4217.mv_micropayment_stats_daily
(
  day               Date,
  sub_cent_count    UInt64,
  sub_cent_amount   Float64,
  sub_nickel_count  UInt64,
  sub_nickel_amount Float64,
  sub_dime_count    UInt64,
  sub_dime_amount   Float64,
  large_count       UInt64,
  large_amount      Float64
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_micropayment_stats_daily_view
TO tidx_4217.mv_micropayment_stats_daily
AS SELECT
  toDate(block_timestamp)                                                                  AS day,
  countIf(amount < 0.01)                                                                   AS sub_cent_count,
  sumIf(amount, amount < 0.01)                                                             AS sub_cent_amount,
  countIf(amount >= 0.01 AND amount < 0.05)                                               AS sub_nickel_count,
  sumIf(amount, amount >= 0.01 AND amount < 0.05)                                         AS sub_nickel_amount,
  countIf(amount >= 0.05 AND amount < 0.10)                                               AS sub_dime_count,
  sumIf(amount, amount >= 0.05 AND amount < 0.10)                                         AS sub_dime_amount,
  countIf(amount >= 0.10)                                                                  AS large_count,
  sumIf(amount, amount >= 0.10)                                                            AS large_amount
FROM (
  SELECT
    block_timestamp,
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6 AS amount
  FROM tidx_4217.logs
  WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(address) IN (
      '0x20c0000000000000000000000000000000000000',
      '0x20c000000000000000000000b9537d11c60e8b50',
      '0x20c0000000000000000000001621e21f71cf12fb',
      '0x20c00000000000000000000014f22ca97301eb73',
      '0x20c0000000000000000000003554d28269e0f3c2',
      '0x20c0000000000000000000000520792dcccccccc',
      '0x20c0000000000000000000008ee4fcff88888888',
      '0x20c0000000000000000000005c0bac7cef389a11',
      '0x20c0000000000000000000007f7ba549dd0251b9',
      '0x20c000000000000000000000aeed2ec36a54d0e5',
      '0x20c0000000000000000000009a4a4b17e0dc6651',
      '0x20c000000000000000000000383a23bacb546ab9',
      '0x20c000000000000000000000ab02d39df30bd17e',
      '0x20c000000000000000000000048c8f36df1c9a4a',
      '0x20c0000000000000000000002f52d5cc21a3207b',
      '0x20c000000000000000000000bd95bfb69fbe6ce3',
      '0x20c000000000000000000000ae247a1130450f09'
    )
)
GROUP BY day;
```

- [ ] **Step 2: Write the backfill file**

Create `sql/clickhouse/backfills/payments/mv_micropayment_stats_daily.sql`:

```sql
-- @name:         mv_micropayment_stats_daily
-- @domain:       payments
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_micropayment_stats_daily.
-- @pairs:        sql/clickhouse/views/payments/mv_micropayment_stats_daily.sql
-- @owner:        evan
-- @since:        2026-04-15

INSERT INTO tidx_4217.mv_micropayment_stats_daily
SELECT
  toDate(block_timestamp)                                                                  AS day,
  countIf(amount < 0.01)                                                                   AS sub_cent_count,
  sumIf(amount, amount < 0.01)                                                             AS sub_cent_amount,
  countIf(amount >= 0.01 AND amount < 0.05)                                               AS sub_nickel_count,
  sumIf(amount, amount >= 0.01 AND amount < 0.05)                                         AS sub_nickel_amount,
  countIf(amount >= 0.05 AND amount < 0.10)                                               AS sub_dime_count,
  sumIf(amount, amount >= 0.05 AND amount < 0.10)                                         AS sub_dime_amount,
  countIf(amount >= 0.10)                                                                  AS large_count,
  sumIf(amount, amount >= 0.10)                                                            AS large_amount
FROM (
  SELECT
    block_timestamp,
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6 AS amount
  FROM tidx_4217.logs
  WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(address) IN (
      '0x20c0000000000000000000000000000000000000',
      '0x20c000000000000000000000b9537d11c60e8b50',
      '0x20c0000000000000000000001621e21f71cf12fb',
      '0x20c00000000000000000000014f22ca97301eb73',
      '0x20c0000000000000000000003554d28269e0f3c2',
      '0x20c0000000000000000000000520792dcccccccc',
      '0x20c0000000000000000000008ee4fcff88888888',
      '0x20c0000000000000000000005c0bac7cef389a11',
      '0x20c0000000000000000000007f7ba549dd0251b9',
      '0x20c000000000000000000000aeed2ec36a54d0e5',
      '0x20c0000000000000000000009a4a4b17e0dc6651',
      '0x20c000000000000000000000383a23bacb546ab9',
      '0x20c000000000000000000000ab02d39df30bd17e',
      '0x20c000000000000000000000048c8f36df1c9a4a',
      '0x20c0000000000000000000002f52d5cc21a3207b',
      '0x20c000000000000000000000bd95bfb69fbe6ce3',
      '0x20c000000000000000000000ae247a1130450f09'
    )
)
GROUP BY day;
```

- [ ] **Step 3: Apply the MV to live ClickHouse**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
CLICKHOUSE_URL=http://127.0.0.1:8123 bash scripts/apply-clickhouse-assets.sh --only payments/mv_micropayment_stats_daily
```

Expected: Script prints `[CREATE] mv_micropayment_stats_daily` and `[CREATE] mv_micropayment_stats_daily_view` with no errors. If either already exists from a prior run, the `IF NOT EXISTS` guards are harmless.

- [ ] **Step 4: Run the backfill**

```bash
python3 scripts/takopi_clickhouse.py --file sql/clickhouse/backfills/payments/mv_micropayment_stats_daily.sql
```

Expected: No output (INSERT returns nothing) or `Ok.` — no error lines.

- [ ] **Step 5: Verify backfill has data**

```bash
python3 scripts/takopi_clickhouse.py --query "
SELECT
  sum(sub_cent_count) AS sub_cent,
  sum(sub_nickel_count) AS sub_nickel,
  sum(sub_dime_count) AS sub_dime,
  sum(large_count) AS large,
  count(DISTINCT day) AS days
FROM tidx_4217.mv_micropayment_stats_daily
FORMAT TSVWithNames
"
```

Expected: `sub_cent` > 50000, `sub_nickel` > 20000, `large` > 5000, `days` > 60.

- [ ] **Step 6: Commit**

```bash
git add sql/clickhouse/views/payments/mv_micropayment_stats_daily.sql \
        sql/clickhouse/backfills/payments/mv_micropayment_stats_daily.sql
git commit -m "feat(clickhouse): add mv_micropayment_stats_daily tier rollup view + backfill"
```

---

## Task 2: TypeScript Data Functions + Contract Tests

**Files:**
- Modify: `src/lib/payments.ts`
- Modify: `__tests__/lib/chart-data-contracts.test.ts`

- [ ] **Step 1: Write the failing contract test**

In `__tests__/lib/chart-data-contracts.test.ts`, add the import and the new describe block.

Add to the imports section (after `import { getPaymentsDailyByToken } from '@/lib/payments'`):

```typescript
import { getMicropaymentStatsDaily } from '@/lib/payments'
```

Add before the final closing of the file:

```typescript
// Chart: MicropaymentTierChart, MicropaymentVsLargeChart
// DataKeys: sub_cent_count, sub_nickel_count, sub_dime_count, large_count, micro_count
describe('getMicropaymentStatsDaily → MicropaymentTierChart / MicropaymentVsLargeChart', () => {
  test('contract: all tier count fields are finite numbers', async () => {
    mockQueryOnce([
      {
        day: '2026-04-01',
        sub_cent_count: '82000', sub_cent_amount: '150.5',
        sub_nickel_count: '12000', sub_nickel_amount: '310.2',
        sub_dime_count: '4000', sub_dime_amount: '280.0',
        large_count: '14000', large_amount: '95000.0',
      },
      {
        day: '2026-04-02',
        sub_cent_count: '75000', sub_cent_amount: '140.1',
        sub_nickel_count: '11000', sub_nickel_amount: '290.5',
        sub_dime_count: '3800', sub_dime_amount: '265.3',
        large_count: '13500', large_amount: '90000.0',
      },
    ])
    const rows = await getMicropaymentStatsDaily(2)
    expectRechartsRows(rows, ['sub_cent_count', 'sub_nickel_count', 'sub_dime_count', 'large_count', 'micro_count'])
  })

  test('contract: zero values are valid finite numbers', async () => {
    mockQueryOnce([
      {
        day: '2026-04-01',
        sub_cent_count: '0', sub_cent_amount: '0',
        sub_nickel_count: '0', sub_nickel_amount: '0',
        sub_dime_count: '0', sub_dime_amount: '0',
        large_count: '0', large_amount: '0',
      },
    ])
    const rows = await getMicropaymentStatsDaily(1)
    expectRechartsRows(rows, ['sub_cent_count', 'sub_nickel_count', 'sub_dime_count', 'large_count', 'micro_count'])
  })

  test('contract: micro_count equals sum of three sub-tiers', async () => {
    mockQueryOnce([
      {
        day: '2026-04-01',
        sub_cent_count: '100', sub_cent_amount: '0.5',
        sub_nickel_count: '50', sub_nickel_amount: '1.5',
        sub_dime_count: '25', sub_dime_amount: '2.0',
        large_count: '200', large_amount: '500.0',
      },
    ])
    const rows = await getMicropaymentStatsDaily(1)
    expect(rows[0].micro_count).toBe(rows[0].sub_cent_count + rows[0].sub_nickel_count + rows[0].sub_dime_count)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
npx jest '__tests__/lib/chart-data-contracts.test.ts' --testNamePattern='getMicropaymentStatsDaily' --no-coverage 2>&1 | tail -20
```

Expected: FAIL with `Cannot find module '@/lib/payments'` exporting `getMicropaymentStatsDaily`, or "is not a function".

- [ ] **Step 3: Add interfaces and data functions to `src/lib/payments.ts`**

Add new exported interfaces after `PaymentsDailyByToken` (before `PaymentsPageData`):

```typescript
export interface MicropaymentStatsDailyPoint {
  day: string
  sub_cent_count: number
  sub_cent_amount: number
  sub_nickel_count: number
  sub_nickel_amount: number
  sub_dime_count: number
  sub_dime_amount: number
  large_count: number
  large_amount: number
  micro_count: number   // sub_cent + sub_nickel + sub_dime, computed server-side
}

export interface MicropaymentStatsSummary {
  sub_cent_count: number
  sub_nickel_count: number
  sub_dime_count: number
  large_count: number
  micro_count: number
  micro_amount: number  // sum of sub_cent + sub_nickel + sub_dime amounts
  micro_share_pct: number  // micro_count / (micro_count + large_count) * 100
}
```

Add `micropaymentStats` field to `PaymentsPageData`:

```typescript
export interface PaymentsPageData {
  summary: PaymentsSummaryStats
  recent: PaymentRow[]
  daily: PaymentsDailyPoint[]
  dailyByToken: PaymentsDailyByToken
  micropaymentStats: {
    summary: MicropaymentStatsSummary
    daily: MicropaymentStatsDailyPoint[]
  }
  topRecipientsByAmount: PaymentCounterpartyRow[]
  topRecipientsByCount: PaymentCounterpartyRow[]
  topSenders: PaymentCounterpartyRow[]
}
```

Add two new exported functions before `getPaymentsPageData`:

```typescript
interface RawMicropaymentStatsDailyRow {
  day: string
  sub_cent_count: string | number
  sub_cent_amount: string | number
  sub_nickel_count: string | number
  sub_nickel_amount: string | number
  sub_dime_count: string | number
  sub_dime_amount: string | number
  large_count: string | number
  large_amount: string | number
}

export async function getMicropaymentStatsDaily(days = 30): Promise<MicropaymentStatsDailyPoint[]> {
  const cacheKey = `payments:micropayment-stats-daily:${days}`
  const cached = await getCached<MicropaymentStatsDailyPoint[]>(cacheKey)
  if (cached !== null) return cached

  const rows = await queryClickHouse<RawMicropaymentStatsDailyRow>(`
    SELECT
      day,
      sum(sub_cent_count)    AS sub_cent_count,
      sum(sub_cent_amount)   AS sub_cent_amount,
      sum(sub_nickel_count)  AS sub_nickel_count,
      sum(sub_nickel_amount) AS sub_nickel_amount,
      sum(sub_dime_count)    AS sub_dime_count,
      sum(sub_dime_amount)   AS sub_dime_amount,
      sum(large_count)       AS large_count,
      sum(large_amount)      AS large_amount
    FROM mv_micropayment_stats_daily
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const mapped = rows.map(row => {
    const sub_cent_count   = toNumber(row.sub_cent_count)
    const sub_nickel_count = toNumber(row.sub_nickel_count)
    const sub_dime_count   = toNumber(row.sub_dime_count)
    return {
      day: sliceDay(row.day),
      sub_cent_count,
      sub_cent_amount:   roundTo(toNumber(row.sub_cent_amount)),
      sub_nickel_count,
      sub_nickel_amount: roundTo(toNumber(row.sub_nickel_amount)),
      sub_dime_count,
      sub_dime_amount:   roundTo(toNumber(row.sub_dime_amount)),
      large_count:       toNumber(row.large_count),
      large_amount:      roundTo(toNumber(row.large_amount)),
      micro_count:       sub_cent_count + sub_nickel_count + sub_dime_count,
    }
  })

  await setCached(cacheKey, mapped, CACHE_TTL_SECONDS)
  return mapped
}

export async function getMicropaymentStatsSummary(days = 30): Promise<MicropaymentStatsSummary> {
  const cacheKey = `payments:micropayment-stats-summary:${days}`
  const cached = await getCached<MicropaymentStatsSummary>(cacheKey)
  if (cached !== null) return cached

  const rows = await queryClickHouse<{
    sub_cent_count: string | number
    sub_nickel_count: string | number
    sub_dime_count: string | number
    large_count: string | number
    micro_amount: string | number
  }>(`
    SELECT
      sum(sub_cent_count)                                      AS sub_cent_count,
      sum(sub_nickel_count)                                    AS sub_nickel_count,
      sum(sub_dime_count)                                      AS sub_dime_count,
      sum(large_count)                                         AS large_count,
      sum(sub_cent_amount + sub_nickel_amount + sub_dime_amount) AS micro_amount
    FROM mv_micropayment_stats_daily
    WHERE day >= today() - ${days}
  `)

  const r = rows[0] ?? {}
  const sub_cent_count   = toNumber(r.sub_cent_count)
  const sub_nickel_count = toNumber(r.sub_nickel_count)
  const sub_dime_count   = toNumber(r.sub_dime_count)
  const large_count      = toNumber(r.large_count)
  const micro_count      = sub_cent_count + sub_nickel_count + sub_dime_count
  const total_count      = micro_count + large_count

  const summary: MicropaymentStatsSummary = {
    sub_cent_count,
    sub_nickel_count,
    sub_dime_count,
    large_count,
    micro_count,
    micro_amount:     roundTo(toNumber(r.micro_amount)),
    micro_share_pct:  total_count === 0 ? 0 : roundTo((micro_count * 100) / total_count),
  }

  await setCached(cacheKey, summary, CACHE_TTL_SECONDS)
  return summary
}
```

Update `getPaymentsPageData` to call the two new functions and return them:

```typescript
export async function getPaymentsPageData(): Promise<PaymentsPageData> {
  const [
    summary,
    daily,
    dailyByToken,
    recent,
    micropaymentDaily,
    micropaymentSummary,
    topRecipientsByAmount,
    topRecipientsByCount,
    topSenders,
  ] = await Promise.all([
    getPaymentsSummary(),
    getPaymentsDaily(),
    getPaymentsDailyByToken(),
    getRecentPayments(),
    getMicropaymentStatsDaily(),
    getMicropaymentStatsSummary(),
    getTopCounterparties('recipient', 'amount'),
    getTopCounterparties('recipient', 'count'),
    getTopCounterparties('sender', 'count'),
  ])

  return {
    summary,
    daily,
    dailyByToken,
    recent,
    micropaymentStats: {
      summary: micropaymentSummary,
      daily: micropaymentDaily,
    },
    topRecipientsByAmount,
    topRecipientsByCount,
    topSenders,
  }
}
```

- [ ] **Step 4: Run the contract tests and confirm they pass**

```bash
npx jest '__tests__/lib/chart-data-contracts.test.ts' --testNamePattern='getMicropaymentStatsDaily' --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 5: Run the full test suite to catch regressions**

```bash
npm test -- --no-coverage 2>&1 | tail -30
```

Expected: All tests pass. If any fail due to `PaymentsPageData` shape change, those tests also need their mock data updated to include `micropaymentStats`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments.ts __tests__/lib/chart-data-contracts.test.ts
git commit -m "feat(payments): add getMicropaymentStatsDaily/Summary + contract tests"
```

---

## Task 3: Chart Components

**Files:**
- Create: `src/components/charts/MicropaymentTierChart.tsx`
- Create: `src/components/charts/MicropaymentVsLargeChart.tsx`

- [ ] **Step 1: Create `MicropaymentTierChart.tsx`**

This chart renders a stacked bar of the three micro-tiers (sub-cent, sub-nickel, sub-dime) per day.

```typescript
'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MicropaymentStatsDailyPoint } from '@/lib/payments'

export function MicropaymentTierChart({ data }: { data: MicropaymentStatsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => value.slice(5)}
          label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          width={72}
          label={{ value: 'Transactions', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="sub_cent_count"   name="Sub-cent (<$0.01)"    stackId="1" fill="#0057FF" fillOpacity={0.85} />
        <Bar dataKey="sub_nickel_count" name="Sub-nickel (<$0.05)"  stackId="1" fill="#10B981" fillOpacity={0.85} />
        <Bar dataKey="sub_dime_count"   name="Sub-dime (<$0.10)"    stackId="1" fill="#8B5CF6" fillOpacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Create `MicropaymentVsLargeChart.tsx`**

This chart renders a stacked bar of micro (all three sub-tiers combined as `micro_count`) vs large per day.

```typescript
'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MicropaymentStatsDailyPoint } from '@/lib/payments'

export function MicropaymentVsLargeChart({ data }: { data: MicropaymentStatsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => value.slice(5)}
          label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          width={72}
          label={{ value: 'Transactions', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="micro_count" name="Micropayments (<$0.10)" stackId="1" fill="#0057FF" fillOpacity={0.85} />
        <Bar dataKey="large_count" name="Large (≥$0.10)"         stackId="1" fill="#6B7280" fillOpacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If the import of `MicropaymentStatsDailyPoint` fails, verify Task 2 exported the interface.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/MicropaymentTierChart.tsx \
        src/components/charts/MicropaymentVsLargeChart.tsx
git commit -m "feat(charts): add MicropaymentTierChart and MicropaymentVsLargeChart"
```

---

## Task 4: Stat Card Summary Component

**Files:**
- Create: `src/components/payments/MicropaymentsSummary.tsx`

- [ ] **Step 1: Create `MicropaymentsSummary.tsx`**

```typescript
import { StatCard } from '@/components/StatCard'
import type { MicropaymentStatsSummary } from '@/lib/payments'

const countFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
})

export function MicropaymentsSummary({ summary }: { summary: MicropaymentStatsSummary }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Micropayment Share"
        value={`${summary.micro_share_pct}%`}
        sub="of all successful payments (30d)"
      />
      <StatCard
        label="Micropayments"
        value={countFormatter.format(summary.micro_count)}
        sub="transactions under $0.10 (30d)"
      />
      <StatCard
        label="Sub-cent Transactions"
        value={countFormatter.format(summary.sub_cent_count)}
        sub="payments under $0.01 (30d)"
      />
      <StatCard
        label="Micropayment Volume"
        value={usdFormatter.format(summary.micro_amount)}
        sub="total USD under $0.10 (30d)"
      />
    </section>
  )
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/payments/MicropaymentsSummary.tsx
git commit -m "feat(payments): add MicropaymentsSummary stat card component"
```

---

## Task 5: Wire Micropayments Section Into Payments Page

**Files:**
- Modify: `src/app/payments/page.tsx`

- [ ] **Step 1: Update `src/app/payments/page.tsx`**

Replace the entire file content with:

```typescript
import { PaymentsNarrative } from '@/components/payments/PaymentsNarrative'
import { PaymentsSummary } from '@/components/payments/PaymentsSummary'
import { MicropaymentsSummary } from '@/components/payments/MicropaymentsSummary'
import { MicropaymentTierChart } from '@/components/charts/MicropaymentTierChart'
import { MicropaymentVsLargeChart } from '@/components/charts/MicropaymentVsLargeChart'
import { RecentPaymentsTable } from '@/components/payments/RecentPaymentsTable'
import { getPaymentsPageData } from '@/lib/payments'

export const revalidate = 900

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      {children}
    </section>
  )
}

export default async function PaymentsPage() {
  const data = await getPaymentsPageData()

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">Payments</h1>
            <p className="max-w-3xl text-sm text-tempo-muted">
              TIP-20 transferWithMemo activity across verified stablecoins
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-tempo-border bg-tempo-card px-3 py-1 text-xs text-tempo-muted">
            Updates every 15 min · Mainnet data
          </span>
        </div>
      </header>

      <section className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Micropayments</h2>
        <MicropaymentsSummary summary={data.micropaymentStats.summary} />
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title="Micropayment Volume by Tier (30d)">
            <MicropaymentTierChart data={data.micropaymentStats.daily} />
          </ChartCard>
          <ChartCard title="Micropayments vs Large Payments (30d)">
            <MicropaymentVsLargeChart data={data.micropaymentStats.daily} />
          </ChartCard>
        </div>
      </section>

      <PaymentsSummary summary={data.summary} />
      <PaymentsNarrative
        daily={data.daily}
        dailyByToken={data.dailyByToken}
        topRecipientsByAmount={data.topRecipientsByAmount}
        topRecipientsByCount={data.topRecipientsByCount}
        topSenders={data.topSenders}
      />
      <RecentPaymentsTable rows={data.recent} />
    </div>
  )
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 3: Run production build**

```bash
npm run build 2>&1 | tail -40
```

Expected: `✓ Compiled successfully` with no TypeScript or module errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/payments/page.tsx
git commit -m "feat(payments): add micropayments section to top of payments page"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Single ClickHouse MV powers all UI elements → `mv_micropayment_stats_daily` (Task 1)
- [x] Stat cards: Micropayment Share, Micropayments count, Sub-cent count, Volume → Task 4
- [x] MicropaymentTierChart (stacked bar by tier) → Task 3
- [x] MicropaymentVsLargeChart (micro vs large) → Task 3
- [x] Micropayments section at top of page → Task 5
- [x] Server-side data shaping (CLAUDE.md rule) → `getMicropaymentStatsDaily` returns pre-shaped rows
- [x] Contract test for every new chart function → Task 2
- [x] `npm test` + `npm run build` before committing final changes → Task 5 Steps 2 & 3

**Type consistency:**
- `MicropaymentStatsDailyPoint` defined in Task 2, imported in Tasks 3 and 5 ✓
- `MicropaymentStatsSummary` defined in Task 2, imported in Task 4 ✓
- `micropaymentStats.daily` is `MicropaymentStatsDailyPoint[]`, `micropaymentStats.summary` is `MicropaymentStatsSummary` ✓
- `micro_count` computed in `getMicropaymentStatsDaily` (server-side, not in client component) ✓
- `PaymentsPageData.micropaymentStats` added in Task 2 before page uses it in Task 5 ✓
