# Payments & DEX Chart Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand payment tracking to all verified stablecoins, add a stacked-by-token payment amount chart, and add a daily fee token USD amount chart to the DEX page.

**Architecture:** SQL MVs are updated first (takopi applies them to live DB), then TypeScript data functions are added TDD-style, then chart components are wired in. The existing `PAYMENT_METHODS` hardcoded array is deleted and replaced with `STABLECOIN_ADDRESSES` from `src/lib/tokens.ts`. Two new pivot-shape data functions (`getPaymentsDailyByToken`, `getFeeTokenAmountDailyStats`) follow the exact same pattern as the existing `getFeeTokenAllDailyStats`.

**Tech Stack:** ClickHouse (SQL MVs), Next.js 14 App Router (server components), Recharts (client charts), Jest (contract tests), TypeScript.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `sql/clickhouse/views/payments/mv_memo_payments_daily.sql` | Modify | Expand `address =` filter to `address IN (…full stablecoin list…)` in both MV views |
| `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql` | Modify | Same expansion for the backfill INSERT |
| `sql/clickhouse/views/payments/mv_memo_payments_failed_actors.sql` | Modify | Same expansion |
| `sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql` | Create | New table + MV definition |
| `sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql` | Create | New backfill INSERT |
| `src/lib/payments.ts` | Modify | Delete `PAYMENT_METHODS`; update all query builders to IN-clause; add `PaymentsDailyByToken` type + `getPaymentsDailyByToken()`; add `dailyByToken` to `PaymentsPageData`; import `STABLECOIN_ADDRESSES`, `KNOWN_TOKENS`, `getTokenInfo` from tokens |
| `src/lib/analytics.ts` | Modify | Add `FeeTokenAmountDailyStat` type + `getFeeTokenAmountDailyStats()` |
| `src/components/charts/PaymentsAmountChart.tsx` | Rewrite | Stacked bar by token using `PaymentsDailyByToken` pivot shape |
| `src/components/charts/FeeTokenAmountChart.tsx` | Create | New chart, near-identical to `FeeTokenAllChart` but USD Y-axis |
| `src/components/payments/PaymentsNarrative.tsx` | Modify | Accept + pass `dailyByToken` prop to `PaymentsAmountChart` |
| `src/app/payments/page.tsx` | Modify | Update subtitle text |
| `src/app/dex/page.tsx` | Modify | Fetch `feeAmountData`, import `FeeTokenAmountChart`, add chart below existing count chart |
| `__tests__/lib/chart-data-contracts.test.ts` | Modify | Add contract tests for `getPaymentsDailyByToken` and `getFeeTokenAmountDailyStats` |

---

## Task 1: Update mv_memo_payments_daily SQL (view + backfill + failed actors)

**Files:**
- Modify: `sql/clickhouse/views/payments/mv_memo_payments_daily.sql`
- Modify: `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql`
- Modify: `sql/clickhouse/views/payments/mv_memo_payments_failed_actors.sql`

- [ ] **Step 1: Update the MV view SQL**

Replace the `lower(address) = '0x20c0000000000000000000000000000000000000'` filter in **both** SELECT blocks of `sql/clickhouse/views/payments/mv_memo_payments_daily.sql` (success view at line 59, failed view at line 95) with the full whitelist. The file has two separate `CREATE MATERIALIZED VIEW` statements — update each one.

In `mv_memo_payments_daily_success_view` (around line 59), change:
```sql
    AND lower(address) = '0x20c0000000000000000000000000000000000000'
```
to:
```sql
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
```

Apply the **exact same** replacement in `mv_memo_payments_daily_failed_view` (the second SELECT block), where the failing txs query also has `AND lower(txs.to) = '0x20c0000000000000000000000000000000000000'`.

- [ ] **Step 2: Update the backfill SQL**

In `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql`, apply the same IN-clause replacement in both the success block (line 39) and the failed block (line 74 — the `lower(txs.to) = '...'` line).

- [ ] **Step 3: Read and update mv_memo_payments_failed_actors.sql**

Read the file first to find the hardcoded address:

```bash
cat sql/clickhouse/views/payments/mv_memo_payments_failed_actors.sql
```

Replace the single-address filter for `lower(txs.to)` with the same full IN-clause from Step 1.

- [ ] **Step 4: Commit SQL changes**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
git add sql/clickhouse/views/payments/mv_memo_payments_daily.sql \
        sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql \
        sql/clickhouse/views/payments/mv_memo_payments_failed_actors.sql
git commit -m "sql: expand mv_memo_payments_daily to full stablecoin whitelist"
```

---

## Task 2: Create mv_fee_token_amount_daily SQL (view + backfill)

**Files:**
- Create: `sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql`
- Create: `sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql`

- [ ] **Step 1: Create the MV view file**

Create `sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql` with this exact content:

```sql
-- @name:         mv_fee_token_amount_daily
-- @domain:       chain
-- @kind:         materialized_view
-- @purpose:      Daily fee token USD amounts paid (gas_used × effective_gas_price / 1e18)
-- @upstream:     tidx_4217.receipts, tidx_4217.txs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts
-- @backfill:     sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

