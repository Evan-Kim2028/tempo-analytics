# Payments Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new top-level `Payments` analytics tab that surfaces memo-bearing payment activity on Tempo with summary cards, a prominent recent-payments table, and supporting trend/concentration analysis.

**Architecture:** Keep the page server-rendered and aligned with the current analytics surfaces. Use a hybrid data model: raw indexed queries for recent rows and memo analysis, plus one lightweight ClickHouse daily-rollup materialized view for repeated card/chart queries. Seed the parser with the confirmed pathUSD memo rail, but implement every query against a small `PAYMENT_METHODS` registry so additional memo-bearing rails can be added by data entry rather than by rewriting the page.

**Tech Stack:** Next.js 15 app router, React 19, TypeScript, Jest, Testing Library, Recharts, ClickHouse HTTP queries, repo-owned SQL materialized views/backfills.

---

## File Structure

### Create

- `sql/clickhouse/views/payments/mv_memo_payments_daily.sql`
- `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql`
- `src/app/payments/page.tsx`
- `src/app/payments/loading.tsx`
- `src/components/payments/PaymentsSummary.tsx`
- `src/components/payments/RecentPaymentsTable.tsx`
- `src/components/payments/PaymentsNarrative.tsx`
- `src/components/charts/PaymentsCountChart.tsx`
- `src/components/charts/PaymentsAmountChart.tsx`
- `src/components/charts/PaymentsMemoPatternChart.tsx`
- `src/lib/payments.ts`
- `__tests__/app/payments.page.test.tsx`
- `__tests__/components/PaymentsNarrative.test.tsx`
- `__tests__/components/PaymentsSummary.test.tsx`
- `__tests__/components/RecentPaymentsTable.test.tsx`
- `__tests__/lib/payments.test.ts`

### Modify

- `src/components/nav/PrimaryNav.tsx`
- `__tests__/components/PrimaryNav.test.tsx`

### Responsibilities

- `src/lib/payments.ts`: selector registry, memo decoding, success/failure normalization, summary queries, concentration queries, and page-level data fetch helpers.
- `sql/clickhouse/views/payments/mv_memo_payments_daily.sql`: narrow daily rollup for counts, amount, unique actors, and memo readability buckets.
- `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql`: backfill for the same rollup schema.
- `src/components/payments/PaymentsSummary.tsx`: summary-card row using existing card styling.
- `src/components/payments/RecentPaymentsTable.tsx`: dominant split-view table with status, token, memo, and memo-family columns.
- `src/components/payments/PaymentsNarrative.tsx`: charts and concentration sections under the table.
- `src/app/payments/page.tsx`: server page that composes the full surface and keeps partial-failure handling localized.
- `src/app/payments/loading.tsx`: skeleton for cards, table, and chart sections.

## Shared Data Shapes

Use these shared types in `src/lib/payments.ts` and keep tests aligned with them:

```ts
export type PaymentStatus = 'success' | 'failed'
export type MemoKind = 'readable' | 'opaque' | 'empty'

export interface SupportedPaymentMethod {
  token: string
  token_label: string
  call_selector: string
  event_selector: string
  decimals: number
}

export interface PaymentRow {
  timestamp: string
  day: string
  tx_hash: string
  sender: string
  recipient: string
  token: string
  token_label: string
  amount: number
  status: PaymentStatus
  memo_hex: string
  memo_text: string | null
  memo_kind: MemoKind
  memo_family: string | null
}

export interface PaymentsSummaryStats {
  successful_payments: number
  failed_attempts: number
  success_rate: number
  total_amount: number
  unique_senders: number
  unique_recipients: number
}

export interface PaymentsDailyPoint {
  day: string
  successful_payments: number
  failed_attempts: number
  total_amount: number
  unique_senders: number
  unique_recipients: number
  readable_memos: number
  opaque_memos: number
  empty_memos: number
}

export interface PaymentCounterpartyRow {
  address: string
  payment_count: number
  total_amount: number
}

export interface PaymentsPageData {
  summary: PaymentsSummaryStats
  recent: PaymentRow[]
  daily: PaymentsDailyPoint[]
  topRecipientsByAmount: PaymentCounterpartyRow[]
  topRecipientsByCount: PaymentCounterpartyRow[]
  topSenders: PaymentCounterpartyRow[]
}
```

### Task 1: Build Memo Parsing Primitives

**Files:**
- Create: `src/lib/payments.ts`
- Test: `__tests__/lib/payments.test.ts`

- [ ] **Step 1: Write the failing parsing tests**

```ts
jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({ getCached: jest.fn(), setCached: jest.fn() }))

import {
  classifyMemoFamily,
  decodeMemoHex,
  PAYMENT_METHODS,
} from '@/lib/payments'

test('exports the confirmed pathUSD payment rail', () => {
  expect(PAYMENT_METHODS).toContainEqual({
    token: '0x20c0000000000000000000000000000000000000',
    token_label: 'pathUSD',
    call_selector: '0x95777d59',
    event_selector: '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0',
    decimals: 6,
  })
})

test('decodes printable bytes32 memo values', () => {
  expect(decodeMemoHex('0x534f432d30307a66393162640000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
    memo_text: 'SOC-00zf91bd',
    memo_kind: 'readable',
  })
})

test('keeps non-printable memo values opaque', () => {
  expect(decodeMemoHex('0xff00aa0000000000000000000000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
    memo_text: null,
    memo_kind: 'opaque',
  })
})

test('treats zero bytes as an empty memo', () => {
  expect(decodeMemoHex('0x0000000000000000000000000000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0x0000000000000000000000000000000000000000000000000000000000000000',
    memo_text: null,
    memo_kind: 'empty',
  })
})

test('classifies readable memo families', () => {
  expect(classifyMemoFamily('SOC-00zf91bd')).toBe('SOC-*')
  expect(classifyMemoFamily('daily-2026-04-08')).toBe('daily-*')
  expect(classifyMemoFamily('FullSettlement')).toBe('Full*')
  expect(classifyMemoFamily('')).toBeNull()
  expect(classifyMemoFamily(null)).toBeNull()
})
```

