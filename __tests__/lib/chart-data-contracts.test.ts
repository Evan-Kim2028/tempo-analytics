/**
 * Chart Data Contract Tests
 * ==========================
 * One test per chart data function. Each test verifies that the function's output
 * satisfies the "recharts contract" — the shape recharts needs to render visible bars
 * or lines. See __tests__/helpers/chart-contract.ts for the invariants.
 *
 * When adding a new chart:
 *   1. Create a server-side data function (never pivot inside a client component).
 *   2. Add a contract test here — copy the nearest describe block as a template.
 *   3. Use expectRechartsRows() for static-dataKey charts.
 *      Use expectPivotContract() for dynamic-dataKey (stacked/multi-series) charts.
 */

// ─── Module mocks (must be before any imports) ───────────────────────────────

jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({ readContract: jest.fn() })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))

jest.mock('@/lib/chain', () => ({
  publicClient: { readContract: jest.fn() },
  tempoChain: {},
}))

jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))

jest.mock('@/lib/cache', () => ({
  getCached:  jest.fn().mockResolvedValue(null),
  setCached:  jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/tokens', () => ({
  getTokenInfo:      jest.fn().mockResolvedValue(null),
  getTokenSupply:    jest.fn().mockResolvedValue(null),
  KNOWN_TOKENS:      {},
  EXCLUDED_TOKENS:   new Set(),
  STABLECOIN_ADDRESSES: [
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50',
  ],
  formatTokenAmount: jest.fn().mockReturnValue('0.00'),
}))

jest.mock('@/lib/tokenlist', () => ({
  getStablecoinAddresses: jest.fn().mockResolvedValue([
    '0x20c0000000000000000000000000000000000000',
    '0x20c000000000000000000000b9537d11c60e8b50',
  ]),
  getTokenFromList: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/dex', () => ({
  getDexPairInfo:      jest.fn(),
  computePairUsdVolume: jest.fn(),
  isWhitelistedPair:   jest.fn(),
}))

// ─── Imports ─────────────────────────────────────────────────────────────────

import { queryClickHouse } from '@/lib/clickhouse'
import { getCached }       from '@/lib/cache'
import { getTokenInfo }    from '@/lib/tokens'
import { getDexPairInfo, computePairUsdVolume } from '@/lib/dex'

import {
  getDailyStats,
  getDailyStatsCategorized,
  getStablecoinDailyVolume,
  getStablecoinSupplyHistory,
  getDexDailyVolumeUSD,
  getFeeTokenAllDailyStats,
  getProtocolDexTokenDailyStats,
} from '@/lib/analytics'

import {
  getTempoTxShareByDay,
  getTempoFeatureAdoptionByDay,
  getFeeTokenMixChartData,
  getSponsorConcentrationByDay,
  getWebauthnUsageByDay,
} from '@/lib/tempoAnalytics'

import { getBridgeNetInflowChartData } from '@/lib/bridges'

import { expectRechartsRows, expectPivotContract } from '../helpers/chart-contract'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockQuery = queryClickHouse as jest.Mock
const mockGetTokenInfo = getTokenInfo as jest.Mock
const mockGetCached = getCached as jest.Mock

function mockQueryOnce(rows: unknown[]) {
  mockQuery.mockResolvedValueOnce(rows)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCached.mockResolvedValue(null)
  mockGetTokenInfo.mockResolvedValue(null)
})

// ─── Static dataKey charts ───────────────────────────────────────────────────
// These charts use fixed string dataKeys (e.g. dataKey="batch_txs").

// Chart: TempoFeaturesChart, ActivityChart
// DataKeys: batch_txs, sponsored_txs, unique_senders, txs
describe('getDailyStats → TempoFeaturesChart / ActivityChart', () => {
  test('contract: batch_txs, sponsored_txs, unique_senders, txs are finite numbers', async () => {
    mockQueryOnce([
      { day: '2026-04-01', txs: '1000', unique_senders: '200', batch_txs: '50', sponsored_txs: '30' },
      { day: '2026-04-02', txs: '1200', unique_senders: '220', batch_txs: '60', sponsored_txs: '35' },
    ])
    const rows = await getDailyStats(2)
    expectRechartsRows(rows as never, ['txs', 'unique_senders', 'batch_txs', 'sponsored_txs'])
  })

  test('contract: zero values are valid (charts should render empty bars, not crash)', async () => {
    mockQueryOnce([
      { day: '2026-04-01', txs: '0', unique_senders: '0', batch_txs: '0', sponsored_txs: '0' },
    ])
    const rows = await getDailyStats(1)
    expectRechartsRows(rows as never, ['txs', 'unique_senders', 'batch_txs', 'sponsored_txs'])
  })
})

