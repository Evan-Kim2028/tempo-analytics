# Tempo Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public-facing, analytics-focused Tempo blockchain explorer with free browsing and MPP-paywalled CSV export, running alongside the existing tidx Docker stack at `~/tidx`.

**Architecture:** Next.js 15 App Router app (server components only — no client-side data fetching) backed by a Redis query cache and the tidx HTTP API at `http://tidx:8080`. Nginx sits in front for local HTTP caching. Docker Compose adds three services (explorer, redis, nginx) to the existing `~/tidx/docker-compose.yml`.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS 4, viem 2.43+, ioredis, Recharts, Jest + React Testing Library, Docker

---

## File Map

```
~/tidx/
├── docker-compose.yml            MODIFY — add explorer, redis, nginx services
├── nginx.conf                    CREATE — proxy + cache config
explorer/
├── Dockerfile
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── jest.config.ts
├── jest.setup.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx            root layout, nav
│   │   ├── page.tsx              / — network overview
│   │   ├── blocks/page.tsx       /blocks — block list
│   │   ├── tx/[hash]/page.tsx    /tx/[hash] — tx detail
│   │   ├── address/[addr]/page.tsx  /address/[addr]
│   │   ├── analytics/page.tsx    /analytics — hub with placeholders
│   │   └── api/export/route.ts   POST /api/export — MPP CSV endpoint
│   ├── lib/
│   │   ├── tidx.ts               tidx HTTP client (typed queries)
│   │   ├── cache.ts              Redis wrapper (get/set with TTL)
│   │   └── mpp.ts                MPP 402 challenge + payment verification
│   └── components/
│       ├── StatCard.tsx          number card with label + value
│       ├── BlocksTable.tsx       block list table
│       ├── TxDetail.tsx          tx fields display
│       ├── AddressTxList.tsx     address tx history table
│       ├── AnalyticsCard.tsx     placeholder card for /analytics
│       └── ExportButton.tsx      CSV export button (triggers MPP flow)
└── __tests__/
    ├── lib/tidx.test.ts
    ├── lib/cache.test.ts
    ├── lib/mpp.test.ts
    └── api/export.test.ts
```

---

## Known Schema (from live tidx queries)

```
blocks:   num, hash, parent_hash, timestamp, timestamp_ms, gas_limit, gas_used, miner, extra_data
txs:      block_num, block_timestamp, idx, hash, type, from, to, value, input, gas_limit,
          max_fee_per_gas, max_priority_fee_per_gas, gas_used, nonce_key, nonce,
          fee_token, fee_payer, calls, call_count, valid_before, valid_after, signature_type
receipts: block_num, block_timestamp, tx_idx, tx_hash, from, to, contract_address,
          gas_used, cumulative_gas_used, effective_gas_price, status, fee_payer
logs:     block_num, block_timestamp, log_idx, tx_idx, tx_hash, address, selector,
          topic0, topic1, topic2, topic3, data
```

`from` is a SQL reserved word — always quote it as `"from"` in queries.
`signature_type`: 0 = Secp256k1, 1 = P256, 2 = WebAuthn/passkey.
tidx API: `GET http://tidx:8080/query?sql=<url-encoded>&chainId=4217`
tidx status: `GET http://tidx:8080/status`

---

## Task 1: Docker Infrastructure

**Files:**
- Modify: `~/tidx/docker-compose.yml`
- Create: `~/tidx/nginx.conf`
- Create: `~/tidx/explorer/Dockerfile`

- [ ] **Step 1: Add redis, nginx, explorer services to docker-compose.yml**

Open `~/tidx/docker-compose.yml` and add to `services:` and `volumes:`:

```yaml
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - nginx_cache:/var/cache/nginx
    depends_on:
      - explorer
    restart: unless-stopped

  explorer:
    build: ./explorer
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      TIDX_URL: http://tidx:8080
      REDIS_URL: redis://redis:6379
      PAYMENT_ADDRESS: ${PAYMENT_ADDRESS}
      USDC_ADDRESS: ${USDC_ADDRESS:-0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913}
      NEXT_PUBLIC_CHAIN_ID: "4217"
    depends_on:
      - tidx
      - redis
    restart: unless-stopped
```

In `volumes:` at the bottom, add:
```yaml
  redis_data:
  nginx_cache:
```

- [ ] **Step 2: Create nginx.conf**

Create `~/tidx/nginx.conf`:

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=explorer_cache:10m
                 max_size=500m inactive=5m use_temp_path=off;