CREATE TABLE IF NOT EXISTS tidx_4217.mv_fee_token_amount_daily
(
  day       Date,
  fee_token String,
  fee_usd   Float64
)
ENGINE = SummingMergeTree
ORDER BY (day, fee_token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_fee_token_amount_daily_view
TO tidx_4217.mv_fee_token_amount_daily
AS
SELECT
  toDate(r.block_timestamp)                                                         AS day,
  t.fee_token                                                                        AS fee_token,
  sum(toFloat64(r.gas_used) * toFloat64OrZero(r.effective_gas_price) / 1e18)        AS fee_usd
FROM tidx_4217.receipts r
JOIN tidx_4217.txs t ON t.hash = r.tx_hash
WHERE t.fee_token IS NOT NULL AND t.fee_token != ''
GROUP BY day, fee_token;
```

- [ ] **Step 2: Create the backfill file**

Create `sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql`:

```sql
-- @name:         mv_fee_token_amount_daily
-- @domain:       chain
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_fee_token_amount_daily.
-- @pairs:        sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_fee_token_amount_daily
SELECT
  toDate(r.block_timestamp)                                                         AS day,
  t.fee_token                                                                        AS fee_token,
  sum(toFloat64(r.gas_used) * toFloat64OrZero(r.effective_gas_price) / 1e18)        AS fee_usd
FROM tidx_4217.receipts r
JOIN tidx_4217.txs t ON t.hash = r.tx_hash
WHERE t.fee_token IS NOT NULL AND t.fee_token != ''
GROUP BY day, fee_token;
```

- [ ] **Step 3: Commit**

```bash
git add sql/clickhouse/views/chain/mv_fee_token_amount_daily.sql \
        sql/clickhouse/backfills/chain/mv_fee_token_amount_daily.sql
git commit -m "sql: add mv_fee_token_amount_daily for daily fee USD amounts"
```

---

## Task 3: Apply SQL changes via takopi and validate live data

**Files:** None (database operations only)

- [ ] **Step 1: Check available takopi capabilities**

```bash
cd /home/evan/Documents/takopi_adventures
takopi list
takopi explain mv_memo_payments_daily
```

- [ ] **Step 2: Recreate mv_memo_payments_daily with the new filter**

Use whatever `takopi` command recreates and backfills the MV (e.g. `takopi rebuild mv_memo_payments_daily` or similar). The SQL files have been updated in Task 1.

- [ ] **Step 3: Create and backfill mv_fee_token_amount_daily**

```bash
takopi rebuild mv_fee_token_amount_daily
# or the appropriate takopi command for a new MV
```

- [ ] **Step 4: Validate payment data now covers USDC.e**

```bash
curl -s "http://localhost:8123/?database=tidx_4217&query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('SELECT token, count() as payments, round(sum(total_amount),2) as usd FROM mv_memo_payments_daily WHERE day >= today() - 30 GROUP BY token ORDER BY usd DESC FORMAT JSON'))")" | python3 -m json.tool
```

Expected: USDC.e (`0x20c0…b950`) appears with ~138k payments and ~$289k USD. If only pathUSD shows, the backfill hasn't run yet.

- [ ] **Step 5: Validate fee amount MV has data**

```bash
curl -s "http://localhost:8123/?database=tidx_4217&query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('SELECT fee_token, round(sum(fee_usd),6) as total_usd, count() as days FROM mv_fee_token_amount_daily GROUP BY fee_token ORDER BY total_usd DESC FORMAT JSON'))")" | python3 -m json.tool
```

Expected: USDC.e and pathUSD appear with small positive USD amounts (~$0.001 per tx × tx count). Negative totals or zero indicate a parsing issue — check `effective_gas_price` NULL coverage:

```bash
curl -s "http://localhost:8123/?database=tidx_4217&query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('SELECT countIf(effective_gas_price IS NULL) as nulls, countIf(effective_gas_price IS NOT NULL) as populated FROM receipts WHERE block_timestamp >= now() - INTERVAL 7 DAY FORMAT JSON'))")" | python3 -m json.tool
```

---

## Task 4: Contract test for getPaymentsDailyByToken — write failing test

**Files:**
- Modify: `__tests__/lib/chart-data-contracts.test.ts`

- [ ] **Step 1: Add the import for getPaymentsDailyByToken**

In `__tests__/lib/chart-data-contracts.test.ts`, add to the existing `payments` import block (after the analytics imports around line 76):

```ts
import { getPaymentsDailyByToken } from '@/lib/payments'
```

- [ ] **Step 2: Add the contract test block**

Append this describe block at the end of the file, before the final closing:

```ts
// Chart: PaymentsAmountChart (stacked by token)
// DataKeys: token addresses (dynamic, from data.tokens[].address)
describe('getPaymentsDailyByToken → PaymentsAmountChart', () => {
  const USDC_E  = '0x20c000000000000000000000b9537d11c60e8b50'
  const PATHUSD = '0x20c0000000000000000000000000000000000000'

  test('pivot contract: token addresses appear as numeric keys in days rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', token: USDC_E,  total_amount: '150.50' },
      { day: '2026-04-01', token: PATHUSD, total_amount: '30.00' },
      { day: '2026-04-02', token: USDC_E,  total_amount: '200.00' },
    ])
    mockGetTokenInfo
      .mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin (Bridged)', decimals: 6, address: USDC_E })
      .mockResolvedValueOnce({ symbol: 'pathUSD', name: 'pathUSD', decimals: 6, address: PATHUSD })

    const data = await getPaymentsDailyByToken(2)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })

  test('pivot contract: unknown token falls back to address key and still has finite value', async () => {
    mockQueryOnce([
      { day: '2026-04-01', token: USDC_E, total_amount: '500.00' },
    ])
    mockGetTokenInfo.mockResolvedValueOnce(null)

    const data = await getPaymentsDailyByToken(1)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })

  test('tokens are sorted by total descending', async () => {
    mockQueryOnce([
      { day: '2026-04-01', token: PATHUSD, total_amount: '10.00' },
      { day: '2026-04-01', token: USDC_E,  total_amount: '500.00' },
    ])
    mockGetTokenInfo
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const data = await getPaymentsDailyByToken(1)
    expect(data.tokens[0].total).toBeGreaterThanOrEqual(data.tokens[1].total)
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
npx jest --testPathPattern="chart-data-contracts" --verbose 2>&1 | tail -30
```

Expected: FAIL — `getPaymentsDailyByToken` is not yet exported from `@/lib/payments`. The error should say something like "is not a function" or import error.

---

## Task 5: Implement payments.ts changes

**Files:**
- Modify: `src/lib/payments.ts`

This task: (a) removes `PAYMENT_METHODS`, (b) updates all query builders to use the stablecoin IN-clause, (c) adds `PaymentsDailyByToken` + `getPaymentsDailyByToken()`, (d) adds `dailyByToken` to `PaymentsPageData`.

- [ ] **Step 1: Replace the imports and remove PAYMENT_METHODS**

At the top of `src/lib/payments.ts`, replace:
```ts
import { getCached, setCached } from '@/lib/cache'
import { queryClickHouse } from '@/lib/clickhouse'
```
with:
```ts
import { getCached, setCached } from '@/lib/cache'
import { queryClickHouse } from '@/lib/clickhouse'
import { STABLECOIN_ADDRESSES, KNOWN_TOKENS, getTokenInfo } from '@/lib/tokens'
```

Delete the `SupportedPaymentMethod` interface and the entire `PAYMENT_METHODS` constant (lines 10–25 in the original).

- [ ] **Step 2: Add the stablecoin address list helper**

Directly after the imports, add a module-level constant:

```ts
// SQL-ready IN-list for all verified stablecoins. Mirrors STABLECOIN_ADDRESSES.
const STABLECOIN_IN_LIST = STABLECOIN_ADDRESSES.map(a => `'${a}'`).join(', ')

// All verified stablecoins use 6 decimals.
const PAYMENT_DECIMALS = 6
```

- [ ] **Step 3: Replace buildSuccessfulPaymentsQuery**

Replace the entire `buildSuccessfulPaymentsQuery` function with:

```ts
function buildSuccessfulPaymentsQuery(days: number): string {
  return `
    SELECT
      block_timestamp,
      tx_hash,
      topic1 AS sender,
      topic2 AS recipient,
      lower(address) AS token,
      toString(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) AS amount_raw,
      lower(topic3) AS memo_hex
    FROM logs
    WHERE block_timestamp >= now() - INTERVAL ${days} DAY
      AND selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
      AND lower(address) IN (${STABLECOIN_IN_LIST})
  `
}
```

- [ ] **Step 4: Replace buildFailedPaymentsQuery**

Replace the entire `buildFailedPaymentsQuery` function with:

```ts
function buildFailedPaymentsQuery(days: number): string {
  return `
    SELECT
      txs.block_timestamp,
      txs.hash AS tx_hash,
      lower(txs.from) AS sender,
      lower(concat('0x', substr(txs.input, 35, 40))) AS recipient,
      lower(txs.to) AS token,
      toString(reinterpretAsUInt256(reverse(unhex(substr(txs.input, 75, 64))))) AS amount_raw,
      lower(concat('0x', substr(txs.input, 139, 64))) AS memo_hex
    FROM txs
    LEFT JOIN receipts ON receipts.tx_hash = txs.hash
    WHERE txs.block_timestamp >= now() - INTERVAL ${days} DAY
      AND startsWith(lower(txs.input), '0x95777d59')
      AND lower(txs.to) IN (${STABLECOIN_IN_LIST})
      AND (receipts.status = 0 OR receipts.status = '0')
  `
}
```

- [ ] **Step 5: Replace buildRawPaymentsSourceQuery**

Replace the entire `buildRawPaymentsSourceQuery` function with:

```ts
function buildRawPaymentsSourceQuery(days: number, statuses: PaymentStatus[] = ['success', 'failed']): string {
  const sources: string[] = []

  if (statuses.includes('success')) {
    sources.push(`
      SELECT
        toDate(block_timestamp) AS day,
        concat('0x', lower(substring(topic1, 27, 40))) AS sender,
        concat('0x', lower(substring(topic2, 27, 40))) AS recipient,
        toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / ${10 ** PAYMENT_DECIMALS} AS amount,
        'success' AS status
      FROM logs
      WHERE block_timestamp >= now() - INTERVAL ${days} DAY
        AND selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
        AND lower(address) IN (${STABLECOIN_IN_LIST})
    `)
  }

  if (statuses.includes('failed')) {
    sources.push(`
      SELECT
        day,
        sender,
        recipient,
        0.0 AS amount,
        'failed' AS status
      FROM mv_memo_payments_failed_actors
      WHERE day >= today() - ${days}
        AND token IN (${STABLECOIN_IN_LIST})
    `)
  }

  return sources.join('\nUNION ALL\n')
}
```

- [ ] **Step 6: Replace normalizePaymentRow**

Replace the entire `normalizePaymentRow` function with:

```ts
function normalizePaymentRow(row: RawPaymentRow, status: PaymentStatus): PaymentRow {
  const tokenInfo = KNOWN_TOKENS[row.token.toLowerCase()]
  const memo = decodeMemoHex(row.memo_hex)
  return {
    timestamp: row.block_timestamp,
    day: sliceDay(row.block_timestamp),
    tx_hash: row.tx_hash.toLowerCase(),
    sender: topicToAddress(row.sender),
    recipient: topicToAddress(row.recipient),
    token: row.token.toLowerCase(),
    token_label: tokenInfo?.symbol ?? `${row.token.slice(0, 8)}…`,
    amount: normalizeAmount(row.amount_raw, PAYMENT_DECIMALS),
    status,
    memo_hex: memo.memo_hex,
    memo_text: memo.memo_text,
    memo_kind: memo.memo_kind,
    memo_family: classifyMemoFamily(memo.memo_text),
  }
}
```

- [ ] **Step 7: Fix normalizeAggregateAmount**

Replace the body of `normalizeAggregateAmount` with:

```ts
function normalizeAggregateAmount(value: { total_amount?: string | number; total_amount_raw?: string | number }) {
  if (value.total_amount_raw !== undefined) {
    return roundTo(Number(value.total_amount_raw ?? 0) / 10 ** PAYMENT_DECIMALS)
  }
  return roundTo(toNumber(value.total_amount))
}
```

- [ ] **Step 8: Add PaymentsDailyByToken type**

Add this interface after `PaymentsDailyPoint` (around line 56 in the original):

```ts
export interface PaymentsDailyByToken {
  /** One entry per day; each keyed by token address → USD amount */
  days: Array<Record<string, string | number>>
  /** Tokens sorted by all-period total descending */
  tokens: Array<{ address: string; symbol: string; total: number }>
}
```

- [ ] **Step 9: Add dailyByToken to PaymentsPageData**

In the `PaymentsPageData` interface, add:

```ts
dailyByToken: PaymentsDailyByToken
```

- [ ] **Step 10: Add getPaymentsDailyByToken function**

Add this function after `getPaymentsDaily` (before `getPaymentsSummary`):

```ts
export async function getPaymentsDailyByToken(days = 30): Promise<PaymentsDailyByToken> {
  const cacheKey = `payments:daily-by-token:${days}`
  const cached = await getCached<PaymentsDailyByToken>(cacheKey)
  if (cached !== null) return cached

  const rows = await queryClickHouse<{ day: string; token: string; total_amount: string | number }>(`
    SELECT
      day,
      token,
      sum(total_amount) AS total_amount
    FROM mv_memo_payments_daily
    WHERE day >= today() - ${days}
    GROUP BY day, token
    ORDER BY day ASC
  `)

  // Aggregate totals per token across the period
  const tokenTotals = new Map<string, number>()
  for (const r of rows) {
    tokenTotals.set(r.token, (tokenTotals.get(r.token) ?? 0) + toNumber(r.total_amount))
  }

  // Resolve symbols via KNOWN_TOKENS cache (skipRPC — these are all system tokens)
  const tokenEntries = await Promise.all(
    [...tokenTotals.entries()].map(async ([address, total]) => {
      const info = await getTokenInfo(address, { skipRPC: true })
      return {
        address,
        symbol: info?.symbol ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
        total: roundTo(total),
      }
    })
  )
  tokenEntries.sort((a, b) => b.total - a.total)

  // Pivot by day: { day, [tokenAddress]: amount, … }
  const dayMap = new Map<string, Record<string, string | number>>()
  for (const r of rows) {
    const day = sliceDay(String(r.day))
    if (!dayMap.has(day)) dayMap.set(day, { day })
    dayMap.get(day)![r.token] = roundTo(toNumber(r.total_amount))
  }
  const dayRows = [...dayMap.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)))

  const result: PaymentsDailyByToken = { days: dayRows, tokens: tokenEntries }
  await setCached(cacheKey, result, CACHE_TTL_SECONDS)
  return result
}
```

- [ ] **Step 11: Wire dailyByToken into getPaymentsPageData**

In `getPaymentsPageData`, add `getPaymentsDailyByToken()` to the Promise.all and destructure:

```ts
export async function getPaymentsPageData(): Promise<PaymentsPageData> {
  const [summary, daily, dailyByToken, recent, topRecipientsByAmount, topRecipientsByCount, topSenders] =
    await Promise.all([
      getPaymentsSummary(),
      getPaymentsDaily(),
      getPaymentsDailyByToken(),
      getRecentPayments(),
      getTopCounterparties('recipient', 'amount'),
      getTopCounterparties('recipient', 'count'),
      getTopCounterparties('sender', 'count'),
    ])

  return {
    summary,
    daily,
    dailyByToken,
    recent,
    topRecipientsByAmount,
    topRecipientsByCount,
    topSenders,
  }
}
```

---

## Task 6: Run payments contract test — verify passing, commit

**Files:** None (verification only)

- [ ] **Step 1: Run the contract test**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
npx jest --testPathPattern="chart-data-contracts" --verbose 2>&1 | grep -A 3 "getPaymentsDailyByToken"
```