- [ ] **Step 2: Run the parsing test file and verify it fails**

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts`

Expected: FAIL with `Cannot find module '@/lib/payments'` or missing export errors for `PAYMENT_METHODS`, `decodeMemoHex`, and `classifyMemoFamily`.

- [ ] **Step 3: Write the minimal memo parsing implementation**

```ts
import { getCached, setCached } from '@/lib/cache'
import { queryClickHouse } from '@/lib/clickhouse'

const CACHE_TTL_SECONDS = 900
const ZERO_MEMO = '0x' + '00'.repeat(32)

export const PAYMENT_METHODS = [
  {
    token: '0x20c0000000000000000000000000000000000000',
    token_label: 'pathUSD',
    call_selector: '0x95777d59',
    event_selector: '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0',
    decimals: 6,
  },
] satisfies SupportedPaymentMethod[]

function isPrintableAscii(value: Buffer) {
  return [...value].every(byte => byte === 0 || (byte >= 32 && byte <= 126))
}

export function decodeMemoHex(memoHex: string): {
  memo_hex: string
  memo_text: string | null
  memo_kind: MemoKind
} {
  const normalized = memoHex?.toLowerCase().startsWith('0x') ? memoHex.toLowerCase() : ZERO_MEMO
  if (normalized === ZERO_MEMO) {
    return { memo_hex: ZERO_MEMO, memo_text: null, memo_kind: 'empty' }
  }

  const bytes = Buffer.from(normalized.slice(2).padEnd(64, '0').slice(0, 64), 'hex')
  if (!isPrintableAscii(bytes)) {
    return { memo_hex: normalized, memo_text: null, memo_kind: 'opaque' }
  }

  const text = bytes.toString('utf8').replace(/\0+$/g, '').trim()
  if (!text) {
    return { memo_hex: normalized, memo_text: null, memo_kind: 'empty' }
  }

  return { memo_hex: normalized, memo_text: text, memo_kind: 'readable' }
}

export function classifyMemoFamily(memoText: string | null): string | null {
  if (!memoText) return null
  if (/^SOC-/i.test(memoText)) return 'SOC-*'
  if (/^daily-/i.test(memoText)) return 'daily-*'
  if (/^Full/i.test(memoText)) return 'Full*'
  if (/^LEGO/i.test(memoText)) return 'LEGO*'
  return null
}
```

- [ ] **Step 4: Run the parsing test file and verify it passes**

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts`

Expected: PASS for the five parsing tests.

- [ ] **Step 5: Commit the parsing primitives**

```bash
git add src/lib/payments.ts __tests__/lib/payments.test.ts
git commit -m "feat: add payments memo parsing primitives"
```

### Task 2: Add Raw Success/Failure Payment Queries

**Files:**
- Modify: `src/lib/payments.ts`
- Test: `__tests__/lib/payments.test.ts`

- [ ] **Step 1: Extend the lib test file with failing raw-query coverage**

```ts
import { queryClickHouse } from '@/lib/clickhouse'
import { getCached, setCached } from '@/lib/cache'
import { getRecentPayments } from '@/lib/payments'

const mockQuery = queryClickHouse as jest.Mock
const mockGetCached = getCached as jest.Mock
const mockSetCached = setCached as jest.Mock

beforeEach(() => {
  mockQuery.mockReset()
  mockGetCached.mockReset()
  mockSetCached.mockReset()
  mockGetCached.mockResolvedValue(null)
  mockSetCached.mockResolvedValue(undefined)
})

test('merges successful memo events and failed direct calls into one recent-payments list', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:00:00',
        tx_hash: '0xsuccess',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '1250000',
        memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:05:00',
        tx_hash: '0xfailed',
        sender: '0x3333333333333333333333333333333333333333',
        recipient: '0x4444444444444444444444444444444444444444',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '990000',
        memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
      },
    ])

  await expect(getRecentPayments(10)).resolves.toEqual([
    expect.objectContaining({
      tx_hash: '0xfailed',
      status: 'failed',
      amount: 0.99,
      memo_kind: 'opaque',
      memo_family: null,
    }),
    expect.objectContaining({
      tx_hash: '0xsuccess',
      status: 'success',
      amount: 1.25,
      memo_text: 'SOC-00zf91bd',
      memo_family: 'SOC-*',
    }),
  ])
})

test('reads recent payments from cache before querying clickhouse', async () => {
  mockGetCached.mockResolvedValueOnce([
    {
      timestamp: '2026-04-08 12:00:00',
      day: '2026-04-08',
      tx_hash: '0xcached',
      sender: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      token: '0x20c0000000000000000000000000000000000000',
      token_label: 'pathUSD',
      amount: 2.5,
      status: 'success',
      memo_hex: '0x534f432d63616368656400000000000000000000000000000000000000000000',
      memo_text: 'SOC-cached',
      memo_kind: 'readable',
      memo_family: 'SOC-*',
    },
  ])

  await expect(getRecentPayments(25)).resolves.toHaveLength(1)
  expect(mockQuery).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the raw-query coverage and verify it fails**

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts`

Expected: FAIL because `getRecentPayments` does not exist yet.

- [ ] **Step 3: Implement success/failure raw queries and normalization**

