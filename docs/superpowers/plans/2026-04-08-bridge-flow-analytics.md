# Bridge Flow Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a verified-provider bridge analytics surface for Tempo that reports daily inflow and outflow by provider, with asset rollups and a validation layer.

**Architecture:** A curated bridge registry defines verified Stargate, USDT0, and Frax Tempo contracts plus their roles. A bridge analytics library queries ClickHouse logs and ERC-20 transfers, classifies strict user flows versus diagnostic rows, and exposes daily provider and provider-asset rollups. A thin verification layer audits sampled classified transactions against RPC receipts, and a new `/bridges` page renders the daily aggregates.

**Tech Stack:** Next.js 15 App Router, TypeScript, ClickHouse HTTP API, Tempo RPC via viem, Jest (jsdom), Tailwind CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/bridge-registry.ts` | Create | Verified provider and contract registry for Stargate, USDT0, and Frax |
| `src/lib/bridges.ts` | Create | Flow classification, daily rollups, and provider/asset aggregation |
| `src/lib/bridge-verification.ts` | Create | RPC-backed audit helpers for sampled classified rows |
| `src/app/bridges/page.tsx` | Create | Provider-first bridge analytics page |
| `src/app/layout.tsx` | Modify | Add `Bridges` nav entry |
| `src/components/BridgeFlowTable.tsx` | Create | Reusable table for provider and provider-asset daily rows |
| `__tests__/lib/bridge-registry.test.ts` | Create | Registry coverage and shape tests |
| `__tests__/lib/bridges.test.ts` | Create | Classifier and rollup tests |
| `__tests__/lib/bridge-verification.test.ts` | Create | RPC verification behavior tests |
| `__tests__/components/BridgeFlowTable.test.tsx` | Create | Rendering and fallback tests for the new table |

All paths are relative to the worktree root:
`.worktrees/bridge-flow-analytics/`

---

## Task 1: Add Verified Bridge Registry

**Files:**
- Create: `src/lib/bridge-registry.ts`
- Create: `__tests__/lib/bridge-registry.test.ts`

Context: keep provider metadata separate from analytics logic so adding providers later is a registry change, not a rewrite of the classifier.

- [ ] **Step 1: Write the failing registry tests**

Create `__tests__/lib/bridge-registry.test.ts`:

```typescript
import {
  BRIDGE_PROVIDERS,
  BRIDGE_CONTRACTS,
  getBridgeContractsForProvider,
  getBridgeTokenAddresses,
} from '@/lib/bridge-registry'

test('registry exposes only verified v1 providers', () => {
  expect(BRIDGE_PROVIDERS.map(p => p.id)).toEqual(['stargate', 'usdt0', 'frax'])
})

test('each verified provider has at least one Tempo contract mapping', () => {
  for (const provider of BRIDGE_PROVIDERS) {
    expect(getBridgeContractsForProvider(provider.id).length).toBeGreaterThan(0)
  }
})

test('registry exposes bridge token addresses for rollups', () => {
  const addresses = getBridgeTokenAddresses()
  expect(addresses.length).toBeGreaterThan(0)
  expect(addresses.every(a => a.startsWith('0x'))).toBe(true)
})
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib/bridge-registry.test.ts
```

Expected: FAIL because `@/lib/bridge-registry` does not exist yet

- [ ] **Step 3: Implement the registry module**

Create `src/lib/bridge-registry.ts`:

```typescript
export type BridgeProviderId = 'stargate' | 'usdt0' | 'frax'

export type BridgeContractRole =
  | 'router'
  | 'pool'
  | 'vault'
  | 'escrow'
  | 'token'
  | 'adapter'
  | 'endpoint'
  | 'messenger'

export interface BridgeProvider {
  id: BridgeProviderId
  label: string
}

export interface BridgeContract {
  provider: BridgeProviderId
  address: `0x${string}`
  role: BridgeContractRole
  asset: string
  confidence: 'verified'
}

