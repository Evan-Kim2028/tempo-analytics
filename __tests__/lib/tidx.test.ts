import { queryTidx, getTidxStatus } from '@/lib/tidx'

const MOCK_QUERY_RESPONSE = {
  ok: true,
  columns: ['num', 'hash'],
  rows: [[1000, '0xabc']],
  row_count: 1,
  engine: 'postgres',
  query_time_ms: 0.5,
}

const MOCK_STATUS = {
  ok: true,
  version: '0.5.1',
  chains: [{
    chain_id: 4217,
    head_num: 13567000,
    synced_num: 0,
    tip_num: 13567000,
    lag: 0,
    backfill_num: 5000000,
    backfill_remaining: 5000000,
    sync_rate: 3000,
    postgres: { blocks: 13567000, txs: 13567000, logs: 13566000, receipts: 13567000, blocks_count: 500000, txs_count: 600000, logs_count: 200000, receipts_count: 600000, rate: 3000 },
    clickhouse: { blocks: 13567000, txs: 13567000, logs: 13566000, receipts: 13567000, blocks_count: 500000, txs_count: 600000, logs_count: 200000, receipts_count: 600000, rate: 2900 },
  }],
}

beforeEach(() => {
  global.fetch = jest.fn()
})

test('queryTidx returns typed rows', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => MOCK_QUERY_RESPONSE,
  })
  const result = await queryTidx('SELECT num, hash FROM blocks LIMIT 1')
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toEqual({ num: 1000, hash: '0xabc' })
})

test('queryTidx throws on tidx error', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ ok: false, error: 'SQL parse error: bad syntax' }),
  })
  await expect(queryTidx('BAD SQL')).rejects.toThrow('SQL parse error: bad syntax')
})

test('getTidxStatus returns chain stats', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => MOCK_STATUS,
  })
  const status = await getTidxStatus()
  expect(status.chains[0].chain_id).toBe(4217)
  expect(status.chains[0].head_num).toBe(13567000)
})