// Chart: TxCategoryChart
// DataKeys: user_txs, protocol_txs, inscription_txs
describe('getDailyStatsCategorized → TxCategoryChart', () => {
  test('contract: user_txs, protocol_txs, inscription_txs are finite numbers', async () => {
    mockQueryOnce([
      { day: '2026-04-01', user_txs: '900', protocol_txs: '80', inscription_txs: '20' },
    ])
    const rows = await getDailyStatsCategorized(1)
    expectRechartsRows(rows as never, ['user_txs', 'protocol_txs', 'inscription_txs'])
  })
})

// Chart: StablecoinVolumeChart (dynamic token keys)
describe('getStablecoinDailyVolume → StablecoinVolumeChart', () => {
  const PATHUSD = '0x20c0000000000000000000000000000000000000'
  const USDC_E  = '0x20c000000000000000000000b9537d11c60e8b50'

  test('pivot contract: token addresses appear as numeric keys in days rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', token: PATHUSD, volume_raw: '5000000' },
      { day: '2026-04-01', token: USDC_E,  volume_raw: '3000000' },
      { day: '2026-04-02', token: PATHUSD, volume_raw: '4000000' },
    ])
    const data = await getStablecoinDailyVolume(2)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })
})

// Chart: StablecoinSupplyChart (dynamic token keys, cumulative)
describe('getStablecoinSupplyHistory → StablecoinSupplyChart', () => {
  const PATHUSD = '0x20c0000000000000000000000000000000000000'
  const USDC_E  = '0x20c000000000000000000000b9537d11c60e8b50'

  test('pivot contract: token addresses appear as numeric keys in days rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', token: PATHUSD, net_raw: String(10e6) },
      { day: '2026-04-01', token: USDC_E,  net_raw: String(5e6)  },
    ])
    const data = await getStablecoinSupplyHistory(1)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })
})

// Chart: DexVolumeChart
// DataKey: volume_usd
describe('getDexDailyVolumeUSD → DexVolumeChart', () => {
  test('contract: volume_usd is a finite number', async () => {
    const mockGetDexPairInfo = getDexPairInfo as jest.Mock
    const mockComputePairUsdVolume = computePairUsdVolume as jest.Mock

    mockQueryOnce([
      {
        day: '2026-04-01',
        pair: '0xpair1',
        amount0In: '1000000', amount1In: '0',
        amount0Out: '0', amount1Out: '990000',
        swap_count: '5',
      },
    ])
    mockGetDexPairInfo.mockResolvedValueOnce({
      pair:   '0xpair1',
      token0: '0x20c000000000000000000000b9537d11c60e8b50',
      token1: '0xabcd',
    })
    mockComputePairUsdVolume.mockResolvedValueOnce(1000)

    const rows = await getDexDailyVolumeUSD(1)
    expectRechartsRows(rows as never, ['volume_usd'])
  })
})

// Chart: TempoTxShareChart
// DataKey: tempo_pct
describe('getTempoTxShareByDay → TempoTxShareChart', () => {
  test('contract: tempo_pct is a finite number', async () => {
    mockQueryOnce([
      { day: '2026-04-01', tempo_txs: '100', total_txs: '400', tempo_pct: '25' },
    ])
    const rows = await getTempoTxShareByDay(1)
    expectRechartsRows(rows as never, ['tempo_pct'])
  })
})

// Chart: TempoFeatureAdoptionChart
// DataKeys: sponsored_pct, batched_pct, time_bounded_pct, fee_token_set_pct
describe('getTempoFeatureAdoptionByDay → TempoFeatureAdoptionChart', () => {
  test('contract: all pct fields are finite numbers', async () => {
    mockQueryOnce([
      {
        day: '2026-04-01',
        total_txs: '100',
        sponsored_txs: '4',
        batched_txs: '2',
        time_bounded_txs: '80',
        fee_token_set_txs: '25',
      },
    ])
    const rows = await getTempoFeatureAdoptionByDay(1)
    expectRechartsRows(rows as never, ['sponsored_pct', 'batched_pct', 'time_bounded_pct', 'fee_token_set_pct'])
  })
})