Expected output:
```
  getPaymentsDailyByToken → PaymentsAmountChart
    ✓ pivot contract: token addresses appear as numeric keys in days rows
    ✓ pivot contract: unknown token falls back to address key and still has finite value
    ✓ tokens are sorted by total descending
```

If failing, check that `getPaymentsDailyByToken` is exported and the `roundTo` helper is used (not raw `Number()`).

- [ ] **Step 2: Run the full test suite**

```bash
npx jest 2>&1 | tail -15
```

Expected: all tests pass. Fix any TypeScript or import errors before committing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/payments.ts __tests__/lib/chart-data-contracts.test.ts
git commit -m "feat: expand payments to full stablecoin whitelist, add getPaymentsDailyByToken"
```

---

## Task 7: Contract test for getFeeTokenAmountDailyStats — write failing test

**Files:**
- Modify: `__tests__/lib/chart-data-contracts.test.ts`

- [ ] **Step 1: Add getFeeTokenAmountDailyStats to the analytics import**

In the existing analytics import around line 70, add `getFeeTokenAmountDailyStats`:

```ts
import {
  getDailyStats,
  getDailyStatsCategorized,
  getStablecoinDailyVolume,
  getStablecoinSupplyHistory,
  getDexDailyVolumeUSD,
  getFeeTokenAllDailyStats,
  getFeeTokenAmountDailyStats,
  getProtocolDexTokenDailyStats,
} from '@/lib/analytics'
```

- [ ] **Step 2: Add the contract test block**

Append after the `getFeeTokenAllDailyStats` describe block:

```ts
// Chart: FeeTokenAmountChart
// DataKeys: fee_token addresses (dynamic, from data.tokens[].address)
describe('getFeeTokenAmountDailyStats → FeeTokenAmountChart', () => {
  const TOKEN_A = '0xaaaa000000000000000000000000000000000000'
  const TOKEN_B = '0xbbbb000000000000000000000000000000000000'

  test('pivot contract: token addresses appear as numeric keys in days rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: TOKEN_A, fee_usd: '0.042' },
      { day: '2026-04-01', fee_token: TOKEN_B, fee_usd: '0.010' },
      { day: '2026-04-02', fee_token: TOKEN_A, fee_usd: '0.038' },
    ])
    mockGetTokenInfo
      .mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin (Bridged)', decimals: 6, address: TOKEN_A })
      .mockResolvedValueOnce({ symbol: 'pathUSD', name: 'pathUSD', decimals: 6, address: TOKEN_B })

    const data = await getFeeTokenAmountDailyStats(2)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })

  test('pivot contract: zero fee_usd is a valid finite number (no NaN)', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: TOKEN_A, fee_usd: '0' },
    ])
    mockGetTokenInfo.mockResolvedValueOnce(null)

    const data = await getFeeTokenAmountDailyStats(1)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })

  test('tokens are sorted by total descending', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: TOKEN_B, fee_usd: '0.001' },
      { day: '2026-04-01', fee_token: TOKEN_A, fee_usd: '0.050' },
    ])
    mockGetTokenInfo.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const data = await getFeeTokenAmountDailyStats(1)
    expect(data.tokens[0].total).toBeGreaterThanOrEqual(data.tokens[1].total)
  })
})
```

- [ ] **Step 3: Run and verify it fails**

```bash
npx jest --testPathPattern="chart-data-contracts" --verbose 2>&1 | grep -A 3 "getFeeTokenAmountDailyStats"
```

Expected: FAIL — `getFeeTokenAmountDailyStats` not yet defined in `@/lib/analytics`.

---

## Task 8: Implement getFeeTokenAmountDailyStats in analytics.ts

**Files:**
- Modify: `src/lib/analytics.ts`

- [ ] **Step 1: Add FeeTokenAmountDailyStat type**

In `src/lib/analytics.ts`, after the `FeeTokenAllDailyStat` interface (around line 667), add:

```ts
export interface FeeTokenAmountDailyStat {
  /** One entry per day; each keyed by fee_token address → fee_usd amount */
  days:   Array<Record<string, string | number>>
  /** Tokens sorted by all-period total USD descending */
  tokens: Array<{ address: string; symbol: string; total: number }>
}
```

- [ ] **Step 2: Add getFeeTokenAmountDailyStats function**

After the `getFeeTokenAllDailyStats` function (around line 715), add:

```ts
export async function getFeeTokenAmountDailyStats(days = 30): Promise<FeeTokenAmountDailyStat> {
  const key = `analytics:fee_token_amount_daily:${days}`
  const cached = await getCached<FeeTokenAmountDailyStat>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ day: string; fee_token: string; fee_usd: string }>(`
    SELECT day, fee_token, sum(fee_usd) AS fee_usd
    FROM mv_fee_token_amount_daily
    WHERE day >= today() - ${days}
    GROUP BY day, fee_token
    ORDER BY day ASC, fee_usd DESC
  `)

  // Aggregate totals per token across the period
  const tokenTotals = new Map<string, number>()
  for (const r of rows) {
    tokenTotals.set(r.fee_token, (tokenTotals.get(r.fee_token) ?? 0) + Number(r.fee_usd))
  }

  // Resolve symbols
  const tokenEntries = await Promise.all(
    [...tokenTotals.entries()].map(async ([address, total]) => {
      const info = await getTokenInfo(address, { skipRPC: true })
      return { address, symbol: info?.symbol ?? `${address.slice(0, 6)}…${address.slice(-4)}`, total }
    })
  )
  tokenEntries.sort((a, b) => b.total - a.total)

  // Pivot by day
  const dayMap = new Map<string, Record<string, string | number>>()
  for (const r of rows) {
    const day = String(r.day).slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, { day })
    dayMap.get(day)![r.fee_token] = Number(r.fee_usd)
  }
  const dayRows = [...dayMap.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)))

  const result: FeeTokenAmountDailyStat = { days: dayRows, tokens: tokenEntries }
  await setCached(key, result, 900)
  return result
}
```

---

## Task 9: Run fee amount contract test — verify passing, commit

**Files:** None (verification only)

- [ ] **Step 1: Run the contract test**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
npx jest --testPathPattern="chart-data-contracts" --verbose 2>&1 | grep -A 4 "getFeeTokenAmountDailyStats"
```