export const BRIDGE_PROVIDERS: BridgeProvider[] = [
  { id: 'stargate', label: 'Stargate' },
  { id: 'usdt0', label: 'USDT0' },
  { id: 'frax', label: 'Frax' },
]

export const BRIDGE_CONTRACTS: BridgeContract[] = []

export function getBridgeContractsForProvider(provider: BridgeProviderId): BridgeContract[] {
  return BRIDGE_CONTRACTS.filter(contract => contract.provider === provider)
}

export function getBridgeTokenAddresses(): `0x${string}`[] {
  return BRIDGE_CONTRACTS
    .filter(contract => contract.role === 'token')
    .map(contract => contract.address)
}
```

During this step, replace the temporary empty array with only verified Tempo addresses from provider docs, RPC inspection, or confirmed onchain activity before committing. Do not add unverified contracts.

- [ ] **Step 4: Re-run the registry tests**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib/bridge-registry.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the registry task**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
git add src/lib/bridge-registry.ts __tests__/lib/bridge-registry.test.ts
git commit -m "feat: add verified bridge registry"
```

---

## Task 2: Implement Bridge Flow Classification and Daily Rollups

**Files:**
- Create: `src/lib/bridges.ts`
- Create: `__tests__/lib/bridges.test.ts`

Context: keep bridge analytics isolated from `src/lib/analytics.ts` so provider rules remain local and testable.

- [ ] **Step 1: Write the failing classifier and rollup tests**

Create `__tests__/lib/bridges.test.ts`:

```typescript
jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/bridge-registry', () => ({
  BRIDGE_PROVIDERS: [
    { id: 'stargate', label: 'Stargate' },
    { id: 'usdt0', label: 'USDT0' },
    { id: 'frax', label: 'Frax' },
  ],
  BRIDGE_CONTRACTS: [
    { provider: 'stargate', address: '0x1000000000000000000000000000000000000001', role: 'vault', asset: 'USDC.e', confidence: 'verified' },
    { provider: 'usdt0', address: '0x2000000000000000000000000000000000000002', role: 'token', asset: 'USDT0', confidence: 'verified' },
    { provider: 'frax', address: '0x3000000000000000000000000000000000000003', role: 'token', asset: 'frxUSD', confidence: 'verified' },
  ],
  getBridgeContractsForProvider: jest.fn(),
  getBridgeTokenAddresses: jest.fn(() => [
    '0x2000000000000000000000000000000000000002',
    '0x3000000000000000000000000000000000000003',
  ]),
}))

import { queryClickHouse } from '@/lib/clickhouse'
import { getDailyBridgeProviderFlows, getDailyBridgeProviderAssetFlows } from '@/lib/bridges'

const mockQuery = queryClickHouse as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('daily provider rollups map inflow and outflow totals', async () => {
  mockQuery.mockResolvedValueOnce([
    { day: '2026-04-07', provider: 'stargate', asset: 'USDC.e', flow_direction: 'inflow', amount_normalized: '1200', tx_count: '3', unique_users: '2' },
    { day: '2026-04-07', provider: 'stargate', asset: 'USDC.e', flow_direction: 'outflow', amount_normalized: '250', tx_count: '1', unique_users: '1' },
  ])

  const rows = await getDailyBridgeProviderFlows(30)

  expect(rows).toEqual([
    {
      day: '2026-04-07',
      provider: 'stargate',
      gross_inflow: 1200,
      gross_outflow: 250,
      net_flow: 950,
      tx_count: 4,
      unique_users: 2,
    },
  ])
})

test('provider asset rollups keep assets separated under each provider', async () => {
  mockQuery.mockResolvedValueOnce([
    { day: '2026-04-07', provider: 'usdt0', asset: 'USDT0', gross_inflow: '500', gross_outflow: '0', net_flow: '500', tx_count: '2', unique_users: '2' },
  ])

  const rows = await getDailyBridgeProviderAssetFlows(30)

  expect(rows[0]).toMatchObject({
    provider: 'usdt0',
    asset: 'USDT0',
    gross_inflow: 500,
    gross_outflow: 0,
    net_flow: 500,
  })
})
```