// Chart: SponsorConcentrationChart
// DataKeys: top1_pct, top5_pct
describe('getSponsorConcentrationByDay → SponsorConcentrationChart', () => {
  test('contract: top1_pct and top5_pct are finite numbers', async () => {
    mockQueryOnce([
      { day: '2026-04-01', sponsored_txs: '200', top1_pct: '45', top5_pct: '80', sponsor_count: '8' },
    ])
    const rows = await getSponsorConcentrationByDay(1, 100)
    expectRechartsRows(rows as never, ['top1_pct', 'top5_pct'])
  })
})

// Chart: WebauthnUsageChart
// DataKey: webauthn_pct_of_tempo
describe('getWebauthnUsageByDay → WebauthnUsageChart', () => {
  test('contract: webauthn_pct_of_tempo is a finite number', async () => {
    mockQueryOnce([
      { day: '2026-04-01', webauthn_txs: '50', webauthn_pct_of_tempo: '4.5' },
    ])
    const rows = await getWebauthnUsageByDay(1)
    expectRechartsRows(rows as never, ['webauthn_pct_of_tempo'])
  })
})

// ─── Pivot/stacked charts (dynamic dataKeys) ─────────────────────────────────
// These charts use token addresses or provider IDs as recharts dataKeys.
// The pivot (grouping per-day) must happen server-side.

// Chart: FeeTokenAllChart
// DataKeys: token addresses (dynamic, from data.tokens[].address)
describe('getFeeTokenAllDailyStats → FeeTokenAllChart', () => {
  const TOKEN_A = '0xaaaa000000000000000000000000000000000000'
  const TOKEN_B = '0xbbbb000000000000000000000000000000000000'

  test('pivot contract: token addresses appear as numeric keys in days rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: TOKEN_A, txs: '300' },
      { day: '2026-04-01', fee_token: TOKEN_B, txs: '100' },
      { day: '2026-04-02', fee_token: TOKEN_A, txs: '250' },
    ])
    mockGetTokenInfo
      .mockResolvedValueOnce({ symbol: 'TOKENA', name: 'Token A', decimals: 6, address: TOKEN_A })
      .mockResolvedValueOnce({ symbol: 'TOKENB', name: 'Token B', decimals: 6, address: TOKEN_B })

    const data = await getFeeTokenAllDailyStats(2)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })

  test('pivot contract: unknown tokens (null getTokenInfo) use address as key and still have finite values', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: TOKEN_A, txs: '500' },
    ])
    // getTokenInfo returns null → address used as-is
    mockGetTokenInfo.mockResolvedValueOnce(null)

    const data = await getFeeTokenAllDailyStats(1)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })
})

// Chart: ProtocolDexTokenChart
// DataKeys: token addresses + optional '__others__' (dynamic)
describe('getProtocolDexTokenDailyStats → ProtocolDexTokenChart', () => {
  const TOKEN_A = '0xaaaa000000000000000000000000000000000000'
  const TOKEN_B = '0xbbbb000000000000000000000000000000000000'

  test('pivot contract: token addresses appear as numeric keys in days rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', token: TOKEN_A, volume_raw: '5000000' },
      { day: '2026-04-01', token: TOKEN_B, volume_raw: '2000000' },
      { day: '2026-04-02', token: TOKEN_A, volume_raw: '4000000' },
    ])
    mockGetTokenInfo
      .mockResolvedValueOnce({ symbol: 'TOKENA', name: 'Token A', decimals: 6, address: TOKEN_A })
      .mockResolvedValueOnce({ symbol: 'TOKENB', name: 'Token B', decimals: 6, address: TOKEN_B })

    const data = await getProtocolDexTokenDailyStats(2)
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })

  test('pivot contract: "Others" entry uses __others__ key which is numeric', async () => {
    // Provide 9 tokens to trigger the "Others" grouping (TOP_PROTOCOL_DEX_TOKENS = 8)
    const tokens = Array.from({ length: 9 }, (_, i) =>
      `0x${String(i).padStart(40, '0')}`
    )
    const rows = tokens.map((token, i) => ({
      day: '2026-04-01',
      token,
      volume_raw: String((9 - i) * 1_000_000), // descending volume
    }))
    mockQueryOnce(rows)
    tokens.forEach((address, i) => {
      mockGetTokenInfo.mockResolvedValueOnce(
        i < 8 ? { symbol: `TK${i}`, name: `Token ${i}`, decimals: 6, address } : null,
      )
    })

    const data = await getProtocolDexTokenDailyStats(1)
    // Should have 8 top tokens + 1 "Others"
    expect(data.tokens).toHaveLength(9)
    expect(data.tokens[8].address).toBe('__others__')
    expectPivotContract(
      data.days as never,
      data.tokens.map(t => ({ key: t.address })),
    )
  })
})

