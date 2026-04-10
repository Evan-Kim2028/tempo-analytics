/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/mpp', () => ({
  chargeHandler: jest.fn(),
}))

jest.mock('@/lib/tidx', () => ({
  queryTidx: jest.fn(),
}))

import { chargeHandler } from '@/lib/mpp'
import { queryTidx } from '@/lib/tidx'

// Dynamic import to pick up mocks
async function getRoute() {
  const mod = await import('@/app/api/export/route')
  return mod.POST
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('returns 400 for unknown query key', async () => {
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'unknown-view' }))
  expect(res.status).toBe(400)
})

test('returns 402 when chargeHandler returns 402', async () => {
  ;(chargeHandler as jest.Mock).mockReturnValue(
    jest.fn().mockResolvedValue(
      new Response(null, { status: 402, headers: { 'WWW-Authenticate': 'Payment method="tempo/charge"' } })
    )
  )
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(402)
  expect(res.headers.get('WWW-Authenticate')).not.toBeNull()
})

test('returns CSV when chargeHandler calls respond', async () => {
  ;(chargeHandler as jest.Mock).mockImplementation(
    (respond: () => Promise<Response>) =>
      jest.fn().mockImplementation(async () => respond())
  )
  ;(queryTidx as jest.Mock).mockResolvedValue({
    columns: ['sig_type', 'count'],
    rows: [{ sig_type: 0, count: 100 }, { sig_type: 2, count: 50 }],
    row_count: 2,
    engine: 'clickhouse',
    query_time_ms: 5,
  })
  const POST = await getRoute()
  const res = await POST(makeRequest({ query: 'account-types' }))
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
  const body = await res.text()
  expect(body).toContain('sig_type,count')
  expect(body).toContain('0,100')
})

test('passes request to chargeHandler handler', async () => {
  const mockHandler = jest.fn().mockResolvedValue(new Response(null, { status: 402 }))
  ;(chargeHandler as jest.Mock).mockReturnValue(mockHandler)
  const POST = await getRoute()
  const req = makeRequest({ query: 'fee-tokens' })
  await POST(req)
  expect(mockHandler).toHaveBeenCalledWith(req)
})