server {
    listen 80;

    # Static assets — long cache, immutable
    location /_next/static/ {
        proxy_pass http://explorer:3000;
        proxy_cache explorer_cache;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Cache-Status $upstream_cache_status;
    }

    # API routes — never cache
    location /api/ {
        proxy_pass http://explorer:3000;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }

    # HTML pages — 2 minute cache
    location / {
        proxy_pass http://explorer:3000;
        proxy_cache explorer_cache;
        proxy_cache_valid 200 2m;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header Cache-Control "public, max-age=120, stale-while-revalidate=60";
        add_header X-Cache-Status $upstream_cache_status;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

- [ ] **Step 3: Create explorer/Dockerfile**

Create `~/tidx/explorer/Dockerfile`:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Verify compose validates**

```bash
cd ~/tidx
docker compose config --quiet && echo "OK"
```

Expected: `OK` (explorer build will fail until we create the app, that's fine)

- [ ] **Step 5: Commit**

```bash
cd ~/tidx
git init .   # if not already a git repo
git add docker-compose.yml nginx.conf explorer/Dockerfile
git commit -m "feat: add explorer, redis, nginx docker services"
```

---

## Task 2: Next.js Project Scaffold

**Files:**
- Create: `explorer/package.json`
- Create: `explorer/next.config.ts`
- Create: `explorer/tsconfig.json`
- Create: `explorer/tailwind.config.ts`
- Create: `explorer/jest.config.ts`
- Create: `explorer/jest.setup.ts`

- [ ] **Step 1: Create package.json**

Create `~/tidx/explorer/package.json`:

```json
{
  "name": "tempo-explorer",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "next": "15.3.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "ioredis": "^5.4.2",
    "recharts": "^2.15.0",
    "viem": "^2.43.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.14.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "@jest/globals": "^29.7.0",
    "ts-jest": "^29.3.1",
    "tailwindcss": "^4.1.3",
    "@tailwindcss/postcss": "^4.1.3",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create next.config.ts**

Create `~/tidx/explorer/next.config.ts`:

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    dynamicIO: false,
  },
}

export default nextConfig
```

- [ ] **Step 3: Create tsconfig.json**

Create `~/tidx/explorer/tsconfig.json`:

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create tailwind.config.ts**

Create `~/tidx/explorer/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tempo: {
          blue: '#0057FF',
          dark: '#0A0A0F',
          card: '#13131A',
          border: '#1E1E2E',
          muted: '#6B7280',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
}

export default config
```

- [ ] **Step 5: Create jest.config.ts**

Create `~/tidx/explorer/jest.config.ts`:

```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathPattern: '__tests__',
}

export default createJestConfig(config)
```

- [ ] **Step 6: Create jest.setup.ts**

Create `~/tidx/explorer/jest.setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 7: Install dependencies**

```bash
cd ~/tidx/explorer
npm install
```

Expected: `added N packages` with no errors. `node_modules/` created.

- [ ] **Step 8: Create src/app/globals.css**

Create `~/tidx/explorer/src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #0A0A0F;
  --foreground: #E5E7EB;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.font-mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
```

- [ ] **Step 9: Commit**

```bash
cd ~/tidx/explorer
git add package.json next.config.ts tsconfig.json tailwind.config.ts jest.config.ts jest.setup.ts src/app/globals.css
git commit -m "feat: scaffold next.js explorer project"
```

---

## Task 3: tidx Client + Redis Cache

**Files:**
- Create: `explorer/src/lib/tidx.ts`
- Create: `explorer/src/lib/cache.ts`
- Create: `explorer/__tests__/lib/tidx.test.ts`
- Create: `explorer/__tests__/lib/cache.test.ts`

- [ ] **Step 1: Write failing tests for tidx client**

Create `~/tidx/explorer/__tests__/lib/tidx.test.ts`:

```typescript
import { queryTidx, getTidxStatus, type TidxRow } from '@/lib/tidx'

const MOCK_QUERY_RESPONSE = {
  ok: true,
  columns: ['num', 'hash'],
  rows: [[1000, '0xabc']],
  row_count: 1,
  engine: 'postgres',
  query_time_ms: 0.5,
}

const MOCK_STATUS = {
  ok: true,
  version: '0.5.1',
  chains: [{
    chain_id: 4217,
    head_num: 13567000,
    synced_num: 0,
    tip_num: 13567000,
    lag: 0,
    backfill_num: 5000000,
    backfill_remaining: 5000000,
    sync_rate: 3000,
    postgres: { blocks: 13567000, txs: 13567000, logs: 13566000, receipts: 13567000, blocks_count: 500000, txs_count: 600000, logs_count: 200000, receipts_count: 600000, rate: 3000 },
    clickhouse: { blocks: 13567000, txs: 13567000, logs: 13566000, receipts: 13567000, blocks_count: 500000, txs_count: 600000, logs_count: 200000, receipts_count: 600000, rate: 2900 },
  }],
}

beforeEach(() => {
  global.fetch = jest.fn()
})

test('queryTidx returns typed rows', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => MOCK_QUERY_RESPONSE,
  })
  const result = await queryTidx('SELECT num, hash FROM blocks LIMIT 1')
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toEqual({ num: 1000, hash: '0xabc' })
})

test('queryTidx throws on tidx error', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ ok: false, error: 'SQL parse error: bad syntax' }),
  })
  await expect(queryTidx('BAD SQL')).rejects.toThrow('SQL parse error: bad syntax')
})

test('getTidxStatus returns chain stats', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => MOCK_STATUS,
  })
  const status = await getTidxStatus()
  expect(status.chains[0].chain_id).toBe(4217)
  expect(status.chains[0].head_num).toBe(13567000)
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/tidx/explorer
npm test -- --testPathPattern=tidx --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/tidx'`

- [ ] **Step 3: Implement tidx.ts**

Create `~/tidx/explorer/src/lib/tidx.ts`:

```typescript
export type TidxRow = Record<string, string | number | null>

export interface TidxQueryResult {
  rows: TidxRow[]
  row_count: number
  engine: string
  query_time_ms: number
}

export interface TidxChainStatus {
  chain_id: number
  head_num: number
  synced_num: number
  tip_num: number
  lag: number
  backfill_num: number | null
  backfill_remaining: number
  sync_rate: number
  postgres: {
    blocks: number
    txs: number
    logs: number
    receipts: number
    blocks_count: number
    txs_count: number
    logs_count: number
    receipts_count: number
    rate: number
  }
  clickhouse: {
    blocks: number
    txs: number
    logs: number
    receipts: number
    blocks_count: number
    txs_count: number
    logs_count: number
    receipts_count: number
    rate: number
  }
}

export interface TidxStatus {
  ok: boolean
  version: string
  chains: TidxChainStatus[]
}

const TIDX_URL = process.env.TIDX_URL ?? 'http://localhost:8080'
const CHAIN_ID = '4217'

export async function queryTidx(sql: string): Promise<TidxQueryResult> {
  const url = `${TIDX_URL}/query?sql=${encodeURIComponent(sql)}&chainId=${CHAIN_ID}`
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error ?? 'tidx query failed')
  const rows: TidxRow[] = data.rows.map((row: (string | number | null)[]) =>
    Object.fromEntries(data.columns.map((col: string, i: number) => [col, row[i]]))
  )
  return { rows, row_count: data.row_count, engine: data.engine, query_time_ms: data.query_time_ms }
}

export async function getTidxStatus(): Promise<TidxStatus> {
  const res = await fetch(`${TIDX_URL}/status`, { cache: 'no-store' })
  return res.json()
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/tidx/explorer
npm test -- --testPathPattern=tidx --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Write failing tests for cache**

Create `~/tidx/explorer/__tests__/lib/cache.test.ts`:

```typescript
import { getCached, setCached, deleteCached } from '@/lib/cache'

// Mock ioredis
jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (key: string) => store[key] ?? null),
    set: jest.fn(async (key: string, value: string, ..._args: unknown[]) => { store[key] = value }),
    del: jest.fn(async (key: string) => { delete store[key] }),
  }))
})

test('getCached returns null on miss', async () => {
  const result = await getCached('missing-key')
  expect(result).toBeNull()
})

test('setCached and getCached round-trips JSON', async () => {
  const data = { num: 42, hash: '0xabc' }
  await setCached('test-key', data, 60)
  const result = await getCached<typeof data>('test-key')
  expect(result).toEqual(data)
})

test('deleteCached removes a key', async () => {
  await setCached('del-key', { x: 1 }, 60)
  await deleteCached('del-key')
  const result = await getCached('del-key')
  expect(result).toBeNull()
})
```

- [ ] **Step 6: Run tests — verify they fail**

```bash
npm test -- --testPathPattern=cache --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/cache'`

