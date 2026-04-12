jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/tokens', () => ({
  getTokenInfo: jest.fn(),
  getTokenSupply: jest.fn(),
  KNOWN_TOKENS: {},
  EXCLUDED_TOKENS: new Set(),
  STABLECOIN_ADDRESSES: [],
}))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
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
import { getNFTMinterConcentration, getTopNFTMinters } from '@/lib/analytics'

const mockQuery = queryClickHouse as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('getNFTMinterConcentration computes top10 share percentage', async () => {
  mockQuery
    .mockResolvedValueOnce([{ total_mints: '100', unique_minters: '25' }])
    .mockResolvedValueOnce([
      { mints: '30' }, { mints: '15' }, { mints: '10' }, { mints: '8' }, { mints: '5' },
      { mints: '4' }, { mints: '3' }, { mints: '2' }, { mints: '2' }, { mints: '1' },
    ])

  const result = await getNFTMinterConcentration()

  expect(result.total_mints).toBe(100)
  expect(result.unique_minters).toBe(25)
  expect(result.top10_share_pct).toBe(80) // (30+15+10+8+5+4+3+2+2+1)/100 = 80%
})

test('getNFTMinterConcentration handles zero mints gracefully', async () => {
  mockQuery
    .mockResolvedValueOnce([{ total_mints: '0', unique_minters: '0' }])
    .mockResolvedValueOnce([])

  const result = await getNFTMinterConcentration()
  expect(result.top10_share_pct).toBe(0)
})

test('getTopNFTMinters returns ranked list with correct fields', async () => {
  mockQuery
    .mockResolvedValueOnce([
      { minter: '0xabc0000000000000000000000000000000000001', mints: '50', collections: '3' },
      { minter: '0xabc0000000000000000000000000000000000002', mints: '20', collections: '1' },
    ])
    .mockResolvedValueOnce([{ total: '145' }])

  const minters = await getTopNFTMinters(10)

  expect(minters).toHaveLength(2)
  expect(minters[0].rank).toBe(1)
  expect(minters[0].minter).toBe('0xabc0000000000000000000000000000000000001')
  expect(minters[0].mints).toBe(50)
  expect(minters[0].pct_total).toBeCloseTo(34.5, 0)
  expect(minters[0].collections).toBe(3)
  expect(minters[1].rank).toBe(2)
})