- [ ] **Step 2: Run the bridge analytics tests to verify they fail**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib/bridges.test.ts
```

Expected: FAIL because `@/lib/bridges` does not exist yet

- [ ] **Step 3: Implement the bridge analytics module**

Create `src/lib/bridges.ts`:

```typescript
import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'

export interface DailyBridgeProviderFlow {
  day: string
  provider: string
  gross_inflow: number
  gross_outflow: number
  net_flow: number
  tx_count: number
  unique_users: number
}

export interface DailyBridgeProviderAssetFlow extends DailyBridgeProviderFlow {
  asset: string
}

export async function getDailyBridgeProviderFlows(days = 30): Promise<DailyBridgeProviderFlow[]> {
  const key = `bridges:provider:${days}`
  const cached = await getCached<DailyBridgeProviderFlow[]>(key)
  if (cached) return cached

  const sql = buildHeadlineBridgeFlowSql(days)
  const rows = await queryClickHouse<{
    day: string
    provider: string
    asset: string
    flow_direction: string
    amount_normalized: string
    tx_count: string
    unique_users: string
  }>(sql)

  const byDayProvider = new Map<string, DailyBridgeProviderFlow>()
  for (const row of rows) {
    const mapKey = `${row.day}:${row.provider}`
    const current = byDayProvider.get(mapKey) ?? {
      day: String(row.day).slice(0, 10),
      provider: row.provider,
      gross_inflow: 0,
      gross_outflow: 0,
      net_flow: 0,
      tx_count: 0,
      unique_users: 0,
    }
    const amount = Number(row.amount_normalized)
    if (row.flow_direction === 'inflow') current.gross_inflow += amount
    if (row.flow_direction === 'outflow') current.gross_outflow += amount
    current.net_flow = current.gross_inflow - current.gross_outflow
    current.tx_count += Number(row.tx_count)
    current.unique_users = Math.max(current.unique_users, Number(row.unique_users))
    byDayProvider.set(mapKey, current)
  }

  const result = Array.from(byDayProvider.values()).sort((a, b) =>
    a.day.localeCompare(b.day) || a.provider.localeCompare(b.provider)
  )
  await setCached(key, result, 900)
  return result
}
```

In the same file, add:

- a second exported function for provider-asset rollups
- a `buildHeadlineBridgeFlowSql(days)` helper that uses raw ClickHouse `logs` plus ERC-20 `Transfer` events and the verified registry addresses
- provider-specific query filters from `bridge-registry`
- strict-user-flow only headline query behavior
- diagnostic rows kept separate from headline totals

- [ ] **Step 4: Re-run the bridge analytics tests**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib/bridges.test.ts
```

Expected: PASS

- [ ] **Step 5: Run the full lib test suite to catch regressions**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib
```

Expected: PASS with no new failures

- [ ] **Step 6: Commit the analytics task**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
git add src/lib/bridges.ts __tests__/lib/bridges.test.ts
git commit -m "feat: add bridge flow rollups"
```

---

## Task 3: Add RPC Verification Helpers

**Files:**
- Create: `src/lib/bridge-verification.ts`
- Create: `__tests__/lib/bridge-verification.test.ts`

Context: verification is an auditing layer. It must not become a hard runtime dependency for rendering the page.

- [ ] **Step 1: Write the failing verification tests**

Create `__tests__/lib/bridge-verification.test.ts`:

