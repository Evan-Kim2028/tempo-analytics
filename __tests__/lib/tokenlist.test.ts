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

jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store[k] ?? null),
    set: jest.fn(async (k: string, v: string) => { store[k] = v }),
    del: jest.fn(async (k: string) => { delete store[k] }),
    setex: jest.fn(async (k: string, _ttl: number, v: string) => { store[k] = v }),
  }))
})

const MOCK_LIST = {
  name: 'Tempo Mainnet',
  tokens: [
    { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD', name: 'PathUSD', decimals: 6, chainId: 4217, extensions: { chain: 'tempo', label: 'PathUSD' } },
    { address: '0x20c000000000000000000000b9537d11c60e8b50', symbol: 'USDC.e', name: 'USD Coin (Bridged)', decimals: 6, chainId: 4217, extensions: { chain: 'tempo', label: 'USDC.e' } },
    { address: '0x20c0000000000000000000001621e21f71cf12fb', symbol: 'EURC.e', name: 'Euro Coin (Bridged)', decimals: 6, chainId: 4217, extensions: { chain: 'tempo', label: 'EURC' } },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_LIST,
  })
})

import { getVerifiedTokens, getTokenFromList, isVerifiedToken, getStablecoinAddresses } from '@/lib/tokenlist'

test('getVerifiedTokens returns parsed token list', async () => {
  const tokens = await getVerifiedTokens()
  expect(tokens).toHaveLength(3)
  expect(tokens[0].symbol).toBe('pathUSD')
  expect(tokens[0].address).toBe('0x20c0000000000000000000000000000000000000')
})

test('getVerifiedTokens normalises addresses to lowercase', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      tokens: [{ address: '0x20C0000000000000000000000000000000000000', symbol: 'pathUSD', name: 'PathUSD', decimals: 6, chainId: 4217, extensions: {} }],
    }),
  })
  const tokens = await getVerifiedTokens()
  expect(tokens[0].address).toBe('0x20c0000000000000000000000000000000000000')
})

test('getVerifiedTokens falls back to KNOWN_TOKENS on fetch failure', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
  const tokens = await getVerifiedTokens()
  expect(tokens.length).toBeGreaterThan(0)
  expect(tokens.some(t => t.symbol === 'pathUSD')).toBe(true)
})

test('getTokenFromList returns TokenInfo for known address', async () => {
  const info = await getTokenFromList('0x20c0000000000000000000000000000000000000')
  expect(info).toMatchObject({ symbol: 'pathUSD', decimals: 6 })
})

test('getTokenFromList is case-insensitive', async () => {
  const info = await getTokenFromList('0x20C0000000000000000000000000000000000000')
  expect(info?.symbol).toBe('pathUSD')
})

test('getTokenFromList returns null for unknown address', async () => {
  const info = await getTokenFromList('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  expect(info).toBeNull()
})

test('isVerifiedToken returns true for tokenlist address, false for unknown', async () => {
  expect(await isVerifiedToken('0x20c0000000000000000000000000000000000000')).toBe(true)
  expect(await isVerifiedToken('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(false)
})
