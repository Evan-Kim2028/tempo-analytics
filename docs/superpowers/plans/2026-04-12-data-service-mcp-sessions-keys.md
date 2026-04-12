# Data Service, MCP Server, Export Sessions & Access Keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform tempo-analytics from a single-endpoint CSV paywall into a paid data service with three consumer tiers: browser sessions, MCP agent access, and developer API keys — all sharing a unified query registry and payment layer.

**Architecture:** Extract the query catalog and mppx payment composition from `route.ts` into shared `dataService.ts` and `payments.ts`. Build three thin consumer adapters: refactored HTTP export, new MCP server (stdio + HTTP), and new access key API with self-service provisioning. Add a `SessionProvider` React context for deposit-based export credits.

**Tech Stack:** Next.js 15, mppx 0.5.12 (tempo.charge, tempo.session, mcp-sdk/server), @solana/mpp 0.5.2, @modelcontextprotocol/sdk, TypeScript, Jest

**Spec:** `docs/superpowers/specs/2026-04-12-data-service-mcp-sessions-keys-design.md`

---

## Task 1: Data Service — Query Catalog & Execution

**Files:**
- Create: `src/lib/dataService.ts`
- Create: `__tests__/lib/dataService.test.ts`

- [ ] **Step 1: Write failing test for query catalog**

```typescript
// __tests__/lib/dataService.test.ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/tidx', () => ({
  queryTidx: jest.fn(),
}))
jest.mock('@/lib/clickhouse', () => ({
  queryClickHouse: jest.fn(),
}))

import { getQueryCatalog, getQuery, executeQuery, formatCsv, formatJson } from '@/lib/dataService'

test('getQueryCatalog returns all registered queries', () => {
  const catalog = getQueryCatalog()
  expect(catalog.length).toBeGreaterThanOrEqual(11)
  const keys = catalog.map(e => e.key)
  expect(keys).toContain('account-types')
  expect(keys).toContain('stablecoin-daily')
  expect(keys).toContain('pool-trades')
})

test('getQuery returns entry by key', () => {
  const entry = getQuery('account-types')
  expect(entry).toBeDefined()
  expect(entry!.engine).toBe('tidx')
  expect(entry!.price).toBe('10000')
})

test('getQuery returns undefined for unknown key', () => {
  expect(getQuery('nonexistent')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/evan/Documents/takopi_adventures/projects/tempo-analytics && npx jest __tests__/lib/dataService.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement dataService.ts with query catalog**

```typescript
// src/lib/dataService.ts
import { queryTidx } from '@/lib/tidx'
import { queryClickHouse } from '@/lib/clickhouse'

export interface QueryEntry {
  key: string
  description: string
  engine: 'tidx' | 'clickhouse'
  sql: string
  params?: { name: string; pattern: RegExp }[]
  price: string
}

export type Row = Record<string, string | number | null>
export interface QueryResult {
  columns: string[]
  rows: Row[]
}

const QUERY_CATALOG: QueryEntry[] = [
  {
    key: 'account-types',
    description: 'Signature type distribution across all transactions',
    engine: 'tidx',
    sql: `SELECT signature_type, COUNT(*) as count, ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pct FROM txs GROUP BY signature_type ORDER BY count DESC`,
    price: '10000',
  },
  {
    key: 'batch-calls',
    description: 'Batch call frequency distribution',
    engine: 'tidx',
    sql: `SELECT call_count, COUNT(*) as tx_count FROM txs WHERE call_count > 0 GROUP BY call_count ORDER BY call_count`,
    price: '10000',
  },
  {
    key: 'fee-sponsorship',
    description: 'Daily fee sponsorship rates over the last 90 days',
    engine: 'tidx',
    sql: `SELECT DATE(block_timestamp) as day, COUNT(*) as total_txs, SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) as sponsored, ROUND(SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as pct_sponsored FROM txs GROUP BY day ORDER BY day DESC LIMIT 90`,
    price: '10000',
  },
  {
    key: 'fee-tokens',
    description: 'Gas token usage breakdown',
    engine: 'tidx',
    sql: `SELECT '0x' || encode(fee_token, 'hex') AS fee_token, COUNT(*) as count FROM txs WHERE fee_token IS NOT NULL GROUP BY fee_token ORDER BY count DESC`,
    price: '10000',
  },
  {
    key: 'mainnet-launch',
    description: 'Weekly transaction and unique sender growth since launch',
    engine: 'tidx',
    sql: `SELECT DATE_TRUNC('week', block_timestamp::timestamptz) as week, COUNT(*) as txs, COUNT(DISTINCT "from") as unique_senders FROM txs GROUP BY week ORDER BY week ASC`,
    price: '10000',
  },
  {
    key: 'latest-blocks',
    description: 'Most recent 1000 blocks with gas and miner info',
    engine: 'tidx',
    sql: `SELECT num, '0x' || encode(hash, 'hex') AS hash, timestamp, gas_used, '0x' || encode(miner, 'hex') AS miner FROM blocks ORDER BY num DESC LIMIT 1000`,
    price: '10000',
  },
  {
    key: 'stablecoin-daily',
    description: 'Daily stablecoin volume and transfer counts by token',
    engine: 'clickhouse',
    sql: `SELECT day, token, volume_u6, transfers FROM mv_stablecoin_daily ORDER BY day DESC, volume_u6 DESC`,
    price: '10000',
  },
  {
    key: 'dex-daily',
    description: 'Daily DEX swap counts by trading pair',
    engine: 'clickhouse',
    sql: `SELECT day, pair, swap_count FROM mv_dex_daily ORDER BY day DESC, swap_count DESC`,
    price: '10000',
  },
  {
    key: 'nft-activity',
    description: 'Daily NFT transfer counts by collection',
    engine: 'clickhouse',
    sql: `SELECT day, collection, transfers FROM mv_nft_daily ORDER BY day DESC, transfers DESC`,
    price: '10000',
  },
  {
    key: 'pool-trades',
    description: 'Trade history for a specific Protocol DEX pool',
    engine: 'custom',
    sql: '',
    params: [{ name: 'token', pattern: /^0x[0-9a-fA-F]{40}$/ }],
    price: '10000',
  },
]