Expected:
```
  getFeeTokenAmountDailyStats → FeeTokenAmountChart
    ✓ pivot contract: token addresses appear as numeric keys in days rows
    ✓ pivot contract: zero fee_usd is a valid finite number (no NaN)
    ✓ tokens are sorted by total descending
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics.ts __tests__/lib/chart-data-contracts.test.ts
git commit -m "feat: add FeeTokenAmountDailyStat and getFeeTokenAmountDailyStats"
```

---

## Task 10: Rewrite PaymentsAmountChart as stacked stablecoin chart

**Files:**
- Modify: `src/components/charts/PaymentsAmountChart.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/components/charts/PaymentsAmountChart.tsx` with:

```tsx
'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { PaymentsDailyByToken } from '@/lib/payments'

const PALETTE = [
  '#0057FF', '#10B981', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16',
]

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
})

function CustomLegend({ tokens, total }: {
  tokens: PaymentsDailyByToken['tokens']
  total: number
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
      {tokens.map((t, i) => (
        <div key={t.address} className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
          />
          <span className="text-tempo-muted">{t.symbol}</span>
          <span className="text-white font-mono">{usdFmt.format(t.total)}</span>
          <span className="text-tempo-muted">
            ({total > 0 ? ((t.total / total) * 100).toFixed(1) : '0'}%)
          </span>
        </div>
      ))}
    </div>
  )
}

export function PaymentsAmountChart({ data }: { data: PaymentsDailyByToken }) {
  const total = data.tokens.reduce((s, t) => s + t.total, 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data.days} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
          <XAxis
            dataKey="day"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => String(v).slice(5)}
            interval="preserveStartEnd"
            label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => usdFmt.format(v)}
            width={72}
            label={{ value: 'Amount (USD)', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
            labelStyle={{ color: '#fff', marginBottom: 4 }}
            itemStyle={{ color: '#6B7280' }}
            formatter={(v: number, _name: string, entry) => {
              const token = data.tokens.find(t => t.address === entry.dataKey)
              return [usdFmt.format(v), token?.symbol ?? String(entry.dataKey)]
            }}
          />
          {data.tokens.map((t, i) => (
            <Bar
              key={t.address}
              dataKey={t.address}
              name={t.symbol}
              stackId="1"
              fill={PALETTE[i % PALETTE.length]}
              radius={i === data.tokens.length - 1 ? [2, 2, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <CustomLegend tokens={data.tokens} total={total} />
    </div>
  )
}
```

