import { getTokenInfo, formatTokenAmount, KNOWN_TOKENS, EXCLUDED_TOKENS } from '@/lib/tokens'

// Mock viem to avoid TextEncoder issues in jest
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    readContract: jest.fn(),
  })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))

// Mock publicClient from chain.ts
jest.mock('@/lib/chain', () => ({
  publicClient: {
    readContract: jest.fn(),
  },
  tempoChain: {},
}))

test('getTokenInfo returns static entry for pathUSD', async () => {
  const info = await getTokenInfo('0x20c0000000000000000000000000000000000000')
  expect(info).toMatchObject({ symbol: 'pathUSD', decimals: 6 })
})

test('getTokenInfo returns static entry for USDC.e', async () => {
  const info = await getTokenInfo('0x20c000000000000000000000b9537d11c60e8b50')
  expect(info).toMatchObject({ symbol: 'USDC.e', decimals: 6 })
})

test('getTokenInfo is case-insensitive', async () => {
  const info = await getTokenInfo('0x20C0000000000000000000000000000000000000')
  expect(info?.symbol).toBe('pathUSD')
})

test('EXCLUDED_TOKENS contains DONOTUSE address', () => {
  expect(EXCLUDED_TOKENS.has('0x20c00000000000000000000016c6514b53947fdc')).toBe(true)
})

test('formatTokenAmount with 6 decimals', () => {
  expect(formatTokenAmount(BigInt(1_000_000), 6)).toBe('1.00')
  expect(formatTokenAmount(BigInt(1_234_567), 6)).toBe('1.23')
  expect(formatTokenAmount(BigInt(500_000), 6)).toBe('0.50')
})

test('formatTokenAmount with 18 decimals', () => {
  expect(formatTokenAmount(BigInt('1000000000000000000'), 18)).toBe('1.00')
})

test('formatTokenAmount for large amounts uses compact notation', () => {
  expect(formatTokenAmount(BigInt(1_234_567_890_000), 6)).toBe('1.23M')
})