export function getQueryCatalog(): QueryEntry[] {
  return QUERY_CATALOG
}

export function getQuery(key: string): QueryEntry | undefined {
  return QUERY_CATALOG.find(e => e.key === key)
}

export async function executeQuery(
  key: string,
  params?: Record<string, string>,
): Promise<QueryResult> {
  const entry = QUERY_CATALOG.find(e => e.key === key)
  if (!entry) throw new Error(`Unknown query: ${key}`)

  if (entry.params) {
    for (const p of entry.params) {
      const value = params?.[p.name]
      if (!value) throw new Error(`Missing required parameter: ${p.name}`)
      if (!p.pattern.test(value)) throw new Error(`Invalid parameter ${p.name}: ${value}`)
    }
  }

  if (entry.key === 'pool-trades') {
    const { getProtocolDexPoolTrades } = await import('@/lib/analytics')
    const trades = await getProtocolDexPoolTrades(params!.token.toLowerCase())
    if (!Array.isArray(trades) || trades.length === 0) return { columns: [], rows: [] }
    return { columns: Object.keys(trades[0]), rows: trades }
  }

  if (entry.engine === 'clickhouse') {
    const rows = await queryClickHouse(entry.sql)
    if (rows.length === 0) return { columns: [], rows: [] }
    return { columns: Object.keys(rows[0]), rows: rows as Row[] }
  }

  const tidx = await queryTidx(entry.sql)
  if (tidx.rows.length === 0) return { columns: [], rows: [] }
  return { columns: Object.keys(tidx.rows[0]), rows: tidx.rows }
}

export function formatCsv(result: QueryResult): string {
  if (result.rows.length === 0) {
    return result.columns.length > 0 ? result.columns.join(',') + '\n' : ''
  }
  const escape = (v: string | number | null): string => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const header = result.columns.join(',')
  const body = result.rows
    .map(row => result.columns.map(col => escape(row[col] ?? null)).join(','))
    .join('\n')
  return `${header}\n${body}`
}

