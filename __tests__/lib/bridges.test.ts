jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn(),
  setCached: jest.fn(),
}))
jest.mock('@/lib/tokens', () => ({
  getTokenInfo: jest.fn(),
}))

import { queryClickHouse } from '@/lib/clickhouse'
import { getCached, setCached } from '@/lib/cache'
import { getTokenInfo } from '@/lib/tokens'
import { BRIDGE_CONTRACTS } from '@/lib/bridge-registry'
import { getDailyBridgeProviderAssetFlows, getDailyBridgeProviderFlows } from '@/lib/bridges'

const mockQuery = queryClickHouse as jest.Mock
const mockGetCached = getCached as jest.Mock
const mockSetCached = setCached as jest.Mock
const mockGetTokenInfo = getTokenInfo as jest.Mock
const cacheStore = new Map<string, unknown>()

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000'

function getContractAddress(provider: string, role: string, asset: string) {
  const contract = BRIDGE_CONTRACTS.find(
    candidate => candidate.provider === provider && candidate.role === role && candidate.asset === asset,
  )
  if (!contract) {
    throw new Error(`Missing bridge contract for ${provider}/${role}/${asset}`)
  }
  return contract.address
}

const STARGATE_USDC_TOKEN = getContractAddress('stargate', 'token', 'USDC.e')
const STARGATE_USDC_ADAPTER = getContractAddress('stargate', 'adapter', 'USDC.e')
const STARGATE_EURC_TOKEN = getContractAddress('stargate', 'token', 'EURC.e')
const STARGATE_EURC_ADAPTER = getContractAddress('stargate', 'adapter', 'EURC.e')
const USDT0_TOKEN = getContractAddress('usdt0', 'token', 'USDT0')
const USDT0_ADAPTER = getContractAddress('usdt0', 'adapter', 'USDT0')
const FRAX_TOKEN = getContractAddress('frax', 'token', 'frxUSD')
const FRAX_ADAPTER = getContractAddress('frax', 'adapter', 'frxUSD')

function padTopicAddress(address: string) {
  const lower = address.toLowerCase()
  if (lower === ZERO_TOPIC || lower === '0x0000000000000000000000000000000000000000') {
    return ZERO_TOPIC
  }
  return `0x000000000000000000000000${lower.slice(2)}`
}

function encodeUint256(value: bigint) {
  return `0x${value.toString(16).padStart(64, '0')}`
}

function makeTokenRow(params: {
  block_timestamp: string
  address: string
  from: string
  to: string
  amount: bigint
  tx_hash: string
}) {
  return {
    block_timestamp: params.block_timestamp,
    address: params.address.toLowerCase(),
    topic1: padTopicAddress(params.from),
    topic2: padTopicAddress(params.to),
    data: encodeUint256(params.amount),
    tx_hash: params.tx_hash.toLowerCase(),
  }
}

function makeAdapterTouchRow(tx_hash: string, address: string) {
  return {
    tx_hash: tx_hash.toLowerCase(),
    address: address.toLowerCase(),
  }
}

function mockStrictFlowQueries(tokenRows: Array<Record<string, unknown>>, adapterRows: Array<Record<string, unknown>>) {
  mockQuery.mockResolvedValueOnce(tokenRows)
  mockQuery.mockResolvedValueOnce(adapterRows)
}

beforeEach(() => {
  mockQuery.mockReset()
  mockGetCached.mockReset()
  mockSetCached.mockReset()
  mockGetTokenInfo.mockReset()
  cacheStore.clear()
  mockGetCached.mockImplementation(async (key: string) => (cacheStore.has(key) ? cacheStore.get(key) : null))
  mockSetCached.mockImplementation(async (key: string, value: unknown) => {
    cacheStore.set(key, value)
  })
  mockGetTokenInfo.mockImplementation(async (address: string) => {
    const lower = address.toLowerCase()
    if (lower === STARGATE_USDC_TOKEN) {
      return {
        address: STARGATE_USDC_TOKEN,
        symbol: 'USDC.e',
        name: 'USD Coin (Bridged)',
        decimals: 6,
      }
    }
    if (lower === STARGATE_EURC_TOKEN) {
      return {
        address: STARGATE_EURC_TOKEN,
        symbol: 'EURC.e',
        name: 'Euro Coin (Bridged)',
        decimals: 6,
      }
    }
    if (lower === USDT0_TOKEN) {
      return {
        address: USDT0_TOKEN,
        symbol: 'USDT0',
        name: 'USDT0',
        decimals: 6,
      }
    }
    if (lower === FRAX_TOKEN) {
      return {
        address: FRAX_TOKEN,
        symbol: 'frxUSD',
        name: 'frxUSD',
        decimals: 6,
      }
    }
    return null
  })
})