```ts
interface RawPaymentRow {
  block_timestamp: string
  tx_hash: string
  sender: string
  recipient: string
  token: string
  amount_raw: string
  memo_hex: string
}

function sliceDay(timestamp: string) {
  return String(timestamp).slice(0, 10)
}

function normalizeAmount(amountRaw: string, decimals: number) {
  return Number(amountRaw ?? 0) / 10 ** decimals
}

function buildSuccessfulPaymentsQuery(days: number) {
  return PAYMENT_METHODS.map(method => `
    SELECT
      block_timestamp,
      tx_hash,
      concat('0x', lower(hex(topic1))) AS sender,
      concat('0x', lower(hex(topic2))) AS recipient,
      '${method.token}' AS token,
      toString(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) AS amount_raw,
      lower(topic3) AS memo_hex
    FROM logs
    WHERE block_timestamp >= now() - INTERVAL ${days} DAY
      AND selector = '${method.event_selector}'
      AND lower(address) = '${method.token}'
  `).join('\nUNION ALL\n')
}

function buildFailedPaymentsQuery(days: number) {
  return PAYMENT_METHODS.map(method => `
    SELECT
      txs.block_timestamp,
      txs.hash AS tx_hash,
      lower(txs.from) AS sender,
      lower(concat('0x', substr(txs.input, 35, 40))) AS recipient,
      '${method.token}' AS token,
      toString(reinterpretAsUInt256(reverse(unhex(substr(txs.input, 75, 64))))) AS amount_raw,
      lower(concat('0x', substr(txs.input, 139, 64))) AS memo_hex
    FROM txs
    LEFT JOIN receipts ON receipts.tx_hash = txs.hash
    WHERE txs.block_timestamp >= now() - INTERVAL ${days} DAY
      AND txs.selector = '${method.call_selector}'
      AND lower(txs.to) = '${method.token}'
      AND (receipts.status = 0 OR receipts.status = '0')
  `).join('\nUNION ALL\n')
}

function normalizePaymentRow(
  row: RawPaymentRow,
  status: PaymentStatus,
): PaymentRow {
  const method = PAYMENT_METHODS.find(candidate => candidate.token === row.token.toLowerCase())
  if (!method) {
    throw new Error(`Unsupported payment token: ${row.token}`)
  }

  const memo = decodeMemoHex(row.memo_hex)
  return {
    timestamp: row.block_timestamp,
    day: sliceDay(row.block_timestamp),
    tx_hash: row.tx_hash.toLowerCase(),
    sender: row.sender.toLowerCase(),
    recipient: row.recipient.toLowerCase(),
    token: method.token,
    token_label: method.token_label,
    amount: normalizeAmount(row.amount_raw, method.decimals),
    status,
    memo_hex: memo.memo_hex,
    memo_text: memo.memo_text,
    memo_kind: memo.memo_kind,
    memo_family: classifyMemoFamily(memo.memo_text),
  }
}

async function fetchSuccessfulPaymentRows(days: number): Promise<RawPaymentRow[]> {
  return queryClickHouse<RawPaymentRow>(`
    ${buildSuccessfulPaymentsQuery(days)}
    ORDER BY block_timestamp DESC
  `)
}

async function fetchFailedPaymentRows(days: number): Promise<RawPaymentRow[]> {
  return queryClickHouse<RawPaymentRow>(`
    ${buildFailedPaymentsQuery(days)}
    ORDER BY block_timestamp DESC
  `)
}

export async function getRecentPayments(limit = 50, days = 30): Promise<PaymentRow[]> {
  const cacheKey = `payments:recent:${limit}:${days}`
  const cached = await getCached<PaymentRow[]>(cacheKey)
  if (cached !== null) return cached

  const [successfulRows, failedRows] = await Promise.all([
    fetchSuccessfulPaymentRows(days),
    fetchFailedPaymentRows(days),
  ])

  const rows = [
    ...successfulRows.map(row => normalizePaymentRow(row, 'success')),
    ...failedRows.map(row => normalizePaymentRow(row, 'failed')),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)

  await setCached(cacheKey, rows, CACHE_TTL_SECONDS)
  return rows
}
```

- [ ] **Step 4: Run the raw-query coverage and verify it passes**

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts`

Expected: PASS for the parsing tests and the two `getRecentPayments` tests.

- [ ] **Step 5: Commit the detail-query layer**

```bash
git add src/lib/payments.ts __tests__/lib/payments.test.ts
git commit -m "feat: add payments detail queries"
```

### Task 3: Add the Daily Rollup SQL and Dashboard Query Layer

**Files:**
- Create: `sql/clickhouse/views/payments/mv_memo_payments_daily.sql`
- Create: `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql`
- Modify: `src/lib/payments.ts`
- Test: `__tests__/lib/payments.test.ts`

- [ ] **Step 1: Add failing tests for summary, daily points, and concentration slices**

```ts
import {
  getPaymentsDaily,
  getPaymentsPageData,
  getPaymentsSummary,
} from '@/lib/payments'

test('maps mv_memo_payments_daily rows into daily points', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        day: '2026-04-08',
        successful_payments: '14',
        failed_attempts: '3',
        total_amount: '42.75',
        readable_memos: '5',
        opaque_memos: '9',
        empty_memos: '0',
      },
    ])
    .mockResolvedValueOnce([
      {
        day: '2026-04-08',
        unique_senders: '9',
        unique_recipients: '8',
      },
    ])

  await expect(getPaymentsDaily(30)).resolves.toEqual([
    {
      day: '2026-04-08',
      successful_payments: 14,
      failed_attempts: 3,
      total_amount: 42.75,
      unique_senders: 9,
      unique_recipients: 8,
      readable_memos: 5,
      opaque_memos: 9,
      empty_memos: 0,
    },
  ])
})

test('computes summary stats from daily points', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        day: '2026-04-07',
        successful_payments: '10',
        failed_attempts: '2',
        total_amount: '11.5',
        readable_memos: '4',
        opaque_memos: '6',
        empty_memos: '0',
      },
      {
        day: '2026-04-08',
        successful_payments: '5',
        failed_attempts: '3',
        total_amount: '8.5',
        readable_memos: '1',
        opaque_memos: '4',
        empty_memos: '0',
      },
    ])
    .mockResolvedValueOnce([
      { day: '2026-04-07', unique_senders: '3', unique_recipients: '4' },
      { day: '2026-04-08', unique_senders: '2', unique_recipients: '5' },
    ])
    .mockResolvedValueOnce([
      { unique_senders: '5', unique_recipients: '9' },
    ])

  await expect(getPaymentsSummary(30)).resolves.toEqual({
    successful_payments: 15,
    failed_attempts: 5,
    success_rate: 75,
    total_amount: 20,
    unique_senders: 5,
    unique_recipients: 9,
  })
})

