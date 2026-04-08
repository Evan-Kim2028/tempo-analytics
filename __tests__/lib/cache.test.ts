import { getCached, setCached, deleteCached } from '@/lib/cache'

jest.mock('ioredis', () => {
  const store: Record<string, string> = {}
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (key: string) => store[key] ?? null),
    set: jest.fn(async (key: string, value: string, ..._args: unknown[]) => { store[key] = value }),
    del: jest.fn(async (key: string) => { delete store[key] }),
  }))
})

test('getCached returns null on miss', async () => {
  const result = await getCached('missing-key')
  expect(result).toBeNull()
})

test('setCached and getCached round-trips JSON', async () => {
  const data = { num: 42, hash: '0xabc' }
  await setCached('test-key', data, 60)
  const result = await getCached<typeof data>('test-key')
  expect(result).toEqual(data)
})

test('deleteCached removes a key', async () => {
  await setCached('del-key', { x: 1 }, 60)
  await deleteCached('del-key')
  const result = await getCached('del-key')
  expect(result).toBeNull()
})