---

## Task 11: Wire payments page — update PaymentsNarrative props and subtitle

**Files:**
- Modify: `src/components/payments/PaymentsNarrative.tsx`
- Modify: `src/app/payments/page.tsx`

- [ ] **Step 1: Update PaymentsNarrative to accept and pass dailyByToken**

In `src/components/payments/PaymentsNarrative.tsx`:

1. Update the import at the top to add `PaymentsDailyByToken`:
```ts
import type { PaymentCounterpartyRow, PaymentsDailyPoint, PaymentsDailyByToken } from '@/lib/payments'
```

2. Update the props type to add `dailyByToken`:
```ts
export function PaymentsNarrative({
  daily,
  dailyByToken,
  topRecipientsByAmount,
  topRecipientsByCount,
  topSenders,
}: {
  daily: PaymentsDailyPoint[]
  dailyByToken: PaymentsDailyByToken
  topRecipientsByAmount: PaymentCounterpartyRow[]
  topRecipientsByCount: PaymentCounterpartyRow[]
  topSenders: PaymentCounterpartyRow[]
}) {
```

3. Update the `PaymentsAmountChart` usage to pass `data={dailyByToken}` instead of `data={daily}`:
```tsx
<ChartCard title="Daily Payment Amount">
  <PaymentsAmountChart data={dailyByToken} />
</ChartCard>
```