```typescript
jest.mock('@/lib/chain', () => ({
  publicClient: {
    getTransactionReceipt: jest.fn(),
    readContract: jest.fn(),
  },
}))

import { publicClient } from '@/lib/chain'
import { verifyBridgeFlowSample } from '@/lib/bridge-verification'

const mockReceipt = publicClient.getTransactionReceipt as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('verifyBridgeFlowSample returns ok when receipt exists', async () => {
  mockReceipt.mockResolvedValueOnce({
    status: 'success',
    logs: [{ address: '0x1000000000000000000000000000000000000001' }],
  })

  const result = await verifyBridgeFlowSample({
    tx_hash: '0x' + '1'.repeat(64),
    provider_contracts: ['0x1000000000000000000000000000000000000001'],
  })

  expect(result).toEqual({ ok: true, reason: 'matched_receipt_logs' })
})

test('verifyBridgeFlowSample returns failed when no provider contract is seen', async () => {
  mockReceipt.mockResolvedValueOnce({
    status: 'success',
    logs: [{ address: '0x9999999999999999999999999999999999999999' }],
  })

  const result = await verifyBridgeFlowSample({
    tx_hash: '0x' + '2'.repeat(64),
    provider_contracts: ['0x1000000000000000000000000000000000000001'],
  })

  expect(result).toEqual({ ok: false, reason: 'provider_contract_not_seen' })
})
```

- [ ] **Step 2: Run the verification tests to verify they fail**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib/bridge-verification.test.ts
```

Expected: FAIL because `@/lib/bridge-verification` does not exist yet

- [ ] **Step 3: Implement the verification helper**

Create `src/lib/bridge-verification.ts`:

```typescript
import { publicClient } from './chain'

export interface BridgeFlowSample {
  tx_hash: `0x${string}`
  provider_contracts: string[]
}

export interface BridgeFlowVerificationResult {
  ok: boolean
  reason: 'matched_receipt_logs' | 'provider_contract_not_seen' | 'rpc_error'
}

export async function verifyBridgeFlowSample(
  sample: BridgeFlowSample,
): Promise<BridgeFlowVerificationResult> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: sample.tx_hash })
    const seen = new Set(receipt.logs.map(log => log.address.toLowerCase()))
    const matched = sample.provider_contracts.some(address => seen.has(address.toLowerCase()))
    return matched
      ? { ok: true, reason: 'matched_receipt_logs' }
      : { ok: false, reason: 'provider_contract_not_seen' }
  } catch {
    return { ok: false, reason: 'rpc_error' }
  }
}
```

- [ ] **Step 4: Re-run the verification tests**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/lib/bridge-verification.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the verification task**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
git add src/lib/bridge-verification.ts __tests__/lib/bridge-verification.test.ts
git commit -m "feat: add bridge verification helpers"
```

---

## Task 4: Add Bridge Analytics UI

**Files:**
- Create: `src/components/BridgeFlowTable.tsx`
- Create: `src/app/bridges/page.tsx`
- Modify: `src/app/layout.tsx`
- Create: `__tests__/components/BridgeFlowTable.test.tsx`

Context: keep the UI minimal. `v1` only needs provider-first daily tables and provider-asset rollups, not charts or per-tx exploration.

- [ ] **Step 1: Write the failing table rendering test**

Create `__tests__/components/BridgeFlowTable.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { BridgeFlowTable } from '@/components/BridgeFlowTable'

test('renders provider daily flow rows', () => {
  render(
    <BridgeFlowTable
      title="Providers"
      rows={[
        {
          day: '2026-04-07',
          provider: 'stargate',
          gross_inflow: 1200,
          gross_outflow: 250,
          net_flow: 950,
          tx_count: 4,
          unique_users: 2,
        },
      ]}
    />
  )

  expect(screen.getByText('Providers')).toBeInTheDocument()
  expect(screen.getByText('stargate')).toBeInTheDocument()
  expect(screen.getByText('$1.2K')).toBeInTheDocument()
})

test('renders empty-state copy when no rows are present', () => {
  render(<BridgeFlowTable title="Providers" rows={[]} />)
  expect(screen.getByText(/no bridge flow data/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/components/BridgeFlowTable.test.tsx
```

