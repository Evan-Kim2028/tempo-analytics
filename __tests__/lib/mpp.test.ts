/**
 * @jest-environment node
 */

// tempo is a function with a .charge static method on the namespace.
// Mppx is a namespace with a .create factory.
const mockCompose = jest.fn(() =>
  jest.fn().mockResolvedValue({
    status: 402 as const,
    challenge: new Response(null, {
      status: 402,
      headers: { 'WWW-Authenticate': 'Payment method="tempo/charge"' },
    }),
  })
)

jest.mock('mppx/server', () => ({
  tempo: Object.assign(jest.fn(), {
    charge: jest.fn((_opts: unknown) => ({ _tag: 'TempoChargeMethod' as const })),
  }),
  Mppx: {
    create: jest.fn(() => ({
      compose: mockCompose,
    })),
  },
}))

jest.mock('@/lib/chain', () => ({ publicClient: {} }))

import { chargeHandler } from '@/lib/mpp'

beforeEach(() => {
  jest.clearAllMocks()
  process.env.USDC_ADDRESS     = '0x0000000000000000000000000000000000000001'
  process.env.PATH_USD_ADDRESS = '0x0000000000000000000000000000000000000002'
  process.env.PAYMENT_ADDRESS  = '0x0000000000000000000000000000000000000003'
})

test('chargeHandler returns a callable handler', () => {
  const handler = chargeHandler(jest.fn())
  expect(typeof handler).toBe('function')
})

test('chargeHandler handler returns 402 when called with no Authorization', async () => {
  const handler = chargeHandler(jest.fn())
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  const res = await handler(req)
  expect(res.status).toBe(402)
  expect(res.headers.get('WWW-Authenticate')).not.toBeNull()
})

test('chargeHandler creates a new handler on each call (not cached)', () => {
  const respond = jest.fn()
  const h1 = chargeHandler(respond)
  const h2 = chargeHandler(respond)
  expect(h1).not.toBe(h2)
})

test('chargeHandler handler calls respond and returns withReceipt on 200', async () => {
  const csvResponse = new Response('col\nval', { status: 200 })
  const respond = jest.fn().mockResolvedValue(csvResponse)
  const withReceipt = jest.fn((r: Response) => r)
  ;(mockCompose as jest.Mock).mockReturnValueOnce(
    jest.fn().mockResolvedValue({ status: 200 as const, withReceipt })
  )
  const handler = chargeHandler(respond)
  const req = new Request('http://localhost/api/export', { method: 'POST' })
  await handler(req)
  expect(respond).toHaveBeenCalled()
  expect(withReceipt).toHaveBeenCalledWith(csvResponse)
})