test('assembles the page data contract', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        day: '2026-04-08',
        successful_payments: '4',
        failed_attempts: '1',
        total_amount: '8.25',
        readable_memos: '2',
        opaque_memos: '2',
        empty_memos: '0',
      },
    ])
    .mockResolvedValueOnce([
      { day: '2026-04-08', unique_senders: '2', unique_recipients: '3' },
    ])
    .mockResolvedValueOnce([
      { unique_senders: '2', unique_recipients: '3' },
    ])
    .mockResolvedValueOnce([
      {
        day: '2026-04-08',
        successful_payments: '4',
        failed_attempts: '1',
        total_amount: '8.25',
        readable_memos: '2',
        opaque_memos: '2',
        empty_memos: '0',
      },
    ])
    .mockResolvedValueOnce([
      { day: '2026-04-08', unique_senders: '2', unique_recipients: '3' },
    ])
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 11:00:00',
        tx_hash: '0xabc',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '500000',
        memo_hex: '0x534f432d61626300000000000000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { address: '0x9999999999999999999999999999999999999999', payment_count: '3', total_amount: '7.5' },
    ])
    .mockResolvedValueOnce([
      { address: '0x8888888888888888888888888888888888888888', payment_count: '2', total_amount: '7.5' },
    ])
    .mockResolvedValueOnce([
      { address: '0x7777777777777777777777777777777777777777', payment_count: '4', total_amount: '8.25' },
    ])

  await expect(getPaymentsPageData()).resolves.toMatchObject({
    summary: {
      successful_payments: 4,
      failed_attempts: 1,
      success_rate: 80,
      total_amount: 8.25,
    },
    recent: [expect.objectContaining({ tx_hash: '0xabc', status: 'success' })],
    topRecipientsByAmount: [expect.objectContaining({ address: '0x9999999999999999999999999999999999999999' })],
  })
})
```

- [ ] **Step 2: Run the dashboard-query coverage and verify it fails**

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts`

Expected: FAIL because `getPaymentsDaily`, `getPaymentsSummary`, and `getPaymentsPageData` are missing.

- [ ] **Step 3: Add the daily MV SQL and the dashboard query functions**

```sql
CREATE TABLE IF NOT EXISTS tidx_4217.mv_memo_payments_daily
(
  day                 Date,
  token               String,
  successful_payments UInt64,
  failed_attempts     UInt64,
  total_amount        Float64,
  readable_memos      UInt64,
  opaque_memos        UInt64,
  empty_memos         UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, token);

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_memo_payments_daily_success_view
TO tidx_4217.mv_memo_payments_daily
AS
SELECT
  toDate(block_timestamp) AS day,
  lower(address) AS token,
  count() AS successful_payments,
  0 AS failed_attempts,
  sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6) AS total_amount,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', '')) > 0
    AND match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS readable_memos,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', '')) > 0
    AND NOT match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS opaque_memos,
  countIf(length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', '')) = 0) AS empty_memos
FROM tidx_4217.logs
WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
  AND lower(address) = '0x20c0000000000000000000000000000000000000'
GROUP BY day, token;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_memo_payments_daily_failed_view
TO tidx_4217.mv_memo_payments_daily
AS
SELECT
  toDate(txs.block_timestamp) AS day,
  lower(txs.to) AS token,
  0 AS successful_payments,
  count() AS failed_attempts,
  0.0 AS total_amount,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', '')) > 0
    AND match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS readable_memos,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', '')) > 0
    AND NOT match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS opaque_memos,
  countIf(length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', '')) = 0) AS empty_memos
FROM tidx_4217.txs
LEFT JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
WHERE txs.selector = '0x95777d59'
  AND lower(txs.to) = '0x20c0000000000000000000000000000000000000'
  AND (receipts.status = 0 OR receipts.status = '0')
GROUP BY day, token;
```

Use one success-view branch and one failed-view branch per supported payment rail. The snippet above shows the confirmed pathUSD branch; when `PAYMENT_METHODS` grows, mirror the same pattern for each additional `event_selector` / `call_selector` pair in this SQL file and in the backfill file below.

```sql
INSERT INTO tidx_4217.mv_memo_payments_daily
SELECT
  toDate(block_timestamp) AS day,
  lower(address) AS token,
  count() AS successful_payments,
  0 AS failed_attempts,
  sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6) AS total_amount,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', '')) > 0
    AND match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS readable_memos,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', '')) > 0
    AND NOT match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS opaque_memos,
  countIf(length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(topic3), 3, 64))), '\\x00+$', '')) = 0) AS empty_memos
FROM tidx_4217.logs
WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
  AND lower(address) = '0x20c0000000000000000000000000000000000000'
GROUP BY day, token

UNION ALL

SELECT
  toDate(txs.block_timestamp) AS day,
  lower(txs.to) AS token,
  0 AS successful_payments,
  count() AS failed_attempts,
  0.0 AS total_amount,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', '')) > 0
    AND match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS readable_memos,
  countIf(
    length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', '')) > 0
    AND NOT match(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', ''), '^[ -~]+$')
  ) AS opaque_memos,
  countIf(length(replaceRegexpAll(reinterpretAsString(unhex(substr(lower(concat('0x', substr(txs.input, 139, 64))), 3, 64))), '\\x00+$', '')) = 0) AS empty_memos
FROM tidx_4217.txs
LEFT JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
WHERE txs.selector = '0x95777d59'
  AND lower(txs.to) = '0x20c0000000000000000000000000000000000000'
  AND (receipts.status = 0 OR receipts.status = '0')
GROUP BY day, token;
```