Expected: FAIL because the component does not exist yet

- [ ] **Step 3: Implement the table component and page**

Create `src/components/BridgeFlowTable.tsx`:

```tsx
interface BridgeFlowRow {
  day: string
  provider: string
  gross_inflow: number
  gross_outflow: number
  net_flow: number
  tx_count: number
  unique_users: number
  asset?: string
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(n)

export function BridgeFlowTable({ title, rows }: { title: string; rows: BridgeFlowRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
        <h2 className="text-base font-medium text-white mb-2">{title}</h2>
        <p className="text-sm text-tempo-muted">No bridge flow data available.</p>
      </div>
    )
  }

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-tempo-border">
        <h2 className="text-base font-medium text-white">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-6 py-3 text-tempo-muted font-normal">Day</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-normal">Provider</th>
            <th className="text-right px-4 py-3 text-tempo-muted font-normal">Inflow</th>
            <th className="text-right px-4 py-3 text-tempo-muted font-normal">Outflow</th>
            <th className="text-right px-4 py-3 text-tempo-muted font-normal">Net</th>
            <th className="text-right px-4 py-3 text-tempo-muted font-normal">Txs</th>
            <th className="text-right px-6 py-3 text-tempo-muted font-normal">Users</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`${row.day}:${row.provider}:${row.asset ?? 'all'}`} className="border-b border-tempo-border">
              <td className="px-6 py-4 text-white">{row.day}</td>
              <td className="px-4 py-4 text-white">{row.asset ? `${row.provider} / ${row.asset}` : row.provider}</td>
              <td className="text-right px-4 py-4 font-mono text-white">{fmtUSD(row.gross_inflow)}</td>
              <td className="text-right px-4 py-4 font-mono text-white">{fmtUSD(row.gross_outflow)}</td>
              <td className="text-right px-4 py-4 font-mono text-white">{fmtUSD(row.net_flow)}</td>
              <td className="text-right px-4 py-4 text-tempo-muted">{row.tx_count}</td>
              <td className="text-right px-6 py-4 text-tempo-muted">{row.unique_users}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Create `src/app/bridges/page.tsx` that:

- imports `getDailyBridgeProviderFlows` and `getDailyBridgeProviderAssetFlows`
- fetches 30-day data with `Promise.all`
- renders a provider summary table first
- renders a provider-asset rollup table second

Modify `src/app/layout.tsx` by adding:

```tsx
<a href="/bridges" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Bridges</a>
```

- [ ] **Step 4: Re-run the component test**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand __tests__/components/BridgeFlowTable.test.tsx
```

Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand
```

Expected: PASS with all suites green

- [ ] **Step 6: Commit the UI task**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
git add src/components/BridgeFlowTable.tsx src/app/bridges/page.tsx src/app/layout.tsx __tests__/components/BridgeFlowTable.test.tsx
git commit -m "feat: add bridges analytics page"
```

---

## Task 5: Final Integration Verification

**Files:**
- Modify: `src/lib/bridges.ts` if needed
- Modify: `src/lib/bridge-verification.ts` if needed
- Modify: `src/app/bridges/page.tsx` if needed

- [ ] **Step 1: Run the full test suite from a clean working tree**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm test -- --runInBand
```

Expected: PASS with zero failing suites

- [ ] **Step 2: Run a production build**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm run build
```

Expected: Next.js build succeeds with exit code 0

- [ ] **Step 3: Smoke-check the new page locally**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
npm run dev
```

Open `http://localhost:3000/bridges` and confirm:

- `Bridges` appears in the nav
- provider-level rows render
- provider-asset rows render
- empty states are sensible if data is unavailable

- [ ] **Step 4: Commit any final integration fixes**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/bridge-flow-analytics
git add src/lib/bridges.ts src/lib/bridge-verification.ts src/app/bridges/page.tsx
git commit -m "fix: polish bridge analytics integration"
```
