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
  parseUnits: jest.fn((_val: string, _decimals: number) => BigInt(100000)),
  defineChain: jest.fn((config: unknown) => config),
}))

import { getCached, setCached } from '@/lib/cache'

test('createChallenge returns required fields', () => {
  process.env.PAYMENT_ADDRESS = '0x1234567890123456789012345678901234567890'
  const challenge = createChallenge()
  expect(challenge.price).toBe('0.10')
  expect(challenge.currency).toBe('USDC')
  expect(challenge.recipient).toBe(process.env.PAYMENT_ADDRESS)
  expect(challenge.nonce).toHaveLength(32)
  expect(typeof challenge.expires).toBe('number')
  expect(challenge.expires).toBeGreaterThan(Date.now() / 1000)
})

test('verifyPayment rejects already-used tx hash', async () => {
  ;(getCached as jest.Mock).mockResolvedValue('used')
  const result = await verifyPayment('0x' + 'a'.repeat(64))
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/already used/)
})

test('verifyPayment returns error when PAYMENT_ADDRESS not configured', async () => {
  ;(getCached as jest.Mock).mockResolvedValue(null)
  const savedAddr = process.env.PAYMENT_ADDRESS
  delete process.env.PAYMENT_ADDRESS
  const result = await verifyPayment('0x' + 'b'.repeat(64))
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/not configured/)
  process.env.PAYMENT_ADDRESS = savedAddr
})