- [ ] **Step 2: Update payments page to pass dailyByToken**

In `src/app/payments/page.tsx`, update the `PaymentsNarrative` usage to pass `dailyByToken`:

```tsx
<PaymentsNarrative
  daily={data.daily}
  dailyByToken={data.dailyByToken}
  topRecipientsByAmount={data.topRecipientsByAmount}
  topRecipientsByCount={data.topRecipientsByCount}
  topSenders={data.topSenders}
/>
```

- [ ] **Step 3: Update the subtitle**

In `src/app/payments/page.tsx`, change:
```tsx
memo-bearing payment activity across Tempo
```
to:
```tsx
TIP-20 transferWithMemo activity across verified stablecoins
```

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/PaymentsAmountChart.tsx \
        src/components/payments/PaymentsNarrative.tsx \
        src/app/payments/page.tsx
git commit -m "feat: payments stacked amount chart by stablecoin, update subtitle"
```

---

## Task 12: New FeeTokenAmountChart component

**Files:**
- Create: `src/components/charts/FeeTokenAmountChart.tsx`

- [ ] **Step 1: Create the file**

Create `src/components/charts/FeeTokenAmountChart.tsx`:

```tsx
'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { FeeTokenAmountDailyStat } from '@/lib/analytics'

const PALETTE = [
  '#0057FF', '#10B981', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16',
]

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
})