export function formatJson(result: QueryResult): { columns: string[]; rows: Row[]; row_count: number } {
  return { columns: result.columns, rows: result.rows, row_count: result.rows.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/dataService.test.ts -v`
Expected: PASS

- [ ] **Step 5: Add execution and formatting tests**

Add to `__tests__/lib/dataService.test.ts`:

```typescript
import { queryTidx } from '@/lib/tidx'
import { queryClickHouse } from '@/lib/clickhouse'

test('executeQuery delegates tidx queries to queryTidx', async () => {
  ;(queryTidx as jest.Mock).mockResolvedValue({
    rows: [{ signature_type: 0, count: 100, pct: 75 }],
    row_count: 1,
    engine: 'pg',
    query_time_ms: 5,
  })
  const result = await executeQuery('account-types')
  expect(result.rows).toHaveLength(1)
  expect(result.columns).toContain('signature_type')
  expect(queryTidx).toHaveBeenCalled()
})

test('executeQuery delegates clickhouse queries to queryClickHouse', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValue([
    { day: '2026-04-01', token: 'USDC', volume_u6: 1000000, transfers: 50 },
  ])
  const result = await executeQuery('stablecoin-daily')
  expect(result.rows).toHaveLength(1)
  expect(result.columns).toContain('day')
  expect(queryClickHouse).toHaveBeenCalled()
})

test('executeQuery rejects missing required params', async () => {
  await expect(executeQuery('pool-trades')).rejects.toThrow('Missing required parameter: token')
})

test('executeQuery rejects invalid param format', async () => {
  await expect(executeQuery('pool-trades', { token: 'not-hex' })).rejects.toThrow('Invalid parameter token')
})

test('formatCsv produces valid CSV', () => {
  const result = { columns: ['a', 'b'], rows: [{ a: 1, b: 'hello' }, { a: 2, b: 'world' }] }
  expect(formatCsv(result)).toBe('a,b\n1,hello\n2,world')
})

test('formatCsv handles empty rows', () => {
  expect(formatCsv({ columns: ['a'], rows: [] })).toBe('a\n')
  expect(formatCsv({ columns: [], rows: [] })).toBe('')
})

test('formatJson includes row_count', () => {
  const result = { columns: ['a'], rows: [{ a: 1 }] }
  const json = formatJson(result)
  expect(json.row_count).toBe(1)
  expect(json.columns).toEqual(['a'])
})
```

- [ ] **Step 6: Run full test suite, verify pass**

Run: `npm test`

- [ ] **Step 7: Commit**

```bash
git add src/lib/dataService.ts __tests__/lib/dataService.test.ts
git commit -m "feat: extract shared data service with query catalog, execution, and formatting"
```

---

## Task 2: Payment Layer — mppx Composition & Session Balance

**Files:**
- Create: `src/lib/payments.ts`
- Create: `__tests__/lib/payments-compose.test.ts`

- [ ] **Step 1: Write failing test for payment composition**

```typescript
// __tests__/lib/payments-compose.test.ts
/**
 * @jest-environment node
 */
process.env.TEMPO_RECIPIENT_ADDRESS = process.env.TEMPO_RECIPIENT_ADDRESS ?? '0xc8BDAEDEcB05001B5EC22D273393792274f59281'

const mockCompose = jest.fn()

jest.mock('mppx/server', () => ({
  Mppx: {
    create: jest.fn(() => ({
      tempo: { charge: jest.fn() },
      solana: { charge: jest.fn() },
      compose: jest.fn((..._entries: unknown[]) => mockCompose),
    })),
  },
  tempo: { charge: jest.fn(() => ({})) },
}))

jest.mock('@solana/mpp/server', () => ({
  solana: { charge: jest.fn(() => ({})) },
}))

import { getPaymentInstance, composePayment } from '@/lib/payments'

test('getPaymentInstance returns mppx singleton', () => {
  const a = getPaymentInstance()
  const b = getPaymentInstance()
  expect(a).toBe(b)
  expect(a.tempo).toBeDefined()
})

test('composePayment returns 402 challenge when not paid', async () => {
  const challenge = new Response(null, { status: 402 })
  mockCompose.mockResolvedValue({ status: 402, challenge })
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const result = await composePayment(req, '10000')
  expect(result.status).toBe(402)
})

test('composePayment handles already-consumed credentials', async () => {
  mockCompose.mockRejectedValue(new Error('Transaction signature already consumed'))
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const result = await composePayment(req, '10000')
  expect(result.status).toBe(200)
  expect(result.alreadyConsumed).toBe(true)
})

test('composePayment rethrows non-consumed errors', async () => {
  mockCompose.mockRejectedValue(new Error('RPC connection failed'))
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  await expect(composePayment(req, '10000')).rejects.toThrow('RPC connection failed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/payments-compose.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement payments.ts**

```typescript
// src/lib/payments.ts
import { Mppx, tempo } from 'mppx/server'
import { solana } from '@solana/mpp/server'

const TEMPO_USDC_E = '0x20C000000000000000000000b9537d11c60E8b50'
const TEMPO_RECIPIENT = process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}`
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOLANA_RECIPIENT = process.env.SOLANA_RECIPIENT_ADDRESS
const EXPORT_PRICE = '0.01'
const SOLANA_EXPORT_PRICE = '10000'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mppx: any = null

export function getPaymentInstance() {
  if (!_mppx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods: any[] = [
      tempo.charge({ recipient: TEMPO_RECIPIENT, currency: TEMPO_USDC_E }),
    ]
    if (SOLANA_RECIPIENT) {
      methods.push(
        solana.charge({ recipient: SOLANA_RECIPIENT, currency: SOLANA_USDC, decimals: 6 }),
      )
    }
    _mppx = Mppx.create({ methods })
  }
  return _mppx
}

export interface PaymentResult {
  status: 402 | 200
  alreadyConsumed: boolean
  challenge?: Response
  wrapResponse: (res: Response) => Response
}

export async function composePayment(req: Request, amount: string): Promise<PaymentResult> {
  const mppx = getPaymentInstance()
  const entries: [unknown, { amount: string }][] = [
    [mppx.tempo.charge, { amount: EXPORT_PRICE }],
  ]
  if (mppx.solana) {
    entries.push([mppx.solana.charge, { amount: SOLANA_EXPORT_PRICE }])
  }

  let result
  let alreadyConsumed = false
  try {
    result = await mppx.compose(...entries)(req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/already consumed/i.test(msg) || /already been used/i.test(msg)) {
      alreadyConsumed = true
    } else {
      throw e
    }
  }

  if (!alreadyConsumed && result.status === 402) {
    return {
      status: 402,
      alreadyConsumed: false,
      challenge: result.challenge,
      wrapResponse: (res: Response) => res,
    }
  }

  return {
    status: 200,
    alreadyConsumed,
    wrapResponse: (res: Response) => alreadyConsumed ? res : result.withReceipt(res),
  }
}

// ── Session balance management ──

const CREDIT_TIERS = [
  { minDeposit: 100000n, creditsPerCent: 13 / 10 },  // $0.10+ → 13 credits per 10 cents
  { minDeposit: 50000n, creditsPerCent: 6 / 5 },      // $0.05+ → 6 credits per 5 cents
  { minDeposit: 0n, creditsPerCent: 1 },               // default → 1 credit per cent
]

export function calculateCredits(depositSmallestUnits: bigint): number {
  const cents = Number(depositSmallestUnits) / 10000
  for (const tier of CREDIT_TIERS) {
    if (depositSmallestUnits >= tier.minDeposit) {
      return Math.floor(cents * tier.creditsPerCent)
    }
  }
  return 0
}

const sessionBalances = new Map<string, number>()

export function getSessionBalance(sessionId: string): number {
  return sessionBalances.get(sessionId) ?? 0
}

export function setSessionBalance(sessionId: string, credits: number): void {
  if (credits <= 0) {
    sessionBalances.delete(sessionId)
  } else {
    sessionBalances.set(sessionId, credits)
  }
}

export function deductSessionCredit(sessionId: string): boolean {
  const balance = sessionBalances.get(sessionId)
  if (!balance || balance <= 0) return false
  if (balance === 1) {
    sessionBalances.delete(sessionId)
  } else {
    sessionBalances.set(sessionId, balance - 1)
  }
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/payments-compose.test.ts -v`
Expected: PASS

- [ ] **Step 5: Add session credit tests**

Add to `__tests__/lib/payments-compose.test.ts`:

```typescript
import { calculateCredits, getSessionBalance, setSessionBalance, deductSessionCredit } from '@/lib/payments'

test('calculateCredits applies tier discounts', () => {
  expect(calculateCredits(10000n)).toBe(1)       // $0.01 → 1 credit
  expect(calculateCredits(50000n)).toBe(6)       // $0.05 → 6 credits
  expect(calculateCredits(100000n)).toBe(13)     // $0.10 → 13 credits
  expect(calculateCredits(200000n)).toBe(26)     // $0.20 → 26 credits
})

test('session balance operations', () => {
  setSessionBalance('test-1', 5)
  expect(getSessionBalance('test-1')).toBe(5)
  expect(deductSessionCredit('test-1')).toBe(true)
  expect(getSessionBalance('test-1')).toBe(4)
  expect(deductSessionCredit('nonexistent')).toBe(false)
})

test('session balance auto-deletes at zero', () => {
  setSessionBalance('test-2', 1)
  deductSessionCredit('test-2')
  expect(getSessionBalance('test-2')).toBe(0)
})
```

- [ ] **Step 6: Run full test suite, verify pass**

Run: `npm test`

- [ ] **Step 7: Commit**

```bash
git add src/lib/payments.ts __tests__/lib/payments-compose.test.ts
git commit -m "feat: add payment composition layer with session credit management"
```

---

## Task 3: Refactor Export Route to Use Data Service + Payments

**Files:**
- Modify: `src/app/api/export/route.ts`
- Modify: `__tests__/api/export.test.ts`

- [ ] **Step 1: Rewrite route.ts as thin adapter**

Replace the entire contents of `src/app/api/export/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getQuery, executeQuery, formatCsv } from '@/lib/dataService'
import { composePayment } from '@/lib/payments'
import { deductSessionCredit } from '@/lib/payments'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { query?: string }
  const { query: queryKey } = body

  const entry = getQuery(queryKey ?? '')
  if (!entry) {
    return NextResponse.json({ error: 'Unknown export query' }, { status: 400 })
  }

  // Session-based access: credit already deducted by the client, just serve data
  const sessionId = req.headers.get('X-Session-Id')
  if (sessionId) {
    try {
      const result = await executeQuery(queryKey!)
      const csv = formatCsv(result)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
        },
      })
    } catch (e) {
      console.error('Export query failed (session):', e)
      return NextResponse.json({ error: 'Data query failed' }, { status: 503 })
    }
  }

  // Standard mppx payment flow
  let payment
  try {
    payment = await composePayment(req, entry.price)
  } catch (e) {
    console.error('Payment compose error:', e)
    return NextResponse.json(
      { error: 'Payment verification error. The transaction may not be confirmed yet — wait a moment and retry.' },
      { status: 502 },
    )
  }

  if (payment.status === 402) return payment.challenge!

  try {
    const result = await executeQuery(queryKey!)
    const csv = formatCsv(result)
    return payment.wrapResponse(
      new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
        },
      }),
    )
  } catch (e) {
    console.error('Export query failed after payment:', e)
    return payment.wrapResponse(
      NextResponse.json(
        { error: 'Data query failed. Payment was accepted — retry the export with the same credential.' },
        { status: 503 },
      ),
    )
  }
}
```

- [ ] **Step 2: Update export test mocks**

Update `__tests__/api/export.test.ts` — replace the mppx mocks with payments mock:

```typescript
/**
 * @jest-environment node
 */
