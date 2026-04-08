jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/tokens', () => ({
  getTokenInfo: jest.fn(),
  getTokenSupply: jest.fn(),
  KNOWN_TOKENS: {},
  EXCLUDED_TOKENS: new Set(),
  STABLECOIN_ADDRESSES: [],
}))
jest.mock('@/lib/tokenlist', () => ({
  getStablecoinAddresses: jest.fn().mockResolvedValue([]),
  getTokenFromList: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/dex', () => ({
  getDexPairInfo: jest.fn(),
  computePairUsdVolume: jest.fn(),
  isWhitelistedPair: jest.fn(),
}))
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({ readContract: jest.fn() })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))
jest.mock('@/lib/chain', () => ({
  publicClient: { readContract: jest.fn() },
  tempoChain: {},
}))

import { queryClickHouse } from '@/lib/clickhouse'
import { getProtocolDexDailyStats } from '@/lib/analytics'

const mockQuery = queryClickHouse as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('getProtocolDexDailyStats queries mv_protocol_dex_volume_totals_daily', async () => {
  mockQuery.mockResolvedValueOnce([
    { day: '2026-04-01', swaps: '100', volume_raw: '5000000000' },
  ])

  await getProtocolDexDailyStats(30)

  const sql: string = mockQuery.mock.calls[0][0]
  expect(sql).toContain('mv_protocol_dex_volume_totals_daily')
  expect(sql).not.toContain('mv_protocol_dex_daily\n')
})

test('getProtocolDexDailyStats maps volume_raw to volume_usd dividing by 1e6', async () => {
  mockQuery.mockResolvedValueOnce([
    { day: '2026-04-01', swaps: '100', volume_raw: '5000000000' },
  ])

  const [stat] = await getProtocolDexDailyStats(30)
  expect(stat.volume_usd).toBeCloseTo(5000)
  expect(stat.swaps).toBe(100)
  expect(stat.day).toBe('2026-04-01')
})
