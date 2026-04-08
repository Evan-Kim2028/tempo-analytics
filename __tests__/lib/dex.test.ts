// Mock tokenlist to return pathUSD and USDC.e as verified
jest.mock('@/lib/tokenlist', () => ({
  getStablecoinAddresses: jest.fn().mockResolvedValue([
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50',
  ]),
  isVerifiedToken: jest.fn().mockImplementation(async (addr: string) =>
    ['0x20c0000000000000000000000000000000000000',
     '0x20c000000000000000000000b9537d11c60e8b50'].includes(addr.toLowerCase())
  ),
}))

// Mock publicClient.readContract for token0/token1 calls
jest.mock('@/lib/chain', () => ({
  publicClient: {
    readContract: jest.fn().mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'token0') return '0x20c0000000000000000000000000000000000000'
      if (functionName === 'token1') return '0xabcdef1234567890abcdef1234567890abcdef12'
      return null
    }),
  },
}))

import { getDexPairInfo, computePairUsdVolume, isWhitelistedPair } from '@/lib/dex'

test('getDexPairInfo resolves token0 and token1 via RPC', async () => {
  const info = await getDexPairInfo('0xpair0000000000000000000000000000000000001')
  expect(info.token0).toBe('0x20c0000000000000000000000000000000000000')
  expect(info.token1).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
})

test('getDexPairInfo returns cached result on second call without RPC', async () => {
  const { publicClient } = require('@/lib/chain')
  publicClient.readContract.mockClear()
  await getDexPairInfo('0xpair0000000000000000000000000000000000001')
  await getDexPairInfo('0xpair0000000000000000000000000000000000001')
  // Second call uses cache — readContract called at most twice (token0 + token1) total, not 4 times
  expect(publicClient.readContract.mock.calls.length).toBeLessThanOrEqual(2)
})

test('computePairUsdVolume: token0 is stablecoin → uses amount0 side', async () => {
  // token0 = pathUSD (stablecoin), token1 = some token
  const vol = await computePairUsdVolume({
    token0: '0x20c0000000000000000000000000000000000000',
    token1: '0xabcdef1234567890abcdef1234567890abcdef12',
    amount0In: 500_000_000n,   // $500 in (6 decimals)
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 1_000_000n,
  })
  expect(vol).toBeCloseTo(500.0, 1)  // $500 USD
})

test('computePairUsdVolume: token1 is stablecoin → uses amount1 side', async () => {
  // token0 = some token, token1 = USDC.e (stablecoin)
  const vol = await computePairUsdVolume({
    token0: '0xabcdef1234567890abcdef1234567890abcdef12',
    token1: '0x20c000000000000000000000b9537d11c60e8b50',
    amount0In: 1_000_000n,
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 250_000_000n,  // $250 out (6 decimals)
  })
  expect(vol).toBeCloseTo(250.0, 1)  // $250 USD
})

test('computePairUsdVolume: no stablecoin in pair → returns null', async () => {
  const { isVerifiedToken } = require('@/lib/tokenlist')
  isVerifiedToken.mockResolvedValue(false)
  const vol = await computePairUsdVolume({
    token0: '0xaaaa000000000000000000000000000000000001',
    token1: '0xbbbb000000000000000000000000000000000002',
    amount0In: 1000n, amount1In: 0n, amount0Out: 0n, amount1Out: 1000n,
  })
  expect(vol).toBeNull()
})

test('isWhitelistedPair returns true when token0 is verified', async () => {
  const { isVerifiedToken } = require('@/lib/tokenlist')
  // Reset to default mock implementation
  isVerifiedToken.mockImplementation(async (addr: string) =>
    ['0x20c0000000000000000000000000000000000000',
     '0x20c000000000000000000000b9537d11c60e8b50'].includes(addr.toLowerCase())
  )
  expect(await isWhitelistedPair(
    '0x20c0000000000000000000000000000000000000',
    '0xabcdef1234567890abcdef1234567890abcdef12'
  )).toBe(true)
})

test('isWhitelistedPair returns false when neither token is verified', async () => {
  const { isVerifiedToken } = require('@/lib/tokenlist')
  isVerifiedToken.mockResolvedValue(false)
  expect(await isWhitelistedPair(
    '0xaaaa000000000000000000000000000000000001',
    '0xbbbb000000000000000000000000000000000002'
  )).toBe(false)
})