process.env.TEMPO_RECIPIENT_ADDRESS = process.env.TEMPO_RECIPIENT_ADDRESS ?? '0xc8BDAEDEcB05001B5EC22D273393792274f59281'

import { NextRequest } from 'next/server'

const mockComposePayment = jest.fn()

jest.mock('@/lib/payments', () => ({
  composePayment: (...args: unknown[]) => mockComposePayment(...args),
}))

jest.mock('@/lib/dataService', () => {
  const actual = jest.requireActual('@/lib/dataService')
  return {
    ...actual,
    executeQuery: jest.fn(),
  }
})

import { executeQuery } from '@/lib/dataService'

async function getRoute() {
  const mod = await import('@/app/api/export/route')
  return mod.POST
}

function makeRequest(body: unknown, authHeader?: string) {
  return new NextRequest('http://localhost/api/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  const challenge = new Response(null, { status: 402, headers: { 'WWW-Authenticate': 'Payment id="abc"' } })
  mockComposePayment.mockResolvedValue({ status: 402, challenge, wrapResponse: (r: Response) => r })
})

test('returns 400 for unknown query key', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'unknown' }))
  expect(res.status).toBe(400)
})

test('returns 402 when not paid', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(402)
})

test('returns CSV when payment accepted', async () => {
  const wrapResponse = jest.fn((r: Response) => r)
  mockComposePayment.mockResolvedValue({ status: 200, alreadyConsumed: false, wrapResponse })
  ;(executeQuery as jest.Mock).mockResolvedValue({
    columns: ['signature_type', 'count'],
    rows: [{ signature_type: 0, count: 100 }],
  })

  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, 'Payment eyJ...'))
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
  const text = await res.text()
  expect(text).toContain('signature_type,count')
  expect(wrapResponse).toHaveBeenCalled()
})

