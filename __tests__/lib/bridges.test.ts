jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
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

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000'

function padTopicAddress(address: string) {
  const lower = address.toLowerCase()
  if (lower === ZERO_TOPIC || lower === '0x0000000000000000000000000000000000000000') {
    return ZERO_TOPIC
  }
  return `0x000000000000000000000000${address.toLowerCase().slice(2)}`
}

function encodeUint256(value: bigint) {
  return `0x${value.toString(16).padStart(64, '0')}`
}

function makeTransferRow(params: {
  block_timestamp: string
  address: string
  from: string
  to: string
  amount: bigint
  tx_hash?: string
}) {
  return {
    block_timestamp: params.block_timestamp,
    address: params.address.toLowerCase(),
    topic1: padTopicAddress(params.from),
    topic2: padTopicAddress(params.to),
    data: encodeUint256(params.amount),
    tx_hash: params.tx_hash ?? `0x${'ab'.repeat(32)}`,
    selector: TRANSFER_TOPIC,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCached.mockResolvedValue(null)
  mockGetTokenInfo.mockImplementation(async address => {
    if (address.toLowerCase() === BRIDGE_CONTRACTS[0].address) {
      return {
        address: BRIDGE_CONTRACTS[0].address,
        symbol: 'USDC.e',
        name: 'USD Coin (Bridged)',
        decimals: 6,
      }
    }
    if (address.toLowerCase() === BRIDGE_CONTRACTS[2].address) {
      return {
        address: BRIDGE_CONTRACTS[2].address,
        symbol: 'EURC.e',
        name: 'Euro Coin (Bridged)',
        decimals: 6,
      }
    }
    if (address.toLowerCase() === BRIDGE_CONTRACTS[4].address) {
      return {
        address: BRIDGE_CONTRACTS[4].address,
        symbol: 'USDT0',
        name: 'USDT0',
        decimals: 6,
      }
    }
    if (address.toLowerCase() === BRIDGE_CONTRACTS[7].address) {
      return {
        address: BRIDGE_CONTRACTS[7].address,
        symbol: 'frxUSD',
        name: 'frxUSD',
        decimals: 6,
      }
    }
    return null
  })
})

test('mint transfer on a bridge token becomes provider asset inflow', async () => {
  mockQuery.mockResolvedValueOnce([
    makeTransferRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: BRIDGE_CONTRACTS[0].address,
      from: ZERO_TOPIC,
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
      amount: 1_500_000n,
    }),
  ])

  const rows = await getDailyBridgeProviderAssetFlows(30)

  expect(rows).toEqual([
    expect.objectContaining({
      day: '2026-04-08',
      provider: 'stargate',
      asset: 'USDC.e',
      token: BRIDGE_CONTRACTS[0].address,
      inflow: 1.5,
      outflow: 0,
      net: 1.5,
      unique_users: 1,
    }),
  ])
})

test('burn transfer on a bridge token becomes provider asset outflow', async () => {
  mockQuery.mockResolvedValueOnce([
    makeTransferRow({
      block_timestamp: '2026-04-08 12:00:00',
      address: BRIDGE_CONTRACTS[2].address,
      from: '0xabcdef1234567890abcdef1234567890abcdef12',
      to: ZERO_TOPIC,
      amount: 250_000n,
    }),
  ])

  const rows = await getDailyBridgeProviderAssetFlows(30)

  expect(rows).toEqual([
    expect.objectContaining({
      day: '2026-04-08',
      provider: 'stargate',
      asset: 'EURC.e',
      token: BRIDGE_CONTRACTS[2].address,
      inflow: 0,
      outflow: 0.25,
      net: -0.25,
      unique_users: 1,
    }),
  ])
})

test('provider daily rollup sums multiple asset rows under one provider', async () => {
  mockQuery.mockResolvedValueOnce([
    makeTransferRow({
      block_timestamp: '2026-04-08 09:00:00',
      address: BRIDGE_CONTRACTS[0].address,
      from: ZERO_TOPIC,
      to: '0x1111111111111111111111111111111111111111',
      amount: 1_000_000n,
    }),
    makeTransferRow({
      block_timestamp: '2026-04-08 10:00:00',
      address: BRIDGE_CONTRACTS[2].address,
      from: '0x2222222222222222222222222222222222222222',
      to: ZERO_TOPIC,
      amount: 2_000_000n,
    }),
    makeTransferRow({
      block_timestamp: '2026-04-08 11:00:00',
      address: BRIDGE_CONTRACTS[0].address,
      from: ZERO_TOPIC,
      to: '0x3333333333333333333333333333333333333333',
      amount: 3_000_000n,
    }),
  ])

  const rows = await getDailyBridgeProviderFlows(30)

  expect(rows).toEqual([
    expect.objectContaining({
      day: '2026-04-08',
      provider: 'stargate',
      inflow: 4,
      outflow: 2,
      net: 2,
      unique_users: 3,
    }),
  ])
})

test('unique_users counts distinct addresses across rows for a provider-day', async () => {
  mockQuery.mockResolvedValueOnce([
    makeTransferRow({
      block_timestamp: '2026-04-08 09:00:00',
      address: BRIDGE_CONTRACTS[4].address,
      from: ZERO_TOPIC,
      to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 1_000_000n,
    }),
    makeTransferRow({
      block_timestamp: '2026-04-08 10:00:00',
      address: BRIDGE_CONTRACTS[4].address,
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to: ZERO_TOPIC,
      amount: 2_000_000n,
    }),
    makeTransferRow({
      block_timestamp: '2026-04-08 11:00:00',
      address: BRIDGE_CONTRACTS[4].address,
      from: ZERO_TOPIC,
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      amount: 3_000_000n,
    }),
  ])

  const rows = await getDailyBridgeProviderFlows(30)

  expect(rows[0].unique_users).toBe(2)
})

test('cached results short-circuit ClickHouse calls', async () => {
  const cached = [
    {
      day: '2026-04-08',
      provider: 'stargate',
      provider_label: 'Stargate',
      inflow: 1,
      outflow: 0,
      net: 1,
      unique_users: 1,
    },
  ]
  mockGetCached.mockResolvedValueOnce(cached)

  const rows = await getDailyBridgeProviderFlows(30)

  expect(rows).toBe(cached)
  expect(mockQuery).not.toHaveBeenCalled()
  expect(mockSetCached).not.toHaveBeenCalled()
})
