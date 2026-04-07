/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/mpp', () => ({
  createChallenge: jest.fn(() => ({
    price: '0.10', currency: 'USDC', recipient: '0xpayaddr', nonce: 'abc123', expires: 9999999999,
  })),
  verifyPayment: jest.fn(),
}))

jest.mock('@/lib/tidx', () => ({
  queryTidx: jest.fn(),
}))

import { createChallenge, verifyPayment } from '@/lib/mpp'
import { queryTidx } from '@/lib/tidx'

// Dynamic import to pick up mocks
async function getRoute() {
  const mod = await import('@/app/api/export/route')
  return mod.POST
}

function makeRequest(body: unknown, paymentHeader?: string) {
  return new NextRequest('http://localhost/api/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(paymentHeader ? { 'X-Payment': paymentHeader } : {}),
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('returns 402 with challenge when no X-Payment header', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(402)
  const body = await res.json()
  expect(body.challenge.price).toBe('0.10')
  expect(createChallenge).toHaveBeenCalled()
})

test('returns 402 when payment verification fails', async () => {
  ;(verifyPayment as jest.Mock).mockResolvedValue({ ok: false, error: 'Payment tx already used' })
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, '0x' + 'a'.repeat(64)))
  expect(res.status).toBe(402)
  const body = await res.json()
  expect(body.error).toMatch(/already used/)
})

test('returns 400 for unknown query key', async () => {
  ;(verifyPayment as jest.Mock).mockResolvedValue({ ok: true })
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'unknown-view' }, '0x' + 'a'.repeat(64)))
  expect(res.status).toBe(400)
})

test('returns CSV when payment valid and query known', async () => {
  ;(verifyPayment as jest.Mock).mockResolvedValue({ ok: true })
  ;(queryTidx as jest.Mock).mockResolvedValue({
    columns: ['sig_type', 'count'],
    rows: [{ sig_type: 0, count: 100 }, { sig_type: 2, count: 50 }],
    row_count: 2,
    engine: 'clickhouse',
    query_time_ms: 5,
  })
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, '0x' + 'a'.repeat(64)))
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
  const body = await res.text()
  expect(body).toContain('sig_type,count')
  expect(body).toContain('0,100')
})
