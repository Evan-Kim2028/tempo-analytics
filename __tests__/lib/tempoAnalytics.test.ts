jest.mock('@/lib/cache', () => ({
  getCached: jest.fn(),
  setCached: jest.fn(),
}))

jest.mock('@/lib/clickhouse', () => ({
  queryClickHouse: jest.fn(),
}))

jest.mock('@/lib/tokens', () => ({
  KNOWN_TOKENS: {
    '0x20c000000000000000000000b9537d11c60e8b50': { symbol: 'USDC.e' },
    '0x20c0000000000000000000000000000000000000': { symbol: 'pathUSD' },
  },
}))

import { getCached, setCached } from '@/lib/cache'
import { queryClickHouse } from '@/lib/clickhouse'
import {
  getFeeTokenMixByDay,
  getSponsorConcentrationByDay,
  getTempoFeatureAdoptionByDay,
  getTempoTxShareByDay,
  getTopSponsors,
  getWebauthnUsageByDay,
  labelFeeToken,
} from '@/lib/tempoAnalytics'

beforeEach(() => {
  jest.clearAllMocks()
  ;(getCached as jest.Mock).mockResolvedValue(null)
})

test('maps tempo tx share rows into numbers', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    { day: '2026-04-01', tempo_txs: '50', total_txs: '200', tempo_pct: '25' },
  ])

  await expect(getTempoTxShareByDay(7)).resolves.toEqual([
    { day: '2026-04-01', tempo_txs: 50, total_txs: 200, tempo_pct: 25 },
  ])
})

test('returns cached tempo tx share rows without querying clickhouse', async () => {
  const cached = [{ day: '2026-04-01', tempo_txs: 50, total_txs: 200, tempo_pct: 25 }]
  ;(getCached as jest.Mock).mockResolvedValueOnce(cached)

  await expect(getTempoTxShareByDay(7)).resolves.toEqual(cached)
  expect(queryClickHouse).not.toHaveBeenCalled()
  expect(setCached).not.toHaveBeenCalled()
})

test('caches tempo tx share rows on miss with ttl 900', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    { day: '2026-04-01', tempo_txs: '50', total_txs: '200', tempo_pct: '25' },
  ])

  await getTempoTxShareByDay(7)

  expect(setCached).toHaveBeenCalledWith(
    'tempo-analytics:tx-share:7',
    [{ day: '2026-04-01', tempo_txs: 50, total_txs: 200, tempo_pct: 25 }],
    900,
  )
})

test('computes feature adoption percentages from raw counts', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    {
      day: '2026-04-01',
      total_txs: '100',
      sponsored_txs: '4',
      batched_txs: '2',
      time_bounded_txs: '80',
      fee_token_set_txs: '25',
    },
  ])

  await expect(getTempoFeatureAdoptionByDay(7)).resolves.toEqual([
    {
      day: '2026-04-01',
      sponsored_pct: 4,
      batched_pct: 2,
      time_bounded_pct: 80,
      fee_token_set_pct: 25,
    },
  ])

  const sql = String((queryClickHouse as jest.Mock).mock.calls[0][0])
  expect(sql).toMatch(/call_count\s*>\s*1/)
})

test('normalizes fee token labels and maps numeric fields', () => {
  expect(labelFeeToken('0x20c000000000000000000000b9537d11c60e8b50')).toBe('USDC.e')
  expect(labelFeeToken('0x20c0000000000000000000000000000000000000')).toBe('pathUSD')
})

test('maps fee token mix rows and normalizes known addresses', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    {
      day: '2026-04-01T00:00:00Z',
      fee_token: '0x20c000000000000000000000b9537d11c60e8b50',
      txs: '12',
      pct_of_day: '6.5',
    },
    {
      day: '2026-04-01T00:00:00Z',
      fee_token: '0x20c0000000000000000000000000000000000000',
      txs: '8',
      pct_of_day: '4.0',
    },
  ])

  await expect(getFeeTokenMixByDay(7)).resolves.toEqual([
    {
      day: '2026-04-01',
      fee_token: 'USDC.e',
      txs: 12,
      pct_of_day: 6.5,
    },
    {
      day: '2026-04-01',
      fee_token: 'pathUSD',
      txs: 8,
      pct_of_day: 4,
    },
  ])
})

test('filters sponsor concentration rows below the minimum volume', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    {
      day: '2026-04-01',
      sponsored_txs: '80',
      top1_pct: '50',
      top5_pct: '80',
      sponsor_count: '2',
    },
    {
      day: '2026-04-02',
      sponsored_txs: '120',
      top1_pct: '55',
      top5_pct: '90',
      sponsor_count: '3',
    },
  ])

  await expect(getSponsorConcentrationByDay(7, 100)).resolves.toEqual([
    {
      day: '2026-04-02',
      sponsored_txs: 120,
      top1_pct: 55,
      top5_pct: 90,
      sponsor_count: 3,
    },
  ])
})

test('maps top sponsor numeric fields correctly', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    {
      sponsor: '0x123',
      sponsored_txs: '28922',
      unique_users_sponsored: '818',
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-04-01T00:00:00Z',
    },
  ])

  await expect(getTopSponsors(10)).resolves.toEqual([
    {
      sponsor: '0x123',
      sponsored_txs: 28922,
      unique_users_sponsored: 818,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-04-01T00:00:00Z',
    },
  ])
})

test('maps webauthn usage rows into numbers and guards zero totals', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    { day: '2026-04-01', webauthn_txs: '293', webauthn_pct_of_tempo: '4.02' },
  ])

  await expect(getWebauthnUsageByDay(7)).resolves.toEqual([
    { day: '2026-04-01', webauthn_txs: 293, webauthn_pct_of_tempo: 4.02 },
  ])

  const sql = String((queryClickHouse as jest.Mock).mock.calls[0][0])
  expect(sql).toMatch(/if\s*\(\s*total_tempo_txs\s*=\s*0\s*,\s*0\s*,\s*round\(webauthn_txs \* 100\.0 \/ total_tempo_txs, 2\)\s*\)/)
})

test('maps zero-webauthn rows to zero percentage safely', async () => {
  ;(queryClickHouse as jest.Mock).mockResolvedValueOnce([
    { day: '2026-04-01', webauthn_txs: '0', webauthn_pct_of_tempo: '0' },
  ])

  await expect(getWebauthnUsageByDay(7)).resolves.toEqual([
    { day: '2026-04-01', webauthn_txs: 0, webauthn_pct_of_tempo: 0 },
  ])
})