// Chart: FeeTokenMixChart
// DataKeys: fee token labels (dynamic, from data.tokens[])
describe('getFeeTokenMixChartData → FeeTokenMixChart', () => {
  test('pivot contract: token label strings appear as numeric keys in rows', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: '0x20c000000000000000000000b9537d11c60e8b50', txs: '80', pct_of_day: '80' },
      { day: '2026-04-01', fee_token: '0x20c0000000000000000000000000000000000000', txs: '20', pct_of_day: '20' },
      { day: '2026-04-02', fee_token: '0x20c000000000000000000000b9537d11c60e8b50', txs: '70', pct_of_day: '100' },
    ])

    const data = await getFeeTokenMixChartData(2)
    expect(data.tokens.length).toBeGreaterThan(0)
    expectPivotContract(
      data.rows as never,
      data.tokens.map(t => ({ key: t })),
    )
  })

  test('pivot contract: unknown addresses are shortened and still produce numeric keys', async () => {
    mockQueryOnce([
      { day: '2026-04-01', fee_token: '0xdeadbeef00000000000000000000000000000001', txs: '5', pct_of_day: '100' },
    ])

    const data = await getFeeTokenMixChartData(1)
    expectPivotContract(
      data.rows as never,
      data.tokens.map(t => ({ key: t })),
    )
  })
})

// Chart: BridgeNetInflowChart
// DataKeys: provider IDs (dynamic, from data.providers[].id)
describe('getBridgeNetInflowChartData → BridgeNetInflowChart', () => {
  test('pivot contract: provider IDs appear as numeric keys in days rows', async () => {
    // Pre-populate the bridge_provider_flows cache so we bypass the complex pipeline
    mockGetCached.mockImplementation((key: string) => {
      if (key === 'analytics:bridge_provider_flows:30') {
        return Promise.resolve([
          { day: '2026-04-01', provider: 'stargate', provider_label: 'Stargate',
            gross_inflow: 1000, gross_outflow: 300, net_flow: 700, tx_count: 5, unique_users: 3 },
          { day: '2026-04-01', provider: 'usdt0', provider_label: 'USDT0',
            gross_inflow: 500, gross_outflow: 200, net_flow: 300, tx_count: 2, unique_users: 2 },
          { day: '2026-04-02', provider: 'stargate', provider_label: 'Stargate',
            gross_inflow: 800, gross_outflow: 100, net_flow: 700, tx_count: 4, unique_users: 3 },
        ])
      }
      return Promise.resolve(null)
    })

    const data = await getBridgeNetInflowChartData(30)
    expectPivotContract(
      data.days as never,
      data.providers.map(p => ({ key: p.id })),
    )
  })

  test('pivot contract: providers sorted by total net_flow descending', async () => {
    mockGetCached.mockImplementation((key: string) => {
      if (key === 'analytics:bridge_provider_flows:30') {
        return Promise.resolve([
          { day: '2026-04-01', provider: 'frax',     provider_label: 'Frax',     gross_inflow: 10, gross_outflow: 0, net_flow: 10,  tx_count: 1, unique_users: 1 },
          { day: '2026-04-01', provider: 'stargate', provider_label: 'Stargate', gross_inflow: 1000, gross_outflow: 0, net_flow: 1000, tx_count: 5, unique_users: 3 },
          { day: '2026-04-01', provider: 'usdt0',    provider_label: 'USDT0',    gross_inflow: 400, gross_outflow: 0, net_flow: 400,  tx_count: 2, unique_users: 2 },
        ])
      }
      return Promise.resolve(null)
    })

    const data = await getBridgeNetInflowChartData(30)
    // First provider must have highest total
    expect(data.providers[0].total).toBeGreaterThanOrEqual(data.providers[1].total)
    if (data.providers.length > 2) {
      expect(data.providers[1].total).toBeGreaterThanOrEqual(data.providers[2].total)
    }
  })
})