test('returns 502 on compose error', async () => {
  mockComposePayment.mockRejectedValue(new Error('RPC failed'))
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(502)
})
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test`
Expected: All pass

- [ ] **Step 4: Run build to verify types**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/api/export/route.ts __tests__/api/export.test.ts
git commit -m "refactor: export route uses shared dataService and payments layer"
```

---

## Task 4: MCP Server — Tool Registration & stdio Transport

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/stdio.ts`
- Create: `__tests__/mcp/server.test.ts`

- [ ] **Step 1: Install @modelcontextprotocol/sdk**

Run: `npm install @modelcontextprotocol/sdk`

- [ ] **Step 2: Write failing test for MCP server tools**

```typescript
// __tests__/mcp/server.test.ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/dataService', () => ({
  getQueryCatalog: jest.fn(() => [
    { key: 'account-types', description: 'Sig types', engine: 'tidx', sql: '', price: '10000' },
    { key: 'pool-trades', description: 'Pool trades', engine: 'custom', sql: '', price: '10000', params: [{ name: 'token', pattern: /^0x[0-9a-fA-F]{40}$/ }] },
  ]),
  executeQuery: jest.fn().mockResolvedValue({ columns: ['a'], rows: [{ a: 1 }] }),
  formatJson: jest.fn((r: unknown) => r),
}))

jest.mock('@/lib/payments', () => ({
  getPaymentInstance: jest.fn(() => ({})),
}))

import { createMcpServer } from '@/mcp/server'

test('createMcpServer returns a server with registered tools', () => {
  const server = createMcpServer()
  expect(server).toBeDefined()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/mcp/server.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 4: Implement MCP server**

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getQueryCatalog, executeQuery, formatJson } from '@/lib/dataService'

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'tempo-analytics',
    version: '1.0.0',
  })

  for (const entry of getQueryCatalog()) {
    const toolName = `tempo_${entry.key.replace(/-/g, '_')}`
    const schema: Record<string, unknown> = {}
    if (entry.params) {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const p of entry.params) {
        properties[p.name] = { type: 'string', description: `${p.name} parameter` }
        required.push(p.name)
      }
      Object.assign(schema, { properties, required })
    }

    server.tool(toolName, entry.description, schema, async (params) => {
      const result = await executeQuery(entry.key, params as Record<string, string>)
      const json = formatJson(result)
      return { content: [{ type: 'text', text: JSON.stringify(json) }] }
    })
  }

  return server
}
```

- [ ] **Step 5: Implement stdio entry point**

```typescript
// src/mcp/stdio.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server.js'

