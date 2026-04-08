import { getCached, setCached, deleteCached } from '@/lib/cache'

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

test('setCached expires entries after the ttl elapses', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-04-08T00:00:00Z'))

  const data = { hello: 'world' }
  await setCached('ttl-key', data, 1)

  expect(await getCached('ttl-key')).toEqual(data)

  jest.setSystemTime(new Date('2026-04-08T00:00:02Z'))
  expect(await getCached('ttl-key')).toBeNull()
})

afterEach(() => {
  jest.useRealTimers()
})