test('mint without matching adapter touch is excluded from provider and asset rollups', async () => {
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_500_000n,
      tx_hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
  ]

  mockStrictFlowQueries(tokenRows, [])
  expect(await getDailyBridgeProviderFlows(30)).toEqual([])

  mockStrictFlowQueries(tokenRows, [])
  expect(await getDailyBridgeProviderAssetFlows(30)).toEqual([])
})

test('mint with matching provider adapter touch is included in provider and asset rollups', async () => {
  const txHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_500_000n,
      tx_hash: txHash,
    }),
  ]
  const adapterRows = [makeAdapterTouchRow(txHash, STARGATE_USDC_ADAPTER)]

  mockStrictFlowQueries(tokenRows, adapterRows)
  expect(await getDailyBridgeProviderFlows(30)).toEqual([
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      gross_inflow: 1.5,
      gross_outflow: 0,
      net_flow: 1.5,
      tx_count: 1,
      unique_users: 1,
    },
  ])

  mockStrictFlowQueries(tokenRows, adapterRows)
  expect(await getDailyBridgeProviderAssetFlows(30)).toEqual([
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      asset: 'USDC.e',
      token: STARGATE_USDC_TOKEN,
      gross_inflow: 1.5,
      gross_outflow: 0,
      net_flow: 1.5,
      tx_count: 1,
      unique_users: 1,
    },
  ])
})

test('same-provider wrong-adapter touch does not validate the token transfer', async () => {
  const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_500_000n,
      tx_hash: txHash,
    }),
  ]
  const adapterRows = [makeAdapterTouchRow(txHash, STARGATE_EURC_ADAPTER)]

  mockStrictFlowQueries(tokenRows, adapterRows)
  expect(await getDailyBridgeProviderFlows(30)).toEqual([])

  mockStrictFlowQueries(tokenRows, adapterRows)
  expect(await getDailyBridgeProviderAssetFlows(30)).toEqual([])
})

test('mint to a bridge-owned address with matching adapter touch is excluded from headline output', async () => {
  const txHash = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: STARGATE_USDC_ADAPTER,
      amount: 1_500_000n,
      tx_hash: txHash,
    }),
  ]
  const adapterRows = [makeAdapterTouchRow(txHash, STARGATE_USDC_ADAPTER)]

  mockStrictFlowQueries(tokenRows, adapterRows)
  expect(await getDailyBridgeProviderFlows(30)).toEqual([])

  mockStrictFlowQueries(tokenRows, adapterRows)
  expect(await getDailyBridgeProviderAssetFlows(30)).toEqual([])
})

test('provider rollup sums multiple asset rows and distinct strict headline tx hashes', async () => {
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 09:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: '0x1111111111111111111111111111111111111111',
      amount: 1_000_000n,
      tx_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    }),
    makeTokenRow({
      block_timestamp: '2026-04-08 10:00:00',
      address: STARGATE_EURC_TOKEN,
      from: '0x2222222222222222222222222222222222222222',
      to: ZERO_TOPIC,
      amount: 2_000_000n,
      tx_hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
    }),
    makeTokenRow({
      block_timestamp: '2026-04-08 11:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: '0x3333333333333333333333333333333333333333',
      amount: 3_000_000n,
      tx_hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
    }),
  ]
  const adapterRows = [
    makeAdapterTouchRow(tokenRows[0].tx_hash, STARGATE_USDC_ADAPTER),
    makeAdapterTouchRow(tokenRows[1].tx_hash, STARGATE_EURC_ADAPTER),
    makeAdapterTouchRow(tokenRows[2].tx_hash, STARGATE_USDC_ADAPTER),
  ]

  mockStrictFlowQueries(tokenRows, adapterRows)
  const providerRows = await getDailyBridgeProviderFlows(30)

  expect(providerRows).toEqual([
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      gross_inflow: 4,
      gross_outflow: 2,
      net_flow: 2,
      tx_count: 3,
      unique_users: 3,
    },
  ])

  mockStrictFlowQueries(tokenRows, adapterRows)
  const assetRows = await getDailyBridgeProviderAssetFlows(30)

  expect(assetRows).toEqual([
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      asset: 'EURC.e',
      token: STARGATE_EURC_TOKEN,
      gross_inflow: 0,
      gross_outflow: 2,
      net_flow: -2,
      tx_count: 1,
      unique_users: 1,
    },
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      asset: 'USDC.e',
      token: STARGATE_USDC_TOKEN,
      gross_inflow: 4,
      gross_outflow: 0,
      net_flow: 4,
      tx_count: 2,
      unique_users: 2,
    },
  ])
})