```ts
function toNumber(value: string | number | null | undefined) {
  return Number(value ?? 0)
}

function buildRawPaymentsSourceQuery(days: number) {
  const successful = PAYMENT_METHODS.map(method => `
    SELECT
      toDate(block_timestamp) AS day,
      '${method.token}' AS token,
      concat('0x', lower(hex(topic1))) AS sender,
      concat('0x', lower(hex(topic2))) AS recipient,
      toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / ${10 ** method.decimals} AS amount,
      'success' AS status
    FROM logs
    WHERE block_timestamp >= now() - INTERVAL ${days} DAY
      AND selector = '${method.event_selector}'
      AND lower(address) = '${method.token}'
  `).join('\nUNION ALL\n')

  const failed = PAYMENT_METHODS.map(method => `
    SELECT
      toDate(txs.block_timestamp) AS day,
      '${method.token}' AS token,
      lower(txs.from) AS sender,
      lower(concat('0x', substr(txs.input, 35, 40))) AS recipient,
      0.0 AS amount,
      'failed' AS status
    FROM txs
    LEFT JOIN receipts ON receipts.tx_hash = txs.hash
    WHERE txs.block_timestamp >= now() - INTERVAL ${days} DAY
      AND txs.selector = '${method.call_selector}'
      AND lower(txs.to) = '${method.token}'
      AND (receipts.status = 0 OR receipts.status = '0')
  `).join('\nUNION ALL\n')

  return `${successful}\nUNION ALL\n${failed}`
}

export async function getPaymentsDaily(days = 30): Promise<PaymentsDailyPoint[]> {
  const cacheKey = `payments:daily:${days}`
  const cached = await getCached<PaymentsDailyPoint[]>(cacheKey)
  if (cached !== null) return cached

  const metricRows = await queryClickHouse<Record<string, string>>(`
    SELECT
      day,
      sum(successful_payments) AS successful_payments,
      sum(failed_attempts) AS failed_attempts,
      round(sum(total_amount), 2) AS total_amount,
      sum(readable_memos) AS readable_memos,
      sum(opaque_memos) AS opaque_memos,
      sum(empty_memos) AS empty_memos
    FROM tidx_4217.mv_memo_payments_daily
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const actorRows = await queryClickHouse<Record<string, string>>(`
    SELECT
      day,
      uniqExact(sender) AS unique_senders,
      uniqExact(recipient) AS unique_recipients
    FROM (${buildRawPaymentsSourceQuery(days)})
    GROUP BY day
    ORDER BY day ASC
  `)

  const actorsByDay = new Map(actorRows.map(row => [
    String(row.day).slice(0, 10),
    {
      unique_senders: toNumber(row.unique_senders),
      unique_recipients: toNumber(row.unique_recipients),
    },
  ]))

  const mapped = metricRows.map(row => ({
    day: String(row.day).slice(0, 10),
    successful_payments: toNumber(row.successful_payments),
    failed_attempts: toNumber(row.failed_attempts),
    total_amount: toNumber(row.total_amount),
    unique_senders: actorsByDay.get(String(row.day).slice(0, 10))?.unique_senders ?? 0,
    unique_recipients: actorsByDay.get(String(row.day).slice(0, 10))?.unique_recipients ?? 0,
    readable_memos: toNumber(row.readable_memos),
    opaque_memos: toNumber(row.opaque_memos),
    empty_memos: toNumber(row.empty_memos),
  }))

  await setCached(cacheKey, mapped, CACHE_TTL_SECONDS)
  return mapped
}

async function getPaymentActorSummary(days = 30) {
  const cacheKey = `payments:actor-summary:${days}`
  const cached = await getCached<{ unique_senders: number; unique_recipients: number }>(cacheKey)
  if (cached !== null) return cached

  const rows = await queryClickHouse<Record<string, string>>(`
    SELECT
      uniqExact(sender) AS unique_senders,
      uniqExact(recipient) AS unique_recipients
    FROM (${buildRawPaymentsSourceQuery(days)})
  `)

  const summary = {
    unique_senders: toNumber(rows[0]?.unique_senders),
    unique_recipients: toNumber(rows[0]?.unique_recipients),
  }

  await setCached(cacheKey, summary, CACHE_TTL_SECONDS)
  return summary
}

async function getTopCounterparties(
  kind: 'recipient' | 'sender',
  orderBy: 'amount' | 'count',
  limit = 10,
  days = 30,
): Promise<PaymentCounterpartyRow[]> {
  const cacheKey = `payments:${kind}:${orderBy}:${limit}:${days}`
  const cached = await getCached<PaymentCounterpartyRow[]>(cacheKey)
  if (cached !== null) return cached

  const field = kind === 'recipient' ? 'recipient' : 'sender'
  const rows = await queryClickHouse<Record<string, string>>(`
    SELECT
      ${field} AS address,
      count() AS payment_count,
      round(sum(amount), 2) AS total_amount
    FROM (${buildRawPaymentsSourceQuery(days)})
    WHERE status = 'success'
    GROUP BY address
    ORDER BY ${orderBy === 'amount' ? 'total_amount' : 'payment_count'} DESC, address ASC
    LIMIT ${limit}
  `)

  const mapped = rows.map(row => ({
    address: String(row.address).toLowerCase(),
    payment_count: toNumber(row.payment_count),
    total_amount: toNumber(row.total_amount),
  }))

  await setCached(cacheKey, mapped, CACHE_TTL_SECONDS)
  return mapped
}

export async function getPaymentsSummary(days = 30): Promise<PaymentsSummaryStats> {
  const daily = await getPaymentsDaily(days)
  const actors = await getPaymentActorSummary(days)
  const successful_payments = daily.reduce((sum, row) => sum + row.successful_payments, 0)
  const failed_attempts = daily.reduce((sum, row) => sum + row.failed_attempts, 0)
  const total = successful_payments + failed_attempts
  return {
    successful_payments,
    failed_attempts,
    success_rate: total === 0 ? 0 : Number(((successful_payments * 100) / total).toFixed(2)),
    total_amount: Number(daily.reduce((sum, row) => sum + row.total_amount, 0).toFixed(2)),
    unique_senders: actors.unique_senders,
    unique_recipients: actors.unique_recipients,
  }
}

export async function getPaymentsPageData(): Promise<PaymentsPageData> {
  const summary = await getPaymentsSummary()
  const daily = await getPaymentsDaily()
  const recent = await getRecentPayments()
  const topRecipientsByAmount = await getTopCounterparties('recipient', 'amount')
  const topRecipientsByCount = await getTopCounterparties('recipient', 'count')
  const topSenders = await getTopCounterparties('sender', 'count')

  return {
    summary,
    daily,
    recent,
    topRecipientsByAmount,
    topRecipientsByCount,
    topSenders,
  }
}
```

- [ ] **Step 4: Run the dashboard-query coverage and verify it passes**

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts`

Expected: PASS for daily-point mapping, summary aggregation, and page-data composition tests.

Run: `curl -sS "${CLICKHOUSE_URL:-http://localhost:8123}/?database=${CLICKHOUSE_DB:-tidx_4217}" --data-binary @sql/clickhouse/views/payments/mv_memo_payments_daily.sql`

Expected: ClickHouse accepts the table + view DDL without syntax errors.

Run: `curl -sS "${CLICKHOUSE_URL:-http://localhost:8123}/?database=${CLICKHOUSE_DB:-tidx_4217}" --data-binary @sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql`

Expected: backfill finishes successfully and populates `tidx_4217.mv_memo_payments_daily`.

- [ ] **Step 5: Commit the rollup layer**

```bash
git add sql/clickhouse/views/payments/mv_memo_payments_daily.sql \
  sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql \
  src/lib/payments.ts \
  __tests__/lib/payments.test.ts
git commit -m "feat: add payments rollup queries"
```

### Task 4: Add Summary Cards and the Recent Payments Table

