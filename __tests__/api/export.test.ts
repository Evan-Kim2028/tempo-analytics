/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// Mock mppx/server before importing the route
const mockCompose = jest.fn()
const mockTempoCharge = jest.fn()
const mockSolanaCharge = jest.fn()

jest.mock('mppx/server', () => ({
  Mppx: {
    create: jest.fn(() => ({
      tempo: { charge: mockTempoCharge },
      solana: { charge: mockSolanaCharge },
      compose: jest.fn((..._entries: unknown[]) => mockCompose),
    })),
  },
  tempo: {
    charge: jest.fn(() => ({})),
  },
}))

jest.mock('mppx-solana', () => ({
  server: jest.fn(() => ({})),
}), { virtual: true })

jest.mock('@/lib/tidx', () => ({
  queryTidx: jest.fn(),
}))

import { queryTidx } from '@/lib/tidx'

// Dynamic import so mocks are in place first
async function getRoute() {
  const mod = await import('@/app/api/export/route')
  return mod.POST
}

function makeRequest(body: unknown, authHeader?: string) {
  return new NextRequest('http://localhost/api/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  })
}

const mock402 = new Response(null, {
  status: 402,
  headers: { 'WWW-Authenticate': 'Payment id="abc", realm="localhost", method="tempo", intent="charge", request="eyJ0ZXN0IjoidHJ1ZSJ9"' },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockCompose.mockResolvedValue({ status: 402, challenge: mock402 })
})

test('returns 400 for unknown query key', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'unknown-view' }))
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.error).toMatch(/Unknown export query/)
})

test('returns 400 when query key is missing', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({}))
  expect(res.status).toBe(400)
})

test('returns 402 challenge when no Authorization header', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(402)
  expect(res.headers.get('WWW-Authenticate')).toMatch(/Payment/)
})

test('returns CSV when compose accepts payment', async () => {
  const withReceipt = jest.fn((r: Response) => r)
  mockCompose.mockResolvedValue({ status: 200, withReceipt })
  ;(queryTidx as jest.Mock).mockResolvedValue({
    columns: ['signature_type', 'count', 'pct'],
    rows: [{ signature_type: 0, count: 100, pct: 75 }],
  })

  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }, 'Payment eyJ...'))
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
  const text = await res.text()
  expect(text).toContain('signature_type,count,pct')
  expect(text).toContain('0,100,75')
  expect(withReceipt).toHaveBeenCalled()
})

test('compose is called with tempo and solana entries', async () => {
  const POST = await getRoute()
  await POST(makeRequest({ query: 'account-types' }))
  expect(mockCompose).toHaveBeenCalled()
})
