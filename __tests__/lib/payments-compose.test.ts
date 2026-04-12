/**
 * @jest-environment node
 */
process.env.TEMPO_RECIPIENT_ADDRESS = process.env.TEMPO_RECIPIENT_ADDRESS ?? '0xc8BDAEDEcB05001B5EC22D273393792274f59281'

const mockCompose = jest.fn()

jest.mock('mppx/server', () => ({
  Mppx: {
    create: jest.fn(() => ({
      tempo: { charge: jest.fn() },
      solana: { charge: jest.fn() },
      compose: jest.fn((..._entries: unknown[]) => mockCompose),
    })),
  },
  tempo: { charge: jest.fn(() => ({})) },
}))

jest.mock('@solana/mpp/server', () => ({
  solana: { charge: jest.fn(() => ({})) },
}))

import { getPaymentInstance, composePayment, calculateCredits, getSessionBalance, setSessionBalance, deductSessionCredit } from '@/lib/payment-compose'

beforeEach(() => {
  jest.clearAllMocks()
})

test('getPaymentInstance returns mppx singleton', () => {
  const a = getPaymentInstance()
  const b = getPaymentInstance()
  expect(a).toBe(b)
  expect(a.tempo).toBeDefined()
})

test('composePayment returns 402 challenge when not paid', async () => {
  const challenge = new Response(null, { status: 402 })
  mockCompose.mockResolvedValue({ status: 402, challenge })
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const result = await composePayment(req, '10000')
  expect(result.status).toBe(402)
  expect(result.challenge).toBe(challenge)
})

test('composePayment returns 200 when paid', async () => {
  const withReceipt = jest.fn((r: Response) => r)
  mockCompose.mockResolvedValue({ status: 200, withReceipt })
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const result = await composePayment(req, '10000')
  expect(result.status).toBe(200)
  expect(result.alreadyConsumed).toBe(false)
})

test('composePayment handles already-consumed credentials', async () => {
  mockCompose.mockRejectedValue(new Error('Transaction signature already consumed'))
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const result = await composePayment(req, '10000')
  expect(result.status).toBe(200)
  expect(result.alreadyConsumed).toBe(true)
})

test('composePayment handles already-used tempo hash', async () => {
  mockCompose.mockRejectedValue(new Error('Transaction hash has already been used'))
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const result = await composePayment(req, '10000')
  expect(result.status).toBe(200)
  expect(result.alreadyConsumed).toBe(true)
})

test('composePayment rethrows non-consumed errors', async () => {
  mockCompose.mockRejectedValue(new Error('RPC connection failed'))
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  await expect(composePayment(req, '10000')).rejects.toThrow('RPC connection failed')
})

test('calculateCredits applies tier discounts', () => {
  expect(calculateCredits(BigInt(10000))).toBe(1)
  expect(calculateCredits(BigInt(50000))).toBe(6)
  expect(calculateCredits(BigInt(100000))).toBe(13)
  expect(calculateCredits(BigInt(200000))).toBe(26)
})

test('calculateCredits returns 0 for zero deposit', () => {
  expect(calculateCredits(BigInt(0))).toBe(0)
})

test('session balance operations', () => {
  setSessionBalance('test-1', 5)
  expect(getSessionBalance('test-1')).toBe(5)
  expect(deductSessionCredit('test-1')).toBe(true)
  expect(getSessionBalance('test-1')).toBe(4)
  expect(deductSessionCredit('nonexistent')).toBe(false)
})

test('session balance auto-deletes at zero', () => {
  setSessionBalance('test-2', 1)
  expect(deductSessionCredit('test-2')).toBe(true)
  expect(getSessionBalance('test-2')).toBe(0)
})