function CustomLegend({ tokens, total }: {
  tokens: FeeTokenAmountDailyStat['tokens']
  total: number
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
      {tokens.map((t, i) => (
        <div key={t.address} className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
          />
          <span className="text-tempo-muted">{t.symbol}</span>
          <span className="text-white font-mono">{usdFmt.format(t.total)}</span>
          <span className="text-tempo-muted">
            ({total > 0 ? ((t.total / total) * 100).toFixed(1) : '0'}%)
          </span>
        </div>
      ))}
    </div>
  )
}

export function FeeTokenAmountChart({ data }: { data: FeeTokenAmountDailyStat }) {
  const total = data.tokens.reduce((s, t) => s + t.total, 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data.days} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
          <XAxis
            dataKey="day"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => String(v).slice(5)}
            interval="preserveStartEnd"
            label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => usdFmt.format(v)}
            width={80}
            label={{ value: 'Fee Amount (USD)', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
            labelStyle={{ color: '#fff', marginBottom: 4 }}
            itemStyle={{ color: '#6B7280' }}
            formatter={(v: number, _name: string, entry) => {
              const token = data.tokens.find(t => t.address === entry.dataKey)
              return [usdFmt.format(v), token?.symbol ?? String(entry.dataKey)]
            }}
          />
          {data.tokens.map((t, i) => (
            <Bar
              key={t.address}
              dataKey={t.address}
              name={t.symbol}
              stackId="1"
              fill={PALETTE[i % PALETTE.length]}
              radius={i === data.tokens.length - 1 ? [2, 2, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <CustomLegend tokens={data.tokens} total={total} />
    </div>
  )
}
```

---

## Task 13: Wire FeeTokenAmountChart into the DEX page

**Files:**
- Modify: `src/app/dex/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/app/dex/page.tsx`, add to the existing imports:

```ts
import { getFeeTokenAmountDailyStats } from '@/lib/analytics'
import { FeeTokenAmountChart } from '@/components/charts/FeeTokenAmountChart'
```

- [ ] **Step 2: Add feeAmountData to the Promise.all**

In the `DexPage` server component, add `getFeeTokenAmountDailyStats(days)` to the existing `Promise.all` destructure:

```ts
const [feeData, feeAmountData, protocolDaily, protocolTokenData, communityDaily, pools, protocolTVL, communityTVL, protocolDexPools] = await Promise.all([
  getFeeTokenAllDailyStats(days),
  getFeeTokenAmountDailyStats(days),
  getProtocolDexDailyStats(days),
  getProtocolDexTokenDailyStats(days),
  getDexDailyVolumeUSD(days),
  getTopPools(10),
  getProtocolDexTVL(),
  getCommunityDexTVL(),
  getProtocolDexPools(days),
])
```

- [ ] **Step 3: Add the chart below the existing FeeTokenAllChart**

In the Fee AMM section, find the block that renders `FeeTokenAllChart` and add the amount chart directly after it:

```tsx
{feeData.days.length > 0 && (
  <div className="space-y-4">
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
      <h3 className="text-sm font-medium text-white mb-4">Daily Fee Token Usage ({periodLabel})</h3>
      <FeeTokenAllChart data={feeData} />
    </div>
    {feeAmountData.days.length > 0 && (
      <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
        <h3 className="text-sm font-medium text-white mb-4">Daily Fee Token Amount ({periodLabel})</h3>
        <FeeTokenAmountChart data={feeAmountData} />
      </div>
    )}
  </div>
)}
```

Note: the outer `{feeData.days.length > 0 && (...)}` currently wraps only one card. Replace the single card with this two-card `space-y-4` wrapper. Keep the conditional guard on `feeAmountData.days.length` so the amount chart doesn't render an empty card if the MV backfill hasn't run yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/FeeTokenAmountChart.tsx src/app/dex/page.tsx
git commit -m "feat: add daily fee token amount chart to DEX page"
```

---

## Task 14: Full validation — tests, build, and localhost browser check

**Files:** None (validation only)

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
npm test 2>&1 | tail -20
```

Expected: all tests pass with no failures. If any fail, fix before proceeding.

- [ ] **Step 2: Run the production build**

```bash
npm run build 2>&1 | tail -30
```

Expected: build completes with no TypeScript errors and no "Module not found" errors. Common issues to watch for:
- `PaymentsDailyByToken` not exported from `@/lib/payments` → check the export in payments.ts
- `FeeTokenAmountDailyStat` not exported from `@/lib/analytics` → check the export
- `dailyByToken` prop missing type on `PaymentsNarrative` → check the props destructure

- [ ] **Step 3: Start the dev server**

```bash
npm run dev 2>&1 &
# wait ~5 seconds for the server to start
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/payments
```

Expected: `200`. If not 200, check server logs.

- [ ] **Step 4: Validate the payments page renders**

Open `http://localhost:3000/payments` in a browser and verify:
- Page subtitle shows "TIP-20 transferWithMemo activity across verified stablecoins"
- "Daily Payment Amount" chart renders as a **stacked** bar chart (not a single-color chart)
- The legend below the chart shows at minimum USDC.e and pathUSD with dollar amounts
- USDC.e segment should be visually dominant (~94% of the stack)
- Hovering a bar shows a tooltip with per-token breakdown formatted as `"SYMBOL: $X.XX"`
- The Daily Payments Trend and Memo Pattern Mix charts are unchanged

If the chart is invisible (bars not rendering): the most likely cause is data computed client-side. Confirm `PaymentsAmountChart` receives `data.days` with token address keys that are `number` type — add a `console.log(data.days[0])` temporarily and check in the browser console.

- [ ] **Step 5: Validate the DEX page renders**

Open `http://localhost:3000/dex` in a browser and verify:
- The Fee AMM section now shows **two** chart cards stacked vertically
- First card: "Daily Fee Token Usage (30d)" — count chart (unchanged)
- Second card: "Daily Fee Token Amount (30d)" — new USD chart
- If the second card is missing, the MV backfill from Task 3 may not have run yet (check Task 3 Step 5)
- Tooltip in the amount chart shows dollar values, not counts

- [ ] **Step 6: Check for console errors**

In the browser developer tools console, verify:
- No React key warnings
- No `NaN` or `undefined` dataKey warnings from Recharts
- No unhandled errors

- [ ] **Step 7: Final commit with build artifact cleanup**

```bash
# Stop dev server if running
kill %1 2>/dev/null || true

cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics
git status
# Commit any remaining unstaged changes (should be none at this point)
```

If `git status` shows clean working tree, the implementation is complete.