**Files:**
- Create: `src/components/payments/PaymentsSummary.tsx`
- Create: `src/components/payments/RecentPaymentsTable.tsx`
- Test: `__tests__/components/PaymentsSummary.test.tsx`
- Test: `__tests__/components/RecentPaymentsTable.test.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
import { render, screen } from '@testing-library/react'
import { PaymentsSummary } from '@/components/payments/PaymentsSummary'

test('renders the six top-level payments cards', () => {
  render(
    <PaymentsSummary
      summary={{
        successful_payments: 13115,
        failed_attempts: 1129,
        success_rate: 92.07,
        total_amount: 60881.61,
        unique_senders: 124,
        unique_recipients: 311,
      }}
    />,
  )

  expect(screen.getByText('Successful Payments')).toBeInTheDocument()
  expect(screen.getByText('13.1K')).toBeInTheDocument()
  expect(screen.getByText('Failed Attempts')).toBeInTheDocument()
  expect(screen.getByText('1.1K')).toBeInTheDocument()
  expect(screen.getByText('Success Rate')).toBeInTheDocument()
  expect(screen.getByText('92.07%')).toBeInTheDocument()
  expect(screen.getByText('Total Payment Amount')).toBeInTheDocument()
  expect(screen.getByText('$60.88K')).toBeInTheDocument()
})
```

```tsx
import { render, screen } from '@testing-library/react'
import { RecentPaymentsTable } from '@/components/payments/RecentPaymentsTable'

test('renders successful and failed rows in one table', () => {
  render(
    <RecentPaymentsTable
      rows={[
        {
          timestamp: '2026-04-08 12:00:00',
          day: '2026-04-08',
          tx_hash: '0xsuccess',
          sender: '0x1111111111111111111111111111111111111111',
          recipient: '0x2222222222222222222222222222222222222222',
          token: '0x20c0000000000000000000000000000000000000',
          token_label: 'pathUSD',
          amount: 1.25,
          status: 'success',
          memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
          memo_text: 'SOC-00zf91bd',
          memo_kind: 'readable',
          memo_family: 'SOC-*',
        },
        {
          timestamp: '2026-04-08 12:05:00',
          day: '2026-04-08',
          tx_hash: '0xfailed',
          sender: '0x3333333333333333333333333333333333333333',
          recipient: '0x4444444444444444444444444444444444444444',
          token: '0x20c0000000000000000000000000000000000000',
          token_label: 'pathUSD',
          amount: 0.99,
          status: 'failed',
          memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
          memo_text: null,
          memo_kind: 'opaque',
          memo_family: null,
        },
      ]}
    />,
  )

  expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
  expect(screen.getByText('success')).toBeInTheDocument()
  expect(screen.getByText('failed')).toBeInTheDocument()
  expect(screen.getByText('SOC-00zf91bd')).toBeInTheDocument()
  expect(screen.getByText('Opaque memo')).toBeInTheDocument()
})

test('renders the explicit empty state when no payment rows exist', () => {
  render(<RecentPaymentsTable rows={[]} />)
  expect(screen.getByText('No memo-bearing payments found for the selected period.')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the component tests and verify they fail**

Run: `npm test -- --runInBand __tests__/components/PaymentsSummary.test.tsx __tests__/components/RecentPaymentsTable.test.tsx`

Expected: FAIL because the payments components do not exist yet.

- [ ] **Step 3: Implement the summary cards and table**

```tsx
import { StatCard } from '@/components/StatCard'
import type { PaymentsSummaryStats } from '@/lib/payments'

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

export function PaymentsSummary({ summary }: { summary: PaymentsSummaryStats }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Successful Payments" value={countFormatter.format(summary.successful_payments)} />
      <StatCard label="Failed Attempts" value={countFormatter.format(summary.failed_attempts)} />
      <StatCard label="Success Rate" value={`${summary.success_rate}%`} />
      <StatCard label="Total Payment Amount" value={usdFormatter.format(summary.total_amount)} />
      <StatCard label="Unique Senders" value={countFormatter.format(summary.unique_senders)} />
      <StatCard label="Unique Recipients" value={countFormatter.format(summary.unique_recipients)} />
    </section>
  )
}
```

```tsx
import type { PaymentRow } from '@/lib/payments'

const amountFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function shortenAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function RecentPaymentsTable({ rows }: { rows: PaymentRow[] }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-tempo-border">
        <h2 className="text-lg font-medium text-white">Recent Payments</h2>
        <p className="text-xs text-tempo-muted mt-1">Successful and failed memo-bearing payments in one feed.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left px-6 py-3 text-tempo-muted font-normal">Timestamp</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Status</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Tx Hash</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Sender</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Recipient</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Token</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Amount</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Memo</th>
              <th className="text-left px-6 py-3 text-tempo-muted font-normal">Family</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.tx_hash} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                <td className="px-6 py-4 text-xs font-mono text-tempo-muted">{row.timestamp}</td>
                <td className="px-4 py-4">
                  <span className={row.status === 'success' ? 'text-emerald-400' : 'text-amber-300'}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-xs font-mono text-white">{shortenAddress(row.tx_hash)}</td>
                <td className="px-4 py-4 text-xs font-mono text-tempo-muted">{shortenAddress(row.sender)}</td>
                <td className="px-4 py-4 text-xs font-mono text-tempo-muted">{shortenAddress(row.recipient)}</td>
                <td className="px-4 py-4 text-white">{row.token_label}</td>
                <td className="px-4 py-4 text-right font-mono text-white">{amountFormatter.format(row.amount)}</td>
                <td className="px-4 py-4 text-white">{row.memo_text ?? (row.memo_kind === 'opaque' ? 'Opaque memo' : 'Empty memo')}</td>
                <td className="px-6 py-4 text-xs text-tempo-muted">{row.memo_family ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-sm text-tempo-muted">
                  No memo-bearing payments found for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run the component tests and verify they pass**

Run: `npm test -- --runInBand __tests__/components/PaymentsSummary.test.tsx __tests__/components/RecentPaymentsTable.test.tsx`

Expected: PASS for the new summary-card and table tests.

- [ ] **Step 5: Commit the top-of-page UI**

```bash
git add src/components/payments/PaymentsSummary.tsx \
  src/components/payments/RecentPaymentsTable.tsx \
  __tests__/components/PaymentsSummary.test.tsx \
  __tests__/components/RecentPaymentsTable.test.tsx
git commit -m "feat: add payments summary and table"
```

### Task 5: Add Charts and Narrative Sections

**Files:**
- Create: `src/components/charts/PaymentsCountChart.tsx`
- Create: `src/components/charts/PaymentsAmountChart.tsx`
- Create: `src/components/charts/PaymentsMemoPatternChart.tsx`
- Create: `src/components/payments/PaymentsNarrative.tsx`
- Test: `__tests__/components/PaymentsNarrative.test.tsx`

- [ ] **Step 1: Write the failing narrative test**

```tsx
import { render, screen } from '@testing-library/react'
import { PaymentsNarrative } from '@/components/payments/PaymentsNarrative'

test('renders the payments charts and concentration sections', () => {
  render(
    <PaymentsNarrative
      daily={[
        {
          day: '2026-04-08',
          successful_payments: 14,
          failed_attempts: 3,
          total_amount: 42.75,
          unique_senders: 9,
          unique_recipients: 8,
          readable_memos: 5,
          opaque_memos: 9,
          empty_memos: 0,
        },
      ]}
      topRecipientsByAmount={[
        { address: '0x03acdc3e7bb74f1c5d29b1118f920e1b5fc62fd7', payment_count: 11, total_amount: 43044.38 },
      ]}
      topRecipientsByCount={[
        { address: '0x2b38a4bb7ce552e82d5664224bacc1c3daf1ab7d', payment_count: 4132, total_amount: 3413 },
      ]}
      topSenders={[
        { address: '0x7254e7e9142dac7d5da2a9b3058aa63a0720fcc3', payment_count: 3353, total_amount: 12550 },
      ]}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Daily Payments Trend' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Daily Payment Amount' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Memo Pattern Mix' })).toBeInTheDocument()
  expect(screen.getByText('Top Recipients By Amount')).toBeInTheDocument()
  expect(screen.getByText('0x03acdc3e7bb74f1c5d29b1118f920e1b5fc62fd7')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the narrative test and verify it fails**

Run: `npm test -- --runInBand __tests__/components/PaymentsNarrative.test.tsx`

Expected: FAIL because `PaymentsNarrative` and the payments charts do not exist yet.

- [ ] **Step 3: Implement the chart components and narrative composition**

```tsx
'use client'

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

export function PaymentsCountChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area type="monotone" dataKey="successful_payments" name="Successful" stackId="1" stroke="#10B981" fill="#10B981" fillOpacity={0.4} />
        <Area type="monotone" dataKey="failed_attempts" name="Failed" stackId="1" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.35} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
```

```tsx
'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })

export function PaymentsAmountChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => usdFormatter.format(value)} width={72} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} formatter={(value: number) => [usdFormatter.format(value), 'Payment amount']} />
        <Line type="monotone" dataKey="total_amount" name="Amount moved" stroke="#38BDF8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

```tsx
'use client'

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

export function PaymentsMemoPatternChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area type="monotone" dataKey="readable_memos" name="Readable" stackId="1" stroke="#A855F7" fill="#A855F7" fillOpacity={0.35} />
        <Area type="monotone" dataKey="opaque_memos" name="Opaque" stackId="1" stroke="#6366F1" fill="#6366F1" fillOpacity={0.35} />
        <Area type="monotone" dataKey="empty_memos" name="Empty" stackId="1" stroke="#6B7280" fill="#6B7280" fillOpacity={0.3} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
```

```tsx
import type { ReactNode } from 'react'
import type { PaymentCounterpartyRow, PaymentsDailyPoint } from '@/lib/payments'
import { PaymentsAmountChart } from '@/components/charts/PaymentsAmountChart'
import { PaymentsCountChart } from '@/components/charts/PaymentsCountChart'
import { PaymentsMemoPatternChart } from '@/components/charts/PaymentsMemoPatternChart'

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      {children}
    </section>
  )
}

function CounterpartyList({ title, rows }: { title: string; rows: PaymentCounterpartyRow[] }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.address} className="flex items-center justify-between gap-4 text-sm">
            <span className="font-mono text-white">{row.address}</span>
            <span className="text-tempo-muted">{row.payment_count} payments · ${row.total_amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function PaymentsNarrative({
  daily,
  topRecipientsByAmount,
  topRecipientsByCount,
  topSenders,
}: {
  daily: PaymentsDailyPoint[]
  topRecipientsByAmount: PaymentCounterpartyRow[]
  topRecipientsByCount: PaymentCounterpartyRow[]
  topSenders: PaymentCounterpartyRow[]
}) {
  return (
    <div className="space-y-6">
      <ChartCard title="Daily Payments Trend">
        <PaymentsCountChart data={daily} />
      </ChartCard>

      <ChartCard title="Daily Payment Amount">
        <PaymentsAmountChart data={daily} />
      </ChartCard>

      <ChartCard title="Memo Pattern Mix">
        <PaymentsMemoPatternChart data={daily} />
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <CounterpartyList title="Top Recipients By Amount" rows={topRecipientsByAmount} />
        <CounterpartyList title="Top Recipients By Count" rows={topRecipientsByCount} />
        <CounterpartyList title="Top Senders" rows={topSenders} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the narrative test and verify it passes**

Run: `npm test -- --runInBand __tests__/components/PaymentsNarrative.test.tsx`

Expected: PASS for the payments narrative composition test.

- [ ] **Step 5: Commit the narrative layer**

```bash
git add src/components/charts/PaymentsCountChart.tsx \
  src/components/charts/PaymentsAmountChart.tsx \
  src/components/charts/PaymentsMemoPatternChart.tsx \
  src/components/payments/PaymentsNarrative.tsx \
  __tests__/components/PaymentsNarrative.test.tsx
