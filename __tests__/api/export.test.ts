/**
 * @jest-environment node
 */
// __tests__/api/export.test.ts
import { NextRequest } from 'next/server'

const mockComposePayment = jest.fn()

jest.mock('@/lib/payment-compose', () => ({
  composePayment: (...args: unknown[]) => mockComposePayment(...args),
}))

jest.mock('@/lib/dataService', () => {
  const actual = jest.requireActual('@/lib/dataService')
  return {
    ...actual,
    executeQuery: jest.fn(),
  }
})

import { executeQuery } from '@/lib/dataService'

async function getRoute() {
  const mod = await import('@/app/api/export/route')
  return mod.POST
}

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  const challenge = new Response(null, { status: 402, headers: { 'WWW-Authenticate': 'Payment id="abc"' } })
  mockComposePayment.mockResolvedValue({ status: 402, challenge, wrapResponse: (r: Response) => r })
})

test('returns 400 for unknown query key', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'unknown' }))
  expect(res.status).toBe(400)
})

test('returns 400 when query key is missing', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({}))
  expect(res.status).toBe(400)
})

test('returns 402 when not paid', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(402)
})

test('returns CSV when payment accepted', async () => {
  const wrapResponse = jest.fn((r: Response) => r)
  mockComposePayment.mockResolvedValue({ status: 200, alreadyConsumed: false, wrapResponse })
  ;(executeQuery as jest.Mock).mockResolvedValue({
    columns: ['signature_type', 'count'],
    rows: [{ signature_type: 0, count: 100 }],
  })

  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, { Authorization: 'Payment eyJ...' }))
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
  const text = await res.text()
  expect(text).toContain('signature_type,count')
  expect(wrapResponse).toHaveBeenCalled()
})

test('returns 502 on compose error', async () => {
  mockComposePayment.mockRejectedValue(new Error('RPC failed'))
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(502)
})

test('returns CSV via session header (bypasses payment)', async () => {
  ;(executeQuery as jest.Mock).mockResolvedValue({
    columns: ['a', 'b'],
    rows: [{ a: 1, b: 2 }],
  })

  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, { 'X-Session-Id': 'sess-123' }))
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).toContain('a,b')
  // composePayment should NOT have been called
  expect(mockComposePayment).not.toHaveBeenCalled()
})

test('returns 503 when session query fails', async () => {
  ;(executeQuery as jest.Mock).mockRejectedValue(new Error('DB down'))

  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, { 'X-Session-Id': 'sess-123' }))
  expect(res.status).toBe(503)
})
