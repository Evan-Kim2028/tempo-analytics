/**
 * @jest-environment node
 */
jest.mock('@/lib/dataService', () => ({
  getQuery: jest.fn((key: string) => key === 'account-types' ? { key, engine: 'tidx', price: '10000' } : undefined),
  executeQuery: jest.fn().mockResolvedValue({ columns: ['a'], rows: [{ a: 1 }] }),
  formatJson: jest.fn((r: { columns: string[]; rows: unknown[] }) => ({ ...r, row_count: (r.rows || []).length })),
}))

import { NextRequest } from 'next/server'

async function getRoute() {
  const mod = await import('@/app/api/v1/query/route')
  return mod.POST
}

test('returns JSON for valid query', async () => {
  const POST = await getRoute()
  const res = await POST(new NextRequest('http://localhost/api/v1/query', {
    method: 'POST',
    body: JSON.stringify({ query: 'account-types' }),
    headers: { 'Content-Type': 'application/json' },
  }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.row_count).toBe(1)
})

test('returns 400 for unknown query', async () => {
  const POST = await getRoute()
  const res = await POST(new NextRequest('http://localhost/api/v1/query', {
    method: 'POST',
    body: JSON.stringify({ query: 'nonexistent' }),
    headers: { 'Content-Type': 'application/json' },
  }))
  expect(res.status).toBe(400)
})