test('provider and asset rollup exports share one underlying snapshot refresh on a cold read', async () => {
  const txHash = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: STARGATE_USDC_TOKEN,
      from: ZERO_TOPIC,
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_500_000n,
      tx_hash: txHash,
    }),
  ]
  const adapterRows = [makeAdapterTouchRow(txHash, STARGATE_USDC_ADAPTER)]

  mockStrictFlowQueries(tokenRows, adapterRows)
  const providerRows = await getDailyBridgeProviderFlows(30)
  const assetRows = await getDailyBridgeProviderAssetFlows(30)

  expect(providerRows).toEqual([
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      gross_inflow: 1.5,
      gross_outflow: 0,
      net_flow: 1.5,
      tx_count: 1,
      unique_users: 1,
    },
  ])
  expect(assetRows).toEqual([
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      asset: 'USDC.e',
      token: STARGATE_USDC_TOKEN,
      gross_inflow: 1.5,
      gross_outflow: 0,
      net_flow: 1.5,
      tx_count: 1,
      unique_users: 1,
    },
  ])
  expect(mockQuery).toHaveBeenCalledTimes(2)
})

test('tx_count reflects distinct strict headline tx hashes for the grouping key', async () => {
  const txHash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: USDT0_TOKEN,
      from: ZERO_TOPIC,
      to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 1_000_000n,
      tx_hash: txHash,
    }),
    makeTokenRow({
      block_timestamp: '2026-04-08 12:00:05',
      address: FRAX_TOKEN,
      from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      to: ZERO_TOPIC,
      amount: 2_000_000n,
      tx_hash: txHash,
    }),
  ]
  const adapterRows = [
    makeAdapterTouchRow(txHash, USDT0_ADAPTER),
    makeAdapterTouchRow(txHash, FRAX_ADAPTER),
  ]

  mockStrictFlowQueries(tokenRows, adapterRows)
  const providerRows = await getDailyBridgeProviderFlows(30)

  expect(providerRows).toEqual([
    {
      day: '2026-04-08',
      provider: 'frax',
      provider_label: 'Frax',
      gross_inflow: 0,
      gross_outflow: 2,
      net_flow: -2,
      tx_count: 1,
      unique_users: 1,
    },
    {
      day: '2026-04-08',
      provider: 'usdt0',
      provider_label: 'USDT0',
      gross_inflow: 1,
      gross_outflow: 0,
      net_flow: 1,
      tx_count: 1,
      unique_users: 1,
    },
  ])

  mockStrictFlowQueries(tokenRows, adapterRows)
  const assetRows = await getDailyBridgeProviderAssetFlows(30)
  expect(assetRows.every(row => row.tx_count === 1)).toBe(true)
})

test('unique_users counts distinct addresses across rows for a provider-day', async () => {
  const tokenRows = [
    makeTokenRow({
      block_timestamp: '2026-04-08 09:00:00',
      address: USDT0_TOKEN,
      from: ZERO_TOPIC,
      to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 1_000_000n,
      tx_hash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    }),
    makeTokenRow({
      block_timestamp: '2026-04-08 10:00:00',
      address: USDT0_TOKEN,
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to: ZERO_TOPIC,
      amount: 2_000_000n,
      tx_hash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    }),
    makeTokenRow({
      block_timestamp: '2026-04-08 11:00:00',
      address: USDT0_TOKEN,
      from: ZERO_TOPIC,
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      amount: 3_000_000n,
      tx_hash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    }),
  ]
  const adapterRows = [
    makeAdapterTouchRow(tokenRows[0].tx_hash, USDT0_ADAPTER),
    makeAdapterTouchRow(tokenRows[1].tx_hash, USDT0_ADAPTER),
    makeAdapterTouchRow(tokenRows[2].tx_hash, USDT0_ADAPTER),
  ]

  mockStrictFlowQueries(tokenRows, adapterRows)
  const rows = await getDailyBridgeProviderFlows(30)

  expect(rows[0].unique_users).toBe(2)
})

test('cached results short-circuit ClickHouse calls', async () => {
  const cached = [
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      gross_inflow: 1,
      gross_outflow: 0,
      net_flow: 1,
      tx_count: 1,
      unique_users: 1,
    },
  ]
  mockGetCached.mockResolvedValueOnce(cached)

  const rows = await getDailyBridgeProviderFlows(30)

  expect(rows).toBe(cached)
  expect(mockQuery).not.toHaveBeenCalled()
  expect(mockSetCached).not.toHaveBeenCalled()
})