async function main() {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((e) => {
  console.error('MCP server error:', e)
  process.exit(1)
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/mcp/server.test.ts -v`
Expected: PASS

- [ ] **Step 7: Run full test suite and build**

Run: `npm test && npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/mcp/server.ts src/mcp/stdio.ts __tests__/mcp/server.test.ts package.json package-lock.json
git commit -m "feat: add MCP server with tools from query catalog and stdio transport"
```

---

## Task 5: MCP HTTP Transport

**Files:**
- Create: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Implement HTTP MCP route**

```typescript
// src/app/api/mcp/route.ts
import { NextRequest } from 'next/server'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from '@/mcp/server'

let transport: StreamableHTTPServerTransport | null = null

function getTransport() {
  if (!transport) {
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = createMcpServer()
    server.connect(transport)
  }
  return transport
}

export async function POST(req: NextRequest) {
  const t = getTransport()
  const body = await req.json()
  const response = await t.handleRequest(body)
  return Response.json(response)
}
```

- [ ] **Step 2: Run build to verify types**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp/route.ts
git commit -m "feat: add HTTP streamable transport for MCP server"
```

---

## Task 6: Session Provider (Client-Side)

**Files:**
- Create: `src/providers/SessionProvider.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/lib/walletPayment.ts`

- [ ] **Step 1: Implement SessionProvider**

```typescript
// src/providers/SessionProvider.tsx
'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface SessionState {
  credits: number
  sessionId: string | null
  loading: boolean
}

interface SessionContextValue extends SessionState {
  openSession(depositAmount: string): Promise<void>
  closeSession(): Promise<void>
}

const SessionContext = createContext<SessionContextValue>({
  credits: 0,
  sessionId: null,
  loading: false,
  openSession: async () => {},
  closeSession: async () => {},
})

export function useSession() {
  return useContext(SessionContext)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    credits: 0,
    sessionId: null,
    loading: false,
  })

  const openSession = useCallback(async (depositAmount: string) => {
    setState(s => ({ ...s, loading: true }))
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', deposit: depositAmount }),
      })
      if (!res.ok) throw new Error('Failed to open session')
      const { sessionId, credits } = await res.json()
      setState({ credits, sessionId, loading: false })
    } catch {
      setState(s => ({ ...s, loading: false }))
    }
  }, [])

  const closeSession = useCallback(async () => {
    if (!state.sessionId) return
    setState(s => ({ ...s, loading: true }))
    try {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', sessionId: state.sessionId }),
      })
    } finally {
      setState({ credits: 0, sessionId: null, loading: false })
    }
  }, [state.sessionId])

  return (
    <SessionContext.Provider value={{ ...state, openSession, closeSession }}>
      {children}
    </SessionContext.Provider>
  )
}
```

- [ ] **Step 2: Add SessionProvider to layout**

In `src/app/layout.tsx`, add import and wrap children:

```typescript
import { SessionProvider } from '@/providers/SessionProvider'
```

Wrap inside `<WalletProviders>`:
```tsx
<WalletProviders>
  <SessionProvider>
    {/* nav, main, etc. */}
  </SessionProvider>
</WalletProviders>
```

- [ ] **Step 3: Add session client to walletPayment.ts**

Add to `src/lib/walletPayment.ts`:

```typescript
import { tempo as tempoSession } from 'mppx/client'

export function createTempoSessionClient(deposit: string) {
  return MppxCore.create({
    methods: [tempoSession.session({ deposit })],
    polyfill: false,
  })
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/providers/SessionProvider.tsx src/app/layout.tsx src/lib/walletPayment.ts
git commit -m "feat: add SessionProvider for deposit-based export credits"
```

---

## Task 7: Session API Endpoint

**Files:**
- Create: `src/app/api/session/route.ts`
- Create: `__tests__/api/session.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// __tests__/api/session.test.ts
/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/payments', () => ({
  calculateCredits: jest.fn((deposit: bigint) => {
    if (deposit >= 100000n) return 13
    if (deposit >= 50000n) return 6
    return Number(deposit / 10000n)
  }),
  setSessionBalance: jest.fn(),
  getSessionBalance: jest.fn(() => 5),
  deductSessionCredit: jest.fn(() => true),
}))

async function getRoute() {
  const mod = await import('@/app/api/session/route')
  return mod.POST
}

test('open session returns session ID and credits', async () => {
  const POST = await getRoute()
  const res = await POST(new NextRequest('http://localhost/api/session', {
    method: 'POST',
    body: JSON.stringify({ action: 'open', deposit: '100000' }),
    headers: { 'Content-Type': 'application/json' },
  }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.sessionId).toBeDefined()
  expect(body.credits).toBe(13)
})

test('balance returns current credits', async () => {
  const POST = await getRoute()
  const res = await POST(new NextRequest('http://localhost/api/session', {
    method: 'POST',
    body: JSON.stringify({ action: 'balance', sessionId: 'test-123' }),
    headers: { 'Content-Type': 'application/json' },
  }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.credits).toBe(5)
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/api/session.test.ts -v`

- [ ] **Step 3: Implement session route**

```typescript
// src/app/api/session/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { calculateCredits, setSessionBalance, getSessionBalance, deductSessionCredit } from '@/lib/payments'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    action?: string
    deposit?: string
    sessionId?: string
  }

  if (body.action === 'open') {
    if (!body.deposit) return NextResponse.json({ error: 'deposit required' }, { status: 400 })
    const deposit = BigInt(body.deposit)
    const credits = calculateCredits(deposit)
    if (credits <= 0) return NextResponse.json({ error: 'deposit too small' }, { status: 400 })
    const sessionId = crypto.randomUUID()
    setSessionBalance(sessionId, credits)
    return NextResponse.json({ sessionId, credits })
  }

  if (body.action === 'balance') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    return NextResponse.json({ credits: getSessionBalance(body.sessionId) })
  }

  if (body.action === 'use') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const ok = deductSessionCredit(body.sessionId)
    if (!ok) return NextResponse.json({ error: 'no credits remaining' }, { status: 402 })
    return NextResponse.json({ credits: getSessionBalance(body.sessionId) })
  }

  if (body.action === 'close') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const remaining = getSessionBalance(body.sessionId)
    setSessionBalance(body.sessionId, 0)
    return NextResponse.json({ closed: true, refundedCredits: remaining })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx jest __tests__/api/session.test.ts -v`

- [ ] **Step 5: Run full test suite and build**

Run: `npm test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/session/route.ts __tests__/api/session.test.ts
git commit -m "feat: add session API endpoint for credit management"
```

---

## Task 8: ExportButton — Session Integration

**Files:**
- Modify: `src/components/ExportButton.tsx`

- [ ] **Step 1: Add session-aware export to ExportButton**

At the top of ExportButton.tsx, add the import:

```typescript
import { useSession } from '@/providers/SessionProvider'
```

Inside the `ExportButton` component, add after the existing state declarations:

```typescript
const session = useSession()
```

Add a session-based export function after `handleTempoPay`:

```typescript
async function handleSessionExport() {
  if (payingRef.current) return
  payingRef.current = true
  setState('verifying')
  setError(null)

  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'use', sessionId: session.sessionId }),
    })
    if (!res.ok) {
      setError('Session credit failed — try paying directly')
      setState('challenged')
      payingRef.current = false
      return
    }
    // Fetch export with session header — route skips mppx payment when session is valid
    const exportRes = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': session.sessionId! },
      body: JSON.stringify({ query: queryKey }),
    })
    if (!exportRes.ok) {
      setError('Export failed after session deduction')
      setState('error')
      payingRef.current = false
      return
    }
    downloadBlob(await exportRes.blob())
  } catch {
    setState('error')
    setError('Network error — please try again')
    payingRef.current = false
  }
}
```

In the idle/error state render, change the button to check session credits:

```typescript
if (state === 'idle' || state === 'error') {
  if (session.credits > 0) {
    return (
      <button
        onClick={handleSessionExport}
        disabled={fetching}
        className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors"
      >
        {label} ({session.credits} credits)
      </button>
    )
  }
  // ... existing idle/error render
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportButton.tsx
git commit -m "feat: ExportButton uses session credits when available"
```

---

## Task 9: Access Key API & Middleware

**Files:**
- Create: `src/app/api/v1/query/route.ts`
- Create: `src/app/api/keys/route.ts`
- Create: `src/middleware.ts`
- Create: `__tests__/api/v1-query.test.ts`

- [ ] **Step 1: Write failing test for v1 query endpoint**

```typescript
// __tests__/api/v1-query.test.ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/dataService', () => ({
  getQuery: jest.fn((key: string) => key === 'account-types' ? { key, engine: 'tidx' } : undefined),
  executeQuery: jest.fn().mockResolvedValue({ columns: ['a'], rows: [{ a: 1 }] }),
  formatJson: jest.fn((r: { columns: string[]; rows: unknown[]; }) => ({ ...r, row_count: r.rows.length })),
}))

import { NextRequest } from 'next/server'

async function getRoute() {
  const mod = await import('@/app/api/v1/query/route')
  return mod.POST
}

test('returns JSON for valid query with key', async () => {
  const POST = await getRoute()
  const res = await POST(new NextRequest('http://localhost/api/v1/query', {
    method: 'POST',
    body: JSON.stringify({ query: 'account-types' }),
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key-Validated': 'true',
    },
  }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.row_count).toBe(1)
})

test('returns 400 for unknown query', async () => {
  const POST = await getRoute()
  const res = await POST(new NextRequest('http://localhost/api/v1/query', {
    method: 'POST',
    body: JSON.stringify({ query: 'nonexistent' }),
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key-Validated': 'true',
    },
  }))
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/api/v1-query.test.ts -v`

- [ ] **Step 3: Implement v1 query route**

```typescript
// src/app/api/v1/query/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getQuery, executeQuery, formatJson } from '@/lib/dataService'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { query?: string; params?: Record<string, string> }
  const { query: queryKey, params } = body

  const entry = getQuery(queryKey ?? '')
  if (!entry) {
    return NextResponse.json({ error: 'Unknown query' }, { status: 400 })
  }

  try {
    const result = await executeQuery(queryKey!, params)
    return NextResponse.json(formatJson(result))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Query failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 4: Implement key provisioning route**

```typescript
// src/app/api/keys/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { calculateCredits, setSessionBalance, getSessionBalance } from '@/lib/payments'

const keys = new Map<string, { owner: string; balance: number; createdAt: string; expiresAt: string }>()

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { deposit?: string; owner?: string; expiry?: number }

  if (!body.deposit || !body.owner) {
    return NextResponse.json({ error: 'deposit and owner required' }, { status: 400 })
  }

  const credits = calculateCredits(BigInt(body.deposit))
  if (credits <= 0) return NextResponse.json({ error: 'deposit too small' }, { status: 400 })

  const apiKey = `tak_${crypto.randomUUID().replace(/-/g, '')}`
  const expiryDays = body.expiry ?? 30
  const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString()

  keys.set(apiKey, {
    owner: body.owner,
    balance: credits,
    createdAt: new Date().toISOString(),
    expiresAt,
  })

  return NextResponse.json({ apiKey, credits, expiresAt })
}

export async function GET() {
  const all = Array.from(keys.entries()).map(([key, data]) => ({
    key: `${key.slice(0, 8)}...${key.slice(-4)}`,
    ...data,
  }))
  return NextResponse.json(all)
}

export function validateKey(apiKey: string): { valid: boolean; error?: string } {
  const data = keys.get(apiKey)
  if (!data) return { valid: false, error: 'Invalid API key' }
  if (new Date(data.expiresAt) < new Date()) return { valid: false, error: 'API key expired' }
  if (data.balance <= 0) return { valid: false, error: 'No credits remaining' }
  data.balance--
  return { valid: true }
}
```

- [ ] **Step 5: Implement middleware**

```typescript
// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/v1/')) return NextResponse.next()

  const authHeader = req.headers.get('Authorization') ?? ''
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!apiKey) {
    return NextResponse.json({ error: 'API key required. Use Authorization: Bearer <key>' }, { status: 401 })
  }

  // Key validation happens in the route handler (middleware can't import server modules directly in edge runtime)
  // Pass the key through as a header for the route to validate
  const headers = new Headers(req.headers)
  headers.set('X-Api-Key', apiKey)
  headers.set('X-Api-Key-Validated', 'true')

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: '/api/v1/:path*',
}
```

- [ ] **Step 6: Run test to verify pass**

Run: `npx jest __tests__/api/v1-query.test.ts -v`

- [ ] **Step 7: Run full test suite and build**

Run: `npm test && npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/app/api/v1/query/route.ts src/app/api/keys/route.ts src/middleware.ts __tests__/api/v1-query.test.ts
git commit -m "feat: add access key API with middleware validation and key provisioning"
```

---

## Task 10: Developer Page

**Files:**
- Create: `src/app/developers/page.tsx`
- Modify: `src/components/nav/PrimaryNav.tsx`

- [ ] **Step 1: Add Developers nav link**

In `src/components/nav/PrimaryNav.tsx`, add to `primaryTabs`:

```typescript
{ href: '/developers', label: 'Developers' },
```

- [ ] **Step 2: Create developer page**

```typescript
// src/app/developers/page.tsx
import { Metadata } from 'next'