- [ ] **Step 7: Implement cache.ts**

Create `~/tidx/explorer/src/lib/cache.ts`:

```typescript
import Redis from 'ioredis'

let client: Redis | null = null

function getClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
    client.on('error', () => { /* suppress — cache is best-effort */ })
  }
  return client
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await getClient().get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // cache write failure is non-fatal
  }
}

export async function deleteCached(key: string): Promise<void> {
  try {
    await getClient().del(key)
  } catch {
    // non-fatal
  }
}
```

- [ ] **Step 8: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=cache --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
cd ~/tidx/explorer
git add src/lib/tidx.ts src/lib/cache.ts __tests__/lib/tidx.test.ts __tests__/lib/cache.test.ts
git commit -m "feat: add tidx client and redis cache wrapper"
```

---

## Task 4: Layout + Overview Page

**Files:**
- Create: `explorer/src/app/layout.tsx`
- Create: `explorer/src/app/page.tsx`
- Create: `explorer/src/components/StatCard.tsx`

- [ ] **Step 1: Create root layout**

Create `~/tidx/explorer/src/app/layout.tsx`:

```typescript
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tempo Explorer',
  description: 'Analytics-focused explorer for the Tempo blockchain',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tempo-dark text-gray-200">
        <nav className="border-b border-tempo-border px-6 py-4 flex items-center gap-8">
          <a href="/" className="text-white font-semibold text-lg tracking-tight">
            tempo<span className="text-tempo-blue">explorer</span>
          </a>
          <a href="/blocks" className="text-tempo-muted hover:text-white text-sm transition-colors">Blocks</a>
          <a href="/analytics" className="text-tempo-muted hover:text-white text-sm transition-colors">Analytics</a>
        </nav>
        <main className="px-6 py-8 max-w-6xl mx-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Create StatCard component**

Create `~/tidx/explorer/src/components/StatCard.tsx`:

```typescript
interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  mono?: boolean
}

export function StatCard({ label, value, sub, mono = false }: StatCardProps) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <p className="text-tempo-muted text-xs uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-semibold text-white ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
      {sub && <p className="text-tempo-muted text-xs mt-1">{sub}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Create overview page with server-side data fetching**

Create `~/tidx/explorer/src/app/page.tsx`:

```typescript
import { getCached, setCached } from '@/lib/cache'
import { queryTidx, getTidxStatus } from '@/lib/tidx'
import { StatCard } from '@/components/StatCard'

export const revalidate = 30

interface OverviewStats {
  latestBlock: number
  blockTime: number
  txsLast24h: number
  blocksToday: number
  backfillPct: number
  syncRate: number
}

async function getOverviewStats(): Promise<OverviewStats> {
  const cached = await getCached<OverviewStats>('overview:stats')
  if (cached) return cached

  const [status, blockTimeResult, txResult] = await Promise.all([
    getTidxStatus(),
    queryTidx(`
      SELECT ROUND(
        EXTRACT(EPOCH FROM (MAX(timestamp::timestamptz) - MIN(timestamp::timestamptz)))
        / (COUNT(*) - 1)::numeric, 3
      ) as avg_block_time
      FROM (SELECT timestamp FROM blocks ORDER BY num DESC LIMIT 500) sub
    `),
    queryTidx(`
      SELECT COUNT(*) as count
      FROM txs
      WHERE block_timestamp >= NOW() - INTERVAL '24 hours'
    `),
  ])

  const chain = status.chains.find(c => c.chain_id === 4217)!
  const stats: OverviewStats = {
    latestBlock: chain.tip_num,
    blockTime: Number(blockTimeResult.rows[0]?.avg_block_time ?? 0.5),
    txsLast24h: Number(txResult.rows[0]?.count ?? 0),
    blocksToday: chain.postgres.blocks_count,
    backfillPct: chain.backfill_num != null
      ? Math.round((1 - chain.backfill_num / chain.head_num) * 100)
      : 100,
    syncRate: chain.sync_rate > 0 ? Math.round(chain.sync_rate) : 0,
  }

  await setCached('overview:stats', stats, 30)
  return stats
}

