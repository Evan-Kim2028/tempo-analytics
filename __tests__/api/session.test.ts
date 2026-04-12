/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/payment-compose', () => ({
  calculateCredits: jest.fn((deposit: bigint) => {
    if (deposit >= BigInt(100000)) return 13
    if (deposit >= BigInt(50000)) return 6
    return Number(deposit / BigInt(10000))
  }),
  setSessionBalance: jest.fn(),
  getSessionBalance: jest.fn(() => 5),
  deductSessionCredit: jest.fn(() => true),
}))

async function getRoute() {
  const mod = await import('@/app/api/session/route')
  return mod.POST
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/session', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

test('open session returns session ID and credits', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ action: 'open', deposit: '100000' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.sessionId).toBeDefined()
  expect(body.credits).toBe(13)
})

test('open session rejects missing deposit', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ action: 'open' }))
  expect(res.status).toBe(400)
})

test('balance returns current credits', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ action: 'balance', sessionId: 'test-123' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.credits).toBe(5)
})

test('use deducts a credit', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ action: 'use', sessionId: 'test-123' }))
  expect(res.status).toBe(200)
})

test('close returns refunded credits', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ action: 'close', sessionId: 'test-123' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.closed).toBe(true)
  expect(body.refundedCredits).toBe(5)
})

test('unknown action returns 400', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ action: 'invalid' }))
  expect(res.status).toBe(400)
})
