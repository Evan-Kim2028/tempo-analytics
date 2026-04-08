describe('queryClickHouse', () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response)
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  test('uses CLICKHOUSE_DB from the environment in the request URL', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.example:8123'
    process.env.CLICKHOUSE_DB = 'tempo_test'

    const { queryClickHouse } = await import('@/lib/clickhouse')
    await queryClickHouse('SELECT 1')

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('database=tempo_test'),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