git commit -m "feat: add payments charts and narrative"
```

### Task 6: Add the Payments Page, Loading State, and Nav Integration

**Files:**
- Create: `src/app/payments/page.tsx`
- Create: `src/app/payments/loading.tsx`
- Modify: `src/components/nav/PrimaryNav.tsx`
- Modify: `__tests__/components/PrimaryNav.test.tsx`
- Test: `__tests__/app/payments.page.test.tsx`

- [ ] **Step 1: Write the failing page and nav tests**

```tsx
jest.mock('@/lib/payments', () => ({
  getPaymentsPageData: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import PaymentsPage from '@/app/payments/page'
import { getPaymentsPageData } from '@/lib/payments'

const mockGetPaymentsPageData = getPaymentsPageData as jest.Mock

test('renders the payments page shell and major sections', async () => {
  mockGetPaymentsPageData.mockResolvedValue({
    summary: {
      successful_payments: 4,
      failed_attempts: 1,
      success_rate: 80,
      total_amount: 8.25,
      unique_senders: 2,
      unique_recipients: 3,
    },
    daily: [
      {
        day: '2026-04-08',
        successful_payments: 4,
        failed_attempts: 1,
        total_amount: 8.25,
        unique_senders: 2,
        unique_recipients: 3,
        readable_memos: 2,
        opaque_memos: 2,
        empty_memos: 0,
      },
    ],
    recent: [],
    topRecipientsByAmount: [],
    topRecipientsByCount: [],
    topSenders: [],
  })

  render(await PaymentsPage())

  expect(screen.getByRole('heading', { name: 'Payments' })).toBeInTheDocument()
  expect(screen.getByText('memo-bearing payment activity across Tempo')).toBeInTheDocument()
  expect(screen.getByText('Updates every 15 min · Mainnet data')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Recent Payments' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Daily Payments Trend' })).toBeInTheDocument()
})
```

```tsx
import { render, screen } from '@testing-library/react'
import { PrimaryNav } from '@/components/nav/PrimaryNav'

test('renders the payments tab in primary navigation', () => {
  render(<PrimaryNav />)
  expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/payments')
})
```

- [ ] **Step 2: Run the page/nav tests and verify they fail**

Run: `npm test -- --runInBand __tests__/app/payments.page.test.tsx __tests__/components/PrimaryNav.test.tsx`

Expected: FAIL because `/payments` page files and the nav link are missing.

- [ ] **Step 3: Implement the page, loading state, and nav update**

```tsx
import { PaymentsNarrative } from '@/components/payments/PaymentsNarrative'
import { PaymentsSummary } from '@/components/payments/PaymentsSummary'
import { RecentPaymentsTable } from '@/components/payments/RecentPaymentsTable'
import { getPaymentsPageData } from '@/lib/payments'

export const revalidate = 900

export default async function PaymentsPage() {
  const data = await getPaymentsPageData()

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">Payments</h1>
            <p className="max-w-3xl text-sm text-tempo-muted">
              memo-bearing payment activity across Tempo, including successful transfers and failed direct attempts
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-tempo-border bg-tempo-card px-3 py-1 text-xs text-tempo-muted">
            Updates every 15 min · Mainnet data
          </span>
        </div>
      </header>

      <PaymentsSummary summary={data.summary} />
      <RecentPaymentsTable rows={data.recent} />
      <PaymentsNarrative
        daily={data.daily}
        topRecipientsByAmount={data.topRecipientsByAmount}
        topRecipientsByCount={data.topRecipientsByCount}
        topSenders={data.topSenders}
      />
    </div>
  )
}
```

```tsx
function SkeletonCard() {
  return <div className="h-28 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
}

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="h-9 w-40 rounded bg-tempo-card animate-pulse" />
        <div className="h-4 w-96 max-w-full rounded bg-tempo-card animate-pulse" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)}
      </div>
      <div className="h-96 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
      <div className="grid gap-6">
        <div className="h-80 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
        <div className="h-80 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
        <div className="h-80 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
      </div>
    </div>
  )
}
```

```ts
const primaryTabs = [
  { href: '/analytics', label: 'Analytics' },
  { href: '/stablecoins', label: 'Stablecoins' },
  { href: '/dex', label: 'DEX' },
  { href: '/bridges', label: 'Bridges' },
  { href: '/payments', label: 'Payments' },
  { href: '/nfts', label: 'NFTs' },
]
```

- [ ] **Step 4: Run the page/nav tests, then run the full targeted verification**

Run: `npm test -- --runInBand __tests__/app/payments.page.test.tsx __tests__/components/PrimaryNav.test.tsx`

Expected: PASS for the new `/payments` page composition test and updated nav test.

Run: `npm test -- --runInBand __tests__/lib/payments.test.ts __tests__/components/PaymentsSummary.test.tsx __tests__/components/RecentPaymentsTable.test.tsx __tests__/components/PaymentsNarrative.test.tsx __tests__/app/payments.page.test.tsx __tests__/components/PrimaryNav.test.tsx`

Expected: PASS for all payments-focused tests.

Run: `npm run build`

Expected: `next build` exits `0`.

- [ ] **Step 5: Verify the local app surface and commit the page integration**

Run: `curl -s http://127.0.0.1:3000/payments | rg "Payments|Recent Payments|Daily Payments Trend"`

Expected: HTML includes the new page title and section headings.

Run: `curl -s http://127.0.0.1:3000/analytics | rg "Payments"`

Expected: nav markup includes the `Payments` link from the shared shell.

```bash
git add src/app/payments/page.tsx \
  src/app/payments/loading.tsx \
  src/components/nav/PrimaryNav.tsx \
  __tests__/components/PrimaryNav.test.tsx \
  __tests__/app/payments.page.test.tsx
git commit -m "feat: add payments analytics page"
```

## Self-Review

### Spec Coverage

- Top-level `Payments` nav and `/payments` route: Task 6.
- Split-view IA with cards, prominent table, and lower analytics sections: Tasks 4, 5, and 6.
- Hybrid data model with raw queries plus one lightweight daily rollup: Tasks 2 and 3.
- Shared success/failed recent table with memo decoding and memo-family handling: Tasks 1, 2, and 4.
- Trend charts, concentration, and memo-pattern sections: Task 5.
- Loading and validation requirements for the Cloudflare-served app: Task 6.

### Placeholder Scan

Checked for `TODO`, `TBD`, `implement later`, and similar filler. None are present.

### Type Consistency

- `PaymentRow`, `PaymentsSummaryStats`, `PaymentsDailyPoint`, `PaymentCounterpartyRow`, and `PaymentsPageData` are defined once in the shared data-shapes section and reused consistently across all tasks.
- `getRecentPayments`, `getPaymentsDaily`, `getPaymentsSummary`, and `getPaymentsPageData` are introduced before the tasks that depend on them.