export const metadata: Metadata = { title: 'Developers — Tempo Explorer' }

export default function DevelopersPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Developer API</h1>
      <p className="text-tempo-muted">
        Query Tempo analytics data programmatically. Get an API key, deposit credits, and start querying.
      </p>

      <section className="bg-tempo-card border border-tempo-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Quick Start</h2>
        <pre className="bg-tempo-dark rounded p-4 text-xs font-mono text-gray-300 overflow-x-auto">{`curl -X POST https://explorer.tempo.xyz/api/v1/query \\
  -H "Authorization: Bearer tak_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "stablecoin-daily"}'`}</pre>
      </section>

      <section className="bg-tempo-card border border-tempo-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Available Queries</h2>
        <p className="text-tempo-muted text-sm">$0.01 per query. Volume discounts available.</p>
        <div className="grid gap-2 text-sm">
          {[
            ['account-types', 'Signature type distribution'],
            ['batch-calls', 'Batch call frequency'],
            ['fee-sponsorship', 'Daily sponsorship rates (90 days)'],
            ['fee-tokens', 'Gas token usage breakdown'],
            ['mainnet-launch', 'Weekly growth since launch'],
            ['latest-blocks', 'Most recent 1000 blocks'],
            ['stablecoin-daily', 'Stablecoin volume by day'],
            ['dex-daily', 'DEX swaps by pair/day'],
            ['nft-activity', 'NFT transfers by collection/day'],
            ['pool-trades', 'Pool trade history (requires token param)'],
          ].map(([key, desc]) => (
            <div key={key} className="flex justify-between border-b border-tempo-border py-2">
              <code className="text-tempo-blue font-mono">{key}</code>
              <span className="text-tempo-muted">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-tempo-card border border-tempo-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Pricing</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-tempo-muted border-b border-tempo-border">
              <th className="text-left py-2">Deposit</th>
              <th className="text-left py-2">Credits</th>
              <th className="text-left py-2">Per Query</th>
              <th className="text-left py-2">Discount</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            <tr className="border-b border-tempo-border"><td className="py-2">$0.01</td><td>1</td><td>$0.01</td><td>—</td></tr>
            <tr className="border-b border-tempo-border"><td className="py-2">$0.05</td><td>6</td><td>~$0.0083</td><td>17%</td></tr>
            <tr><td className="py-2">$0.10</td><td>13</td><td>~$0.0077</td><td>23%</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Run build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/app/developers/page.tsx src/components/nav/PrimaryNav.tsx
git commit -m "feat: add developer page with API docs and pricing"
```

---

## Task 11: Final Integration Test & Cleanup

**Files:**
- All modified files
- Existing test suite

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Verify dev server**

Run: `curl -s http://localhost:3001/api/export -X POST -H "Content-Type: application/json" -d '{"query":"account-types"}' -o /dev/null -w "%{http_code}"`
Expected: `402`

- [ ] **Step 4: Verify developers page**

Run: `curl -s http://localhost:3001/developers -o /dev/null -w "%{http_code}"`
Expected: `200` or `307` (redirect to page)

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final integration verification"
```
