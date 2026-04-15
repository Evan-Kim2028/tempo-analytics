// Mock viem to avoid TextEncoder issues in jest (same pattern as tokens.test.ts)
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({ readContract: jest.fn() })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))

jest.mock('@/lib/chain', () => ({
  publicClient: { readContract: jest.fn() },
  tempoChain: {},
}))

jest.mock('@/lib/clickhouse', () => ({
  queryClickHouse: jest.fn(),
}))

jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/tokenlist', () => ({
  getStablecoinAddresses: jest.fn().mockResolvedValue([
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50',
  ]),
  getTokenFromList: jest.fn().mockResolvedValue(null),
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

test('returns empty pivot when no rows returned', async () => {
  mockRows([])
  const result = await getStablecoinSupplyHistory(30)
  expect(result.days).toEqual([])
  expect(result.tokens).toEqual([])
})

test('computes cumulative sum correctly for a single token', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(2e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(3e6) },
    { day: '2026-01-03', token: PATHUSD, net_raw: String(-1e6) },
  ])
  const result = await getStablecoinSupplyHistory(30)

  expect(result.days).toHaveLength(3)
  expect(result.days[0]).toMatchObject({ day: '2026-01-01', [PATHUSD]: 2 })
  expect(result.days[1]).toMatchObject({ day: '2026-01-02', [PATHUSD]: 5 })
  expect(result.days[2]).toMatchObject({ day: '2026-01-03', [PATHUSD]: 4 })
})

test('computes cumulative sum independently for both tokens', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(10e6) },
    { day: '2026-01-01', token: USDC_E,  net_raw: String(5e6)  },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(2e6)  },
    { day: '2026-01-02', token: USDC_E,  net_raw: String(-1e6) },
  ])
  const result = await getStablecoinSupplyHistory(30)

  expect(result.days).toHaveLength(2)
  expect(result.days[0]).toMatchObject({ day: '2026-01-01', [PATHUSD]: 10, [USDC_E]: 5 })
  expect(result.days[1]).toMatchObject({ day: '2026-01-02', [PATHUSD]: 12, [USDC_E]: 4 })
})

test('divides raw values by 1e6', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1_000_000n) },
  ])
  const result = await getStablecoinSupplyHistory(30)
  expect(Number(result.days[0][PATHUSD])).toBeCloseTo(1.0, 10)
})

test('returns only last `days` rows when history is longer', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-03', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-04', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-05', token: PATHUSD, net_raw: String(1e6) },
  ])
  const result = await getStablecoinSupplyHistory(3)

  expect(result.days).toHaveLength(3)
  expect(result.days[0].day).toBe('2026-01-03')
  expect(result.days[2].day).toBe('2026-01-05')
  expect(Number(result.days[0][PATHUSD])).toBeCloseTo(3, 10)
  expect(Number(result.days[2][PATHUSD])).toBeCloseTo(5, 10)
})

test('output is sorted by day ascending', async () => {
  mockRows([
    { day: '2026-01-03', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(1e6) },
  ])
  const result = await getStablecoinSupplyHistory(30)
  const days = result.days.map(r => r.day as string)
  expect(days).toEqual([...days].sort())
})

test('returns cached result without hitting ClickHouse', async () => {
  const { getCached } = require('@/lib/cache')
  const { queryClickHouse } = require('@/lib/clickhouse')
  const cached = { days: [{ day: '2026-01-01', [PATHUSD]: 99 }], tokens: [] }
  ;(getCached as jest.Mock).mockResolvedValueOnce(cached)

  const result = await getStablecoinSupplyHistory(30)
  expect(result).toBe(cached)
  expect(queryClickHouse).not.toHaveBeenCalled()
})

test('days with no data for a token fill in (cumsum unchanged)', async () => {
  mockRows([
    { day: '2026-01-01', token: PATHUSD, net_raw: String(1e6)  },
    { day: '2026-01-01', token: USDC_E,  net_raw: String(10e6) },
    { day: '2026-01-02', token: PATHUSD, net_raw: String(2e6)  },
  ])
  const result = await getStablecoinSupplyHistory(30)
  expect(result.days[1]).toMatchObject({ day: '2026-01-02', [PATHUSD]: 3, [USDC_E]: 10 })
})
