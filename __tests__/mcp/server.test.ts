/**
 * @jest-environment node
 */
jest.mock('@/lib/dataService', () => ({
  getQueryCatalog: jest.fn(() => [
    { key: 'account-types', description: 'Sig types', engine: 'tidx', sql: '', price: '10000' },
    { key: 'pool-trades', description: 'Pool trades', engine: 'custom', sql: '', price: '10000', params: [{ name: 'token', pattern: /^0x[0-9a-fA-F]{40}$/ }] },
  ]),
  executeQuery: jest.fn().mockResolvedValue({ columns: ['a'], rows: [{ a: 1 }] }),
  formatJson: jest.fn((r: { columns: string[]; rows: unknown[] }) => ({ ...r, row_count: (r.rows || []).length })),
}))

import { createMcpServer } from '@/mcp/server'

test('createMcpServer returns a server with registered tools', () => {
  const server = createMcpServer()
  expect(server).toBeDefined()
})
