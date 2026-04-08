// Mock viem to avoid TextEncoder issues in jest (same pattern as tokens.test.ts)
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({ readContract: jest.fn() })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))

// Mock chain to avoid viem pulling in TextEncoder
jest.mock('@/lib/chain', () => ({
  publicClient: { readContract: jest.fn() },
  tempoChain: {},
}))

// Mock ClickHouse to avoid real network calls
jest.mock('@/lib/clickhouse', () => ({
  queryClickHouse: jest.fn(),
}))

// Mock cache so every call hits ClickHouse (no stale results across tests)
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
}))

import { getStablecoinSupplyHistory } from '@/lib/analytics'

const PATHUSD = '0x20c0000000000000000000000000000000000000'
const USDC_E  = '0x20c000000000000000000000b9537d11c60e8b50'

function mockRows(rows: Array<{ day: string; token: string; net_raw: string }>) {
  const { queryClickHouse } = require('@/lib/clickhouse')
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce(rows)
}

beforeEach(() => {
  jest.clearAllMocks()
  const { getCached } = require('@/lib/cache')
  ;(getCached as jest.Mock).mockResolvedValue(null)
})

test('returns empty array when no rows returned', async () => {
  mockRows([])
  const result = await getStablecoinSupplyHistory(30)
  expect(result).toEqual([])
})

test('computes cumulative sum correctly for a single token', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(2e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(3e6) },
    { day: '2026-01-03', token: PATHUSD, net_raw: String(-1e6) },
  ])
  const result = await getStablecoinSupplyHistory(30)

  expect(result).toHaveLength(3)
  expect(result[0]).toMatchObject({ day: '2026-01-01', pathUSD: 2, usdc_e: 0 })
  expect(result[1]).toMatchObject({ day: '2026-01-02', pathUSD: 5, usdc_e: 0 })
  expect(result[2]).toMatchObject({ day: '2026-01-03', pathUSD: 4, usdc_e: 0 })
})

test('computes cumulative sum independently for both tokens', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(10e6) },
    { day: '2026-01-01', token: USDC_E,  net_raw: String(5e6)  },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(2e6)  },
    { day: '2026-01-02', token: USDC_E,  net_raw: String(-1e6) },
  ])
  const result = await getStablecoinSupplyHistory(30)

  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ day: '2026-01-01', pathUSD: 10, usdc_e: 5 })
  expect(result[1]).toMatchObject({ day: '2026-01-02', pathUSD: 12, usdc_e: 4 })
})

test('divides raw values by 1e6', async () => {
  const oneToken = 1_000_000n  // 1e6 (6-decimal stablecoin unit)
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(oneToken) },
  ])
  const result = await getStablecoinSupplyHistory(30)
  expect(result[0].pathUSD).toBeCloseTo(1.0, 10)
})

test('returns only last `days` rows when history is longer', async () => {
  // Provide 5 days of data, request only 3
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-03', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-04', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-05', token: PATHUSD, net_raw: String(1e6) },
  ])
  const result = await getStablecoinSupplyHistory(3)

  expect(result).toHaveLength(3)
  expect(result[0].day).toBe('2026-01-03')
  expect(result[2].day).toBe('2026-01-05')
  // cumsum at day 3 = 3, day 4 = 4, day 5 = 5
  expect(result[0].pathUSD).toBeCloseTo(3, 10)
  expect(result[2].pathUSD).toBeCloseTo(5, 10)
})

test('output is sorted by day ascending', async () => {
  // Rows arrive out of order (shouldn't happen in practice but guard against it)
  mockRows([
    { day: '2026-01-03', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(1e6) },
  ])
  const result = await getStablecoinSupplyHistory(30)
  const days = result.map(r => r.day)
  expect(days).toEqual([...days].sort())
})

test('uses correct cache key and sets TTL of 900s', async () => {
  mockRows([])
  await getStablecoinSupplyHistory(7)
  const { setCached } = require('@/lib/cache')
  expect(setCached).toHaveBeenCalledWith('analytics:stablecoin_supply:7', [], 900)
})

test('returns cached result without hitting ClickHouse', async () => {
  const { getCached } = require('@/lib/cache')
  const { queryClickHouse } = require('@/lib/clickhouse')
  const cached = [{ day: '2026-01-01', pathUSD: 99, usdc_e: 0 }]
  ;(getCached as jest.Mock).mockResolvedValueOnce(cached)

  const result = await getStablecoinSupplyHistory(30)
  expect(result).toBe(cached)
  expect(queryClickHouse).not.toHaveBeenCalled()
})

test('days with no data for a token fill in as zero delta (cumsum unchanged)', async () => {
  // USDC.e only appears on day 1, day 2 has no row for it
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1e6)  },
    { day: '2026-01-01', token: USDC_E,  net_raw: String(10e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(2e6)  },
    // No USDC.e row on day 2 — supply should stay at 10
  ])
  const result = await getStablecoinSupplyHistory(30)

  expect(result[1]).toMatchObject({ day: '2026-01-02', pathUSD: 3, usdc_e: 10 })
})
