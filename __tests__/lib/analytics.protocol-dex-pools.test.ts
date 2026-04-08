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
import { getTokenInfo } from '@/lib/tokens'
import { getProtocolDexPools, getProtocolDexPoolTrades } from '@/lib/analytics'

const mockQuery = queryClickHouse as jest.Mock
const mockGetTokenInfo = getTokenInfo as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('getProtocolDexPools marks known tokens as whitelisted', async () => {
  mockQuery
    .mockResolvedValueOnce([
      { pool_id: '7', token: '0x20c000000000000000000000b9537d11c60e8b50', swaps: '100', volume_raw: '500000000' },
      { pool_id: '3', token: '0xdeadbeef00000000000000000000000000000001', swaps: '50', volume_raw: '200000000' },
    ])
    .mockResolvedValueOnce([]) // DAU query — empty is fine for this test
  mockGetTokenInfo
    .mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin', decimals: 6, address: '0x20c000000000000000000000b9537d11c60e8b50' })
    .mockResolvedValueOnce(null)

  const pools = await getProtocolDexPools(30)

  expect(pools).toHaveLength(2)
  expect(pools[0].whitelisted).toBe(true)
  expect(pools[0].symbol).toBe('USDC.e')
  expect(pools[0].volume_usd).toBeCloseTo(500)
  expect(pools[1].whitelisted).toBe(false)
  // volume_usd is always shown (volume_raw / 1e6) regardless of whitelisted status
  expect(pools[1].volume_usd).toBeCloseTo(200)
})

test('getProtocolDexPools avg_trade is volume_usd / swaps_30d', async () => {
  mockQuery
    .mockResolvedValueOnce([
      { pool_id: '7', token: '0x20c000000000000000000000b9537d11c60e8b50', swaps: '10', volume_raw: '100000000' },
    ])
    .mockResolvedValueOnce([]) // DAU query
  mockGetTokenInfo.mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin', decimals: 6, address: '0x...' })

  const [pool] = await getProtocolDexPools(30)
  expect(pool.avg_trade).toBeCloseTo(10) // 100 USD / 10 swaps
})

test('getProtocolDexPools symbol falls back to shortened address for unknown tokens', async () => {
  mockQuery
    .mockResolvedValueOnce([
      { pool_id: '1', token: '0xabcdef1234567890abcdef1234567890abcdef12', swaps: '5', volume_raw: '0' },
    ])
    .mockResolvedValueOnce([]) // DAU query
  mockGetTokenInfo.mockResolvedValueOnce(null)

  const [pool] = await getProtocolDexPools(30)
  expect(pool.symbol).toMatch(/^0x/)
  expect(pool.symbol).toContain('…')
})

test('getProtocolDexPoolTrades decodes taker, amount, and direction from log data', async () => {
  const paddedTaker = '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12'
  // uint256 = 32 bytes = 64 hex chars. Amount 10_000_000 = 0x989680, direction = 1
  const amountUint256    = '0000000000000000000000000000000000000000000000000000000000989680'
  const directionUint256 = '0000000000000000000000000000000000000000000000000000000000000001'
  const data = '0x' + amountUint256 + directionUint256

  mockQuery.mockResolvedValueOnce([
    { block_timestamp: '2026-04-08 12:00:00', topic2: paddedTaker, data },
  ])
  mockGetTokenInfo.mockResolvedValueOnce({ symbol: 'USDC.e', name: 'USD Coin', decimals: 6, address: '0x...' })

  const trades = await getProtocolDexPoolTrades('0x20c000000000000000000000b9537d11c60e8b50')

  expect(trades).toHaveLength(1)
  expect(trades[0].taker).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  expect(trades[0].amount_raw).toBe(10_000_000)
  expect(trades[0].amount_usd).toBeCloseTo(10)
  expect(trades[0].direction).toBe(1)
})

test('getProtocolDexPoolTrades sets amount_usd null for unknown tokens', async () => {
  const paddedTaker = '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12'
  const data = '0x' + '0'.repeat(128)

  mockQuery.mockResolvedValueOnce([
    { block_timestamp: '2026-04-08 12:00:00', topic2: paddedTaker, data },
  ])
  mockGetTokenInfo.mockResolvedValueOnce(null) // token unknown

  const trades = await getProtocolDexPoolTrades('0xdeadbeef00000000000000000000000000000001')
  expect(trades[0].amount_usd).toBeNull()
})