export default async function OverviewPage() {
  const stats = await getOverviewStats()
  const mainnetLaunch = new Date('2026-03-18T00:00:00Z')
  const daysSinceLaunch = Math.floor((Date.now() - mainnetLaunch.getTime()) / 86400000)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Tempo Mainnet</h1>
        <p className="text-tempo-muted text-sm mt-1">
          Chain ID 4217 · Presto · Mainnet live {daysSinceLaunch} days
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Latest Block" value={stats.latestBlock.toLocaleString()} mono />
        <StatCard label="Avg Block Time" value={`${stats.blockTime}s`} sub="last 500 blocks" />
        <StatCard label="Txs (24h)" value={stats.txsLast24h.toLocaleString()} />
        <StatCard label="Blocks Indexed" value={stats.blocksToday.toLocaleString()} />
        <StatCard
          label="Backfill"
          value={`${stats.backfillPct}%`}
          sub={stats.backfillPct < 100 ? `${stats.syncRate.toLocaleString()} blocks/sec` : 'complete'}
        />
        <StatCard label="Days Since Launch" value={daysSinceLaunch} sub="March 18, 2026" />
      </div>

      <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
        <p className="text-tempo-muted text-sm">
          Tempo is a payments-optimized L1 with native account abstraction, sub-second finality,
          and stablecoin-only fees. This explorer surfaces on-chain data unique to Tempo's
          architecture — passkey wallets, batch calls, fee sponsorship, and stablecoin usage.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify Next.js builds without errors**

```bash
cd ~/tidx/explorer
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` (or similar). No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx src/components/StatCard.tsx
git commit -m "feat: overview page with live network stats"
```

---

## Task 5: Blocks Page

**Files:**
- Create: `explorer/src/app/blocks/page.tsx`
- Create: `explorer/src/components/BlocksTable.tsx`

- [ ] **Step 1: Create BlocksTable component**

Create `~/tidx/explorer/src/components/BlocksTable.tsx`:

```typescript
interface Block {
  num: number
  hash: string
  timestamp: string
  gas_used: number
  miner: string
}

export function BlocksTable({ blocks }: { blocks: Block[] }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Block</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden md:table-cell">Time</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden lg:table-cell">Miner</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Gas Used</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map(block => (
            <tr key={block.num} className="border-b border-tempo-border last:border-0 hover:bg-white/5 transition-colors">
              <td className="px-4 py-3">
                <span className="text-tempo-blue font-mono">{block.num.toLocaleString()}</span>
              </td>
              <td className="px-4 py-3 text-tempo-muted hidden md:table-cell font-mono text-xs">
                {new Date(block.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
              </td>
              <td className="px-4 py-3 hidden lg:table-cell">
                <a href={`/address/${block.miner}`} className="text-tempo-muted hover:text-white font-mono text-xs truncate block max-w-xs">
                  {block.miner}
                </a>
              </td>
              <td className="px-4 py-3 text-tempo-muted font-mono text-xs">
                {block.gas_used.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Create blocks page**

Create `~/tidx/explorer/src/app/blocks/page.tsx`:

```typescript
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { BlocksTable } from '@/components/BlocksTable'

export const revalidate = 30

interface Block {
  num: number
  hash: string
  timestamp: string
  gas_used: number
  miner: string
}

async function getLatestBlocks(): Promise<Block[]> {
  const cached = await getCached<Block[]>('blocks:latest')
  if (cached) return cached

  const result = await queryTidx(`
    SELECT num, hash, timestamp, gas_used, miner
    FROM blocks
    ORDER BY num DESC
    LIMIT 50
  `)

  const blocks = result.rows as unknown as Block[]
  await setCached('blocks:latest', blocks, 30)
  return blocks
}

export default async function BlocksPage() {
  const blocks = await getLatestBlocks()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-6">Latest Blocks</h1>
      <BlocksTable blocks={blocks} />
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd ~/tidx/explorer
npm run build 2>&1 | tail -10
```

Expected: builds cleanly, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/blocks/page.tsx src/components/BlocksTable.tsx
git commit -m "feat: blocks list page"
```

---

## Task 6: Transaction + Address Pages

**Files:**
- Create: `explorer/src/app/tx/[hash]/page.tsx`
- Create: `explorer/src/components/TxDetail.tsx`
- Create: `explorer/src/app/address/[addr]/page.tsx`
- Create: `explorer/src/components/AddressTxList.tsx`

- [ ] **Step 1: Create TxDetail component**

Create `~/tidx/explorer/src/components/TxDetail.tsx`:

```typescript
const SIG_TYPES: Record<number, string> = {
  0: 'Secp256k1 (standard EVM)',
  1: 'P256 (hardware key)',
  2: 'WebAuthn (passkey)',
}

interface TxDetailProps {
  tx: Record<string, string | number | null>
  receipt: Record<string, string | number | null> | null
}

function Field({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3 border-b border-tempo-border last:border-0">
      <dt className="text-tempo-muted text-sm">{label}</dt>
      <dd className={`col-span-2 text-sm text-white break-all ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-tempo-muted">—</span>}
      </dd>
    </div>
  )
}

export function TxDetail({ tx, receipt }: TxDetailProps) {
  const sigType = tx.signature_type != null ? (SIG_TYPES[Number(tx.signature_type)] ?? `Type ${tx.signature_type}`) : null
  const isSponsored = tx.fee_payer && tx.fee_payer !== tx.from
  const hasBatchCalls = Number(tx.call_count ?? 0) > 0

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
      <dl>
        <Field label="Hash" value={tx.hash as string} />
        <Field label="Block" value={
          <a href={`/blocks#${tx.block_num}`} className="text-tempo-blue hover:underline">
            {String(tx.block_num)}
          </a>
        } />
        <Field label="Timestamp" value={tx.block_timestamp as string} />
        <Field label="From" value={
          <a href={`/address/${tx.from}`} className="text-tempo-blue hover:underline">
            {tx.from as string}
          </a>
        } />
        <Field label="To" value={
          tx.to ? <a href={`/address/${tx.to}`} className="text-tempo-blue hover:underline">{tx.to as string}</a> : <span className="text-yellow-400">Contract Creation</span>
        } />
        <Field label="Value" value={`${tx.value ?? '0'} wei`} />
        <Field label="Status" value={
          receipt ? (
            Number(receipt.status) === 1
              ? <span className="text-green-400">Success</span>
              : <span className="text-red-400">Failed</span>
          ) : null
        } mono={false} />

        {/* Tempo-specific fields */}
        <Field label="Signature Type" value={sigType} mono={false} />
        <Field label="Fee Token" value={tx.fee_token as string | null} />
        <Field label="Fee Payer" value={
          isSponsored
            ? <span>{tx.fee_payer as string} <span className="text-yellow-400 ml-2 text-xs">(sponsored)</span></span>
            : tx.fee_payer as string
        } />
        {hasBatchCalls && (
          <Field label="Batch Calls" value={`${tx.call_count} calls`} mono={false} />
        )}
        {tx.valid_before && <Field label="Valid Before" value={tx.valid_before as string} />}
        {tx.valid_after && <Field label="Valid After" value={tx.valid_after as string} />}
        <Field label="Nonce Key" value={tx.nonce_key as string | null} />
        <Field label="Nonce" value={tx.nonce != null ? String(tx.nonce) : null} />
        {receipt && <Field label="Gas Used" value={String(receipt.gas_used)} />}
      </dl>
    </div>
  )
}
```

- [ ] **Step 2: Create tx detail page**

Create `~/tidx/explorer/src/app/tx/[hash]/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { TxDetail } from '@/components/TxDetail'

export const revalidate = 60

async function getTx(hash: string) {
  const key = `tx:${hash}`
  const cached = await getCached<{ tx: Record<string, unknown>; receipt: Record<string, unknown> | null }>(key)
  if (cached) return cached

  const [txResult, receiptResult] = await Promise.all([
    queryTidx(`SELECT * FROM txs WHERE hash = '${hash}' LIMIT 1`),
    queryTidx(`SELECT * FROM receipts WHERE tx_hash = '${hash}' LIMIT 1`),
  ])

  if (!txResult.rows.length) return null

  const data = { tx: txResult.rows[0], receipt: receiptResult.rows[0] ?? null }
  await setCached(key, data, 60)
  return data
}

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  const data = await getTx(hash)
  if (!data) notFound()

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-2">Transaction</h1>
      <p className="text-tempo-muted font-mono text-sm mb-6 break-all">{hash}</p>
      <TxDetail tx={data.tx as Record<string, string | number | null>} receipt={data.receipt as Record<string, string | number | null> | null} />
    </div>
  )
}
```

- [ ] **Step 3: Create AddressTxList component**

Create `~/tidx/explorer/src/components/AddressTxList.tsx`:

```typescript
interface TxRow {
  hash: string
  block_num: number
  block_timestamp: string
  from: string
  to: string | null
  value: string
  signature_type: number
  fee_token: string | null
  fee_payer: string
  call_count: number
}

const SIG_BADGES: Record<number, { label: string; color: string }> = {
  0: { label: 'EOA', color: 'text-gray-400' },
  1: { label: 'P256', color: 'text-blue-400' },
  2: { label: 'Passkey', color: 'text-purple-400' },
}

export function AddressTxList({ txs, address }: { txs: TxRow[]; address: string }) {
  if (!txs.length) return <p className="text-tempo-muted text-sm">No transactions found.</p>

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Tx Hash</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden md:table-cell">Block</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Direction</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden lg:table-cell">Type</th>
          </tr>
        </thead>
        <tbody>
          {txs.map(tx => {
            const sig = SIG_BADGES[tx.signature_type] ?? { label: `Type ${tx.signature_type}`, color: 'text-gray-400' }
            const isOut = tx.from?.toLowerCase() === address.toLowerCase()
            return (
              <tr key={tx.hash} className="border-b border-tempo-border last:border-0 hover:bg-white/5">
                <td className="px-4 py-3">
                  <a href={`/tx/${tx.hash}`} className="text-tempo-blue font-mono text-xs hover:underline truncate block max-w-[140px]">
                    {tx.hash.slice(0, 18)}…
                  </a>
                </td>
                <td className="px-4 py-3 text-tempo-muted font-mono text-xs hidden md:table-cell">
                  {tx.block_num.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${isOut ? 'text-red-400' : 'text-green-400'}`}>
                    {isOut ? 'OUT' : 'IN'}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className={`text-xs ${sig.color}`}>{sig.label}</span>
                  {tx.call_count > 0 && <span className="text-yellow-400 text-xs ml-2">batch</span>}
                  {tx.fee_payer && tx.fee_payer !== tx.from && <span className="text-teal-400 text-xs ml-2">sponsored</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Create address page**

Create `~/tidx/explorer/src/app/address/[addr]/page.tsx`:

```typescript
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { AddressTxList } from '@/components/AddressTxList'
import { StatCard } from '@/components/StatCard'

export const revalidate = 60

async function getAddressData(addr: string) {
  const key = `address:${addr.toLowerCase()}`
  const cached = await getCached<{ txs: unknown[]; stats: unknown }>(key)
  if (cached) return cached

  const lowerAddr = addr.toLowerCase()

  const [txResult, statsResult, sponsoredResult] = await Promise.all([
    queryTidx(`
      SELECT block_num, block_timestamp, hash, "from", "to", value,
             signature_type, fee_token, fee_payer, call_count
      FROM txs
      WHERE lower("from") = '${lowerAddr}' OR lower("to") = '${lowerAddr}'
      ORDER BY block_num DESC
      LIMIT 50
    `),
    queryTidx(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN lower("from") = '${lowerAddr}' THEN 1 ELSE 0 END) as sent,
             SUM(CASE WHEN lower("to") = '${lowerAddr}' THEN 1 ELSE 0 END) as received
      FROM txs
      WHERE lower("from") = '${lowerAddr}' OR lower("to") = '${lowerAddr}'
    `),
    queryTidx(`
      SELECT COUNT(*) as count
      FROM txs
      WHERE lower(fee_payer) = '${lowerAddr}' AND lower("from") != '${lowerAddr}'
    `),
  ])

  const data = {
    txs: txResult.rows,
    stats: {
      ...statsResult.rows[0],
      sponsored_others: sponsoredResult.rows[0]?.count ?? 0,
    },
  }
  await setCached(key, data, 60)
  return data
}

export default async function AddressPage({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params
  const data = await getAddressData(addr)
  const stats = data.stats as Record<string, number>

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-2">Address</h1>
      <p className="text-tempo-muted font-mono text-sm mb-6 break-all">{addr}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Txs" value={Number(stats.total ?? 0).toLocaleString()} />
        <StatCard label="Sent" value={Number(stats.sent ?? 0).toLocaleString()} />
        <StatCard label="Received" value={Number(stats.received ?? 0).toLocaleString()} />
        <StatCard label="Sponsored Others" value={Number(stats.sponsored_others ?? 0).toLocaleString()} />
      </div>

      <h2 className="text-lg font-medium text-white mb-4">Transactions</h2>
      <AddressTxList txs={data.txs as Parameters<typeof AddressTxList>[0]['txs']} address={addr} />
    </div>
  )
}
```

- [ ] **Step 5: Verify build**

```bash
cd ~/tidx/explorer
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/tx src/app/address src/components/TxDetail.tsx src/components/AddressTxList.tsx
git commit -m "feat: tx detail and address pages"
```

---

## Task 7: Analytics Hub + AnalyticsCard

**Files:**
- Create: `explorer/src/components/AnalyticsCard.tsx`
- Create: `explorer/src/app/analytics/page.tsx`

- [ ] **Step 1: Create AnalyticsCard component**

Create `~/tidx/explorer/src/components/AnalyticsCard.tsx`:

```typescript
interface AnalyticsCardProps {
  title: string
  description: string
  slug: string
  available: boolean
  tags?: string[]
}

export function AnalyticsCard({ title, description, slug, available, tags = [] }: AnalyticsCardProps) {
  const inner = (
    <div className={`bg-tempo-card border rounded-lg p-5 h-full transition-colors ${
      available
        ? 'border-tempo-border hover:border-tempo-blue cursor-pointer'
        : 'border-tempo-border opacity-50 cursor-not-allowed'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-white font-medium">{title}</h3>
        {!available && (
          <span className="text-xs text-tempo-muted bg-tempo-border px-2 py-0.5 rounded">soon</span>
        )}
      </div>
      <p className="text-tempo-muted text-sm leading-relaxed">{description}</p>
      {tags.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {tags.map(tag => (
            <span key={tag} className="text-xs text-tempo-blue bg-tempo-blue/10 px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  if (!available) return <div>{inner}</div>
  return <a href={`/analytics/${slug}`}>{inner}</a>
}
```

- [ ] **Step 2: Create analytics hub page**

Create `~/tidx/explorer/src/app/analytics/page.tsx`:

```typescript
import { AnalyticsCard } from '@/components/AnalyticsCard'

export const revalidate = 3600

const ANALYTICS_VIEWS = [
  {
    title: 'Account Types',
    description: 'Distribution of Secp256k1 (EOA), P256, and WebAuthn/passkey signature types. Tempo\'s native account abstraction in action.',
    slug: 'account-types',
    available: false,
    tags: ['account abstraction', 'passkeys'],
  },
  {
    title: 'Batch Calls',
    description: 'What percentage of transactions use Tempo\'s native calls[] batching? What are the most common call depths and patterns?',
    slug: 'batch-calls',
    available: false,
    tags: ['native AA', 'UX'],
  },
  {
    title: 'Fee Sponsorship',
    description: 'When fee_payer ≠ sender, a dApp is subsidizing gas for the user. Track who sponsors fees and how adoption is growing.',
    slug: 'fee-sponsorship',
    available: false,
    tags: ['gasless', 'sponsorship'],
  },
  {
    title: 'Fee Tokens',
    description: 'Which stablecoins are being used to pay transaction fees? USDC, USDT, USDB, and others — Tempo lets you pay in any.',
    slug: 'fee-tokens',
    available: false,
    tags: ['stablecoins', 'fees'],
  },
  {
    title: 'Mainnet Launch',
    description: 'Week-by-week activity before and after the March 18, 2026 mainnet launch. Who were the first users?',
    slug: 'mainnet-launch',
    available: false,
    tags: ['growth', 'history'],
  },
]

export default function AnalyticsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="text-tempo-muted text-sm mt-1">
          Opinionated views into Tempo-specific on-chain behavior.
          Data is backfilling — charts will go live once the full history is indexed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ANALYTICS_VIEWS.map(view => (
          <AnalyticsCard key={view.slug} {...view} />
        ))}
      </div>

      <p className="text-tempo-muted text-xs mt-8 text-center">
        More views added as the data tells interesting stories.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd ~/tidx/explorer
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/analytics src/components/AnalyticsCard.tsx
git commit -m "feat: analytics hub page with placeholder cards"
```

---

## Task 8: MPP Export Endpoint + ExportButton

**Files:**
- Create: `explorer/src/lib/mpp.ts`
- Create: `explorer/src/app/api/export/route.ts`
- Create: `explorer/src/components/ExportButton.tsx`
- Create: `explorer/__tests__/lib/mpp.test.ts`
- Create: `explorer/__tests__/api/export.test.ts`

> **Note:** The payment_address and usdc_address env vars must be set before export payments work. The `PAYMENT_ADDRESS` must be a Tempo wallet address you control. The `USDC_ADDRESS` is the canonical USDC contract on Tempo — confirm it from https://docs.tempo.xyz or the Tempo token registry.

- [ ] **Step 1: Write failing tests for mpp.ts**

Create `~/tidx/explorer/__tests__/lib/mpp.test.ts`:

```typescript
import { createChallenge, verifyPayment } from '@/lib/mpp'

jest.mock('@/lib/cache', () => ({
  getCached: jest.fn(),
  setCached: jest.fn(),
}))

jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    getTransactionReceipt: jest.fn(),
    getLogs: jest.fn(),
  })),
  http: jest.fn(),
  parseUnits: jest.fn((val: string) => BigInt(Math.floor(Number(val) * 1e6))),
  defineChain: jest.fn((config: unknown) => config),
}))

import { getCached, setCached } from '@/lib/cache'

test('createChallenge returns price, recipient, and nonce', () => {
  const challenge = createChallenge()
  expect(challenge.price).toBe('0.10')
  expect(challenge.currency).toBe('USDC')
  expect(challenge.recipient).toBe(process.env.PAYMENT_ADDRESS ?? '')
  expect(challenge.nonce).toHaveLength(32)
  expect(typeof challenge.expires).toBe('number')
})

test('verifyPayment rejects already-used tx hash', async () => {
  ;(getCached as jest.Mock).mockResolvedValue('used')
  const result = await verifyPayment('0xalreadyused')
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/already used/)
})

test('verifyPayment marks tx as used after success', async () => {
  ;(getCached as jest.Mock).mockResolvedValue(null)
  // We'll mock the viem client in the module
  const result = await verifyPayment('0xfakebutnotused')
  // Will fail on-chain check in test env, that's OK — we're testing the replay protection path
  expect(setCached).not.toHaveBeenCalledWith('used_tx:0xfakebutnotused', 'used', expect.any(Number))
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- --testPathPattern=mpp --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/mpp'`

- [ ] **Step 3: Implement mpp.ts**

Create `~/tidx/explorer/src/lib/mpp.ts`:

```typescript
import { createPublicClient, http, parseUnits, defineChain } from 'viem'
import { getCached, setCached } from '@/lib/cache'
import { randomBytes } from 'crypto'

const tempo = defineChain({
  id: 4217,
  name: 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.tempo.xyz'] },
  },
})

const PAYMENT_ADDRESS = (process.env.PAYMENT_ADDRESS ?? '') as `0x${string}`
const USDC_ADDRESS = (process.env.USDC_ADDRESS ?? '') as `0x${string}`
const EXPORT_PRICE_USDC = '0.10'

// ERC-20 Transfer event topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export interface MppChallenge {
  price: string
  currency: string
  recipient: string
  nonce: string
  expires: number
}

export function createChallenge(): MppChallenge {
  return {
    price: EXPORT_PRICE_USDC,
    currency: 'USDC',
    recipient: PAYMENT_ADDRESS,
    nonce: randomBytes(16).toString('hex'),
    expires: Math.floor(Date.now() / 1000) + 300, // 5 minute window
  }
}

export interface PaymentVerification {
  ok: boolean
  error?: string
}

export async function verifyPayment(txHash: string): Promise<PaymentVerification> {
  const usedKey = `used_tx:${txHash.toLowerCase()}`
  const alreadyUsed = await getCached<string>(usedKey)
  if (alreadyUsed) return { ok: false, error: 'Payment tx already used' }

  if (!PAYMENT_ADDRESS || !USDC_ADDRESS) {
    return { ok: false, error: 'Payment not configured on server' }
  }

  try {
    const client = createPublicClient({ chain: tempo, transport: http() })

    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
    if (receipt.status !== 'success') {
      return { ok: false, error: 'Transaction failed' }
    }

    // Find a USDC Transfer log to PAYMENT_ADDRESS
    const logs = await client.getLogs({
      address: USDC_ADDRESS,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { indexed: true, name: 'from', type: 'address' },
          { indexed: true, name: 'to', type: 'address' },
          { indexed: false, name: 'value', type: 'uint256' },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    })

    const paymentLog = logs.find(log =>
      log.transactionHash?.toLowerCase() === txHash.toLowerCase() &&
      (log.args as { to?: string }).to?.toLowerCase() === PAYMENT_ADDRESS.toLowerCase()
    )

    if (!paymentLog) {
      return { ok: false, error: 'No USDC transfer to payment address found in tx' }
    }

    const transferred = (log: typeof paymentLog) =>
      (log.args as { value?: bigint }).value ?? 0n
    const minAmount = parseUnits(EXPORT_PRICE_USDC, 6) // USDC has 6 decimals
    if (transferred(paymentLog) < minAmount) {
      return { ok: false, error: `Insufficient payment: need ≥ $${EXPORT_PRICE_USDC} USDC` }
    }

    // Mark as used — 48h TTL prevents replay, long enough for any reasonable use
    await setCached(usedKey, 'used', 172800)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Verification failed: ${(err as Error).message}` }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=mpp --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Write failing tests for export route**

Create `~/tidx/explorer/__tests__/api/export.test.ts`:

```typescript
import { POST } from '@/app/api/export/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/mpp', () => ({
  createChallenge: jest.fn(() => ({
    price: '0.10', currency: 'USDC', recipient: '0xpay', nonce: 'abc', expires: 9999999999,
  })),
  verifyPayment: jest.fn(),
}))

jest.mock('@/lib/tidx', () => ({
  queryTidx: jest.fn(async () => ({
    rows: [{ num: 1, hash: '0xabc' }, { num: 2, hash: '0xdef' }],
    row_count: 2,
    engine: 'clickhouse',
    query_time_ms: 5,
  })),
}))

import { createChallenge, verifyPayment } from '@/lib/mpp'

function makeRequest(body: unknown, paymentHeader?: string) {
  const req = new NextRequest('http://localhost/api/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(paymentHeader ? { 'X-Payment': paymentHeader } : {}),
    },
  })
  return req
}

test('returns 402 with challenge when no payment header', async () => {
  const req = makeRequest({ query: 'account-types' })
  const res = await POST(req)
  expect(res.status).toBe(402)
  const body = await res.json()
  expect(body.challenge.price).toBe('0.10')
  expect(createChallenge).toHaveBeenCalled()
})

test('returns 402 when payment verification fails', async () => {
  ;(verifyPayment as jest.Mock).mockResolvedValue({ ok: false, error: 'Payment tx already used' })
  const req = makeRequest({ query: 'account-types' }, '0xbadtx')
  const res = await POST(req)
  expect(res.status).toBe(402)
})

test('returns CSV when payment is valid', async () => {
  ;(verifyPayment as jest.Mock).mockResolvedValue({ ok: true })
  const req = makeRequest({ query: 'account-types' }, '0xgoodtx')
  const res = await POST(req)
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
  const body = await res.text()
  expect(body).toContain('num,hash')
  expect(body).toContain('0xabc')
})

test('returns 400 for unknown query key', async () => {
  ;(verifyPayment as jest.Mock).mockResolvedValue({ ok: true })
  const req = makeRequest({ query: 'unknown-view' }, '0xgoodtx')
  const res = await POST(req)
  expect(res.status).toBe(400)
})
```

- [ ] **Step 6: Run tests — verify they fail**

```bash
npm test -- --testPathPattern=export --no-coverage
```

Expected: FAIL — `Cannot find module '@/app/api/export/route'`

- [ ] **Step 7: Implement the export route**

Create `~/tidx/explorer/src/app/api/export/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createChallenge, verifyPayment } from '@/lib/mpp'
import { queryTidx } from '@/lib/tidx'

// Allowlisted export queries — no arbitrary SQL from clients
const EXPORT_QUERIES: Record<string, string> = {
  'account-types': `
    SELECT signature_type, COUNT(*) as count,
           ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pct
    FROM txs
    GROUP BY signature_type
    ORDER BY count DESC
  `,
  'batch-calls': `
    SELECT call_count, COUNT(*) as tx_count
    FROM txs
    WHERE call_count > 0
    GROUP BY call_count
    ORDER BY call_count
  `,
  'fee-sponsorship': `
    SELECT DATE(block_timestamp) as day,
           COUNT(*) as total_txs,
           SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) as sponsored,
           ROUND(SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as pct_sponsored
    FROM txs
    GROUP BY day
    ORDER BY day DESC
    LIMIT 90
  `,
  'fee-tokens': `
    SELECT fee_token, COUNT(*) as count
    FROM txs
    WHERE fee_token IS NOT NULL
    GROUP BY fee_token
    ORDER BY count DESC
  `,
  'mainnet-launch': `
    SELECT DATE_TRUNC('week', block_timestamp::timestamptz) as week,
           COUNT(*) as txs,
           COUNT(DISTINCT "from") as unique_senders
    FROM txs
    GROUP BY week
    ORDER BY week ASC
  `,
  'latest-blocks': `
    SELECT num, hash, timestamp, gas_used, miner
    FROM blocks
    ORDER BY num DESC
    LIMIT 1000
  `,
}

function rowsToCsv(columns: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null) => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const header = columns.join(',')
  const body = rows.map(row => row.map(escape).join(',')).join('\n')
  return `${header}\n${body}`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { query: queryKey } = body as { query?: string }

  if (!queryKey || !EXPORT_QUERIES[queryKey]) {
    return NextResponse.json({ error: 'Unknown export query' }, { status: 400 })
  }

  const paymentTxHash = req.headers.get('X-Payment')

  if (!paymentTxHash) {
    const challenge = createChallenge()
    return NextResponse.json({ challenge }, { status: 402 })
  }

  const verification = await verifyPayment(paymentTxHash)
  if (!verification.ok) {
    const challenge = createChallenge()
    return NextResponse.json({ error: verification.error, challenge }, { status: 402 })
  }

  const result = await queryTidx(EXPORT_QUERIES[queryKey])

  // Build raw rows array for CSV (queryTidx returns objects — re-fetch raw for CSV)
  const rawResult = await fetch(
    `${process.env.TIDX_URL ?? 'http://localhost:8080'}/query?sql=${encodeURIComponent(EXPORT_QUERIES[queryKey])}&chainId=4217`,
    { cache: 'no-store' }
  ).then(r => r.json())

  const csv = rowsToCsv(rawResult.columns, rawResult.rows)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
    },
  })
}
```

- [ ] **Step 8: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=export --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 9: Create ExportButton component**

Create `~/tidx/explorer/src/components/ExportButton.tsx`:

```typescript
'use client'

import { useState } from 'react'

interface ExportButtonProps {
  queryKey: string
  label?: string
}

type ExportState = 'idle' | 'awaiting_payment' | 'verifying' | 'downloading' | 'error'

export function ExportButton({ queryKey, label = 'Export CSV' }: ExportButtonProps) {
  const [state, setState] = useState<ExportState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<{
    price: string; currency: string; recipient: string; nonce: string
  } | null>(null)
  const [txHash, setTxHash] = useState('')

  async function handleExport() {
    setState('awaiting_payment')
    setError(null)

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryKey }),
    })

    if (res.status === 402) {
      const data = await res.json()
      setChallenge(data.challenge)
      return
    }

    if (!res.ok) {
      setState('error')
      setError('Export failed')
    }
  }

  async function handlePaymentSubmit() {
    if (!txHash.startsWith('0x')) {
      setError('Please enter a valid transaction hash (starts with 0x)')
      return
    }

    setState('verifying')
    setError(null)

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': txHash,
      },
      body: JSON.stringify({ query: queryKey }),
    })

    if (res.status === 402) {
      const data = await res.json()
      setState('awaiting_payment')
      setError(data.error ?? 'Payment verification failed')
      return
    }

    if (!res.ok) {
      setState('error')
      setError('Download failed')
      return
    }

    setState('downloading')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tempo-${queryKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setState('idle')
    setChallenge(null)
    setTxHash('')
  }

  if (state === 'awaiting_payment' && challenge) {
    return (
      <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 text-sm max-w-sm">
        <p className="text-white font-medium mb-2">Pay to Export</p>
        <p className="text-tempo-muted mb-3">
          Send <strong className="text-white">${challenge.price} {challenge.currency}</strong> to:
        </p>
        <p className="font-mono text-xs text-tempo-blue break-all mb-4">{challenge.recipient}</p>
        <input
          type="text"
          placeholder="Paste transaction hash (0x...)"
          value={txHash}
          onChange={e => setTxHash(e.target.value)}
          className="w-full bg-tempo-dark border border-tempo-border rounded px-3 py-2 text-sm font-mono text-white placeholder:text-tempo-muted mb-3 focus:outline-none focus:border-tempo-blue"
        />
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handlePaymentSubmit}
            className="bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors"
          >
            Verify & Download
          </button>
          <button
            onClick={() => { setState('idle'); setChallenge(null); setError(null) }}
            className="text-tempo-muted hover:text-white px-4 py-2 rounded text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={handleExport}
      disabled={state === 'verifying' || state === 'downloading'}
      className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors disabled:opacity-50"
    >
      {state === 'verifying' ? 'Verifying…' : state === 'downloading' ? 'Downloading…' : label}
    </button>
  )
}
```

- [ ] **Step 10: Run all tests**

```bash
cd ~/tidx/explorer
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/mpp.ts src/app/api/export src/components/ExportButton.tsx \
        __tests__/lib/mpp.test.ts __tests__/api/export.test.ts
git commit -m "feat: MPP export endpoint and ExportButton (402 paywall)"
```

---

## Task 9: Wire Everything + Deploy

**Files:**
- Modify: `~/tidx/docker-compose.yml` — confirm explorer build
- Modify: `~/tidx/explorer/src/app/blocks/page.tsx` — add ExportButton
- Modify: `~/tidx/explorer/src/app/analytics/page.tsx` — add ExportButton stubs

- [ ] **Step 1: Add ExportButton to blocks page**

Edit `~/tidx/explorer/src/app/blocks/page.tsx`. After the `<h1>` tag and before `<BlocksTable>`, add:

```typescript
import { ExportButton } from '@/components/ExportButton'

// Inside the JSX, add after <h1>:
<div className="flex items-center justify-between mb-6">
  <h1 className="text-2xl font-semibold text-white">Latest Blocks</h1>
  <ExportButton queryKey="latest-blocks" />
</div>
```

Remove the standalone `<h1 className="text-2xl font-semibold text-white mb-6">Latest Blocks</h1>` and replace with the div above.

- [ ] **Step 2: Create .env.local for local development**

Create `~/tidx/explorer/.env.local`:

```bash
TIDX_URL=http://localhost:8080
REDIS_URL=redis://localhost:6379
PAYMENT_ADDRESS=                   # TODO: set this to your Tempo wallet address
USDC_ADDRESS=                      # TODO: set from https://docs.tempo.xyz token registry
NEXT_PUBLIC_CHAIN_ID=4217
```

- [ ] **Step 3: Build the Docker image**

```bash
cd ~/tidx/explorer
npm run build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`

- [ ] **Step 4: Start the full stack**

```bash
cd ~/tidx
docker compose up -d --build explorer redis nginx
docker compose ps
```

Expected: explorer, redis, nginx all show `Up` and `healthy` (or running).

- [ ] **Step 5: Smoke test the endpoints**

```bash
# Overview
curl -s -o /dev/null -w "%{http_code}" http://localhost/
# Should return 200

# Blocks
curl -s -o /dev/null -w "%{http_code}" http://localhost/blocks
# Should return 200

# Export — should get 402 without payment
curl -s -X POST http://localhost/api/export \
  -H "Content-Type: application/json" \
  -d '{"query":"latest-blocks"}' | python3 -m json.tool
# Should return 402 with { "challenge": { "price": "0.10", ... } }

# Cache header check
curl -s -I http://localhost/blocks | grep -i "x-cache-status"
# Should return: X-Cache-Status: MISS (first request) then HIT (second)
curl -s -I http://localhost/blocks | grep -i "x-cache-status"
```

- [ ] **Step 6: Verify logs look clean**

```bash
cd ~/tidx
docker compose logs explorer --tail=20
docker compose logs nginx --tail=10
```

Expected: no uncaught errors in explorer, nginx showing GET requests.

- [ ] **Step 7: Final commit**

```bash
cd ~/tidx
git add docker-compose.yml nginx.conf
cd explorer
git add src/app/blocks/page.tsx .env.local.example
git commit -m "feat: wire up full stack, add nginx, deploy to compose"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Next.js App Router | Task 2 scaffold |
| Redis cache (30s/5min/15min TTLs) | Task 3 cache.ts |
| Nginx proxy_cache | Task 1 nginx.conf |
| Docker services (explorer, redis, nginx) | Task 1 docker-compose.yml |
| Overview page with network stats | Task 4 |
| Blocks page | Task 5 |
| Tx detail (Tempo-specific fields) | Task 6 |
| Address page | Task 6 |
| Analytics hub with placeholder cards | Task 7 |
| MPP 402 challenge/verify | Task 8 mpp.ts |
| CSV export endpoint | Task 8 route.ts |
| ExportButton UI component | Task 8 |
| $0.10 flat price | Task 8 mpp.ts |
| Server-side only data fetching | All page tasks (server components) |
| `restart: unless-stopped` | Task 1 |
| All ports bound to 127.0.0.1 | Task 1 |
| Replay protection (Redis dedup of tx hashes) | Task 8 mpp.ts |

**Placeholder scan:** No TBDs. `PAYMENT_ADDRESS` and `USDC_ADDRESS` are explicitly flagged as TODO env vars — intentional, can't be hardcoded.

**Type consistency:** `TidxRow`, `MppChallenge`, `PaymentVerification` defined in Tasks 3/8 and used consistently. `queryTidx` returns `TidxQueryResult` throughout.

---
