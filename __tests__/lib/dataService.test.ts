/**
 * @jest-environment node
 */
jest.mock('@/lib/tidx', () => ({
  queryTidx: jest.fn(),
}))
jest.mock('@/lib/clickhouse', () => ({
  queryClickHouse: jest.fn(),
}))

import { getQueryCatalog, getQuery, executeQuery, formatCsv, formatJson } from '@/lib/dataService'
import { queryTidx } from '@/lib/tidx'
import { queryClickHouse } from '@/lib/clickhouse'

test('getQueryCatalog returns all registered queries', () => {
  const catalog = getQueryCatalog()
  expect(catalog.length).toBeGreaterThanOrEqual(10)
  const keys = catalog.map(e => e.key)
  expect(keys).toContain('account-types')
  expect(keys).toContain('stablecoin-daily')
  expect(keys).toContain('pool-trades')
})

test('getQuery returns entry by key', () => {
  const entry = getQuery('account-types')
  expect(entry).toBeDefined()
  expect(entry!.engine).toBe('tidx')
  expect(entry!.price).toBe('10000')
})

test('getQuery returns undefined for unknown key', () => {
  expect(getQuery('nonexistent')).toBeUndefined()
})

test('executeQuery delegates tidx queries to queryTidx', async () => {
  ;(queryTidx as jest.Mock).mockResolvedValue({
    rows: [{ signature_type: 0, count: 100, pct: 75 }],
    row_count: 1,
    engine: 'pg',
    query_time_ms: 5,
  })
  const result = await executeQuery('account-types')
  expect(result.rows).toHaveLength(1)
  expect(result.columns).toContain('signature_type')
  expect(queryTidx).toHaveBeenCalled()
})

test('executeQuery delegates clickhouse queries to queryClickHouse', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValue([
    { day: '2026-04-01', token: 'USDC', volume_u6: 1000000, transfers: 50 },
  ])
  const result = await executeQuery('stablecoin-daily')
  expect(result.rows).toHaveLength(1)
  expect(result.columns).toContain('day')
  expect(queryClickHouse).toHaveBeenCalled()
})

test('executeQuery rejects missing required params', async () => {
  await expect(executeQuery('pool-trades')).rejects.toThrow('Missing required parameter: token')
})

test('executeQuery rejects invalid param format', async () => {
  await expect(executeQuery('pool-trades', { token: 'not-hex' })).rejects.toThrow('Invalid parameter token')
})

test('formatCsv produces valid CSV', () => {
  const result = { columns: ['a', 'b'], rows: [{ a: 1, b: 'hello' }, { a: 2, b: 'world' }] }
  expect(formatCsv(result)).toBe('a,b\n1,hello\n2,world')
})

test('formatCsv handles empty rows with columns', () => {
  expect(formatCsv({ columns: ['a'], rows: [] })).toBe('a\n')
})

test('formatCsv handles empty rows without columns', () => {
  expect(formatCsv({ columns: [], rows: [] })).toBe('')
})

test('formatJson includes row_count', () => {
  const result = { columns: ['a'], rows: [{ a: 1 }] }
  const json = formatJson(result)
  expect(json.row_count).toBe(1)
  expect(json.columns).toEqual(['a'])
})
