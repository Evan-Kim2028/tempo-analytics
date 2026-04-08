import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'
import { getTokenInfo } from './tokens'
import {
  BRIDGE_CONTRACTS,
  BRIDGE_PROVIDERS,
  getBridgeTokenAddresses,
} from './bridge-registry'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000'
const FALLBACK_DECIMALS = 6
const CACHE_TTL_SECONDS = 900

interface RawBridgeTransferRow {
  block_timestamp: string
  address: string
  topic1: string
  topic2: string
  data: string
  tx_hash: string
  selector: string
}

interface BridgeTransferEvent {
  day: string
  provider: string
  provider_label: string
  asset: string
  token: string
  user: string
  direction: 'inflow' | 'outflow'
  amount: number
}

interface BridgeFlowAccumulator {
  inflow: number
  outflow: number
  users: Set<string>
}

export interface DailyBridgeProviderFlow {
  day: string
  provider: string
  provider_label: string
  inflow: number
  outflow: number
  net: number
  unique_users: number
}

export interface DailyBridgeProviderAssetFlow {
  day: string
  provider: string
  provider_label: string
  asset: string
  token: string
  inflow: number
  outflow: number
  net: number
  unique_users: number
}

const bridgeTokenContracts = BRIDGE_CONTRACTS.filter(contract => contract.role === 'token')
const bridgeTokenAddresses = getBridgeTokenAddresses()

const providerLabelById = new Map(BRIDGE_PROVIDERS.map(provider => [provider.id, provider.label]))
const tokenContractByAddress = new Map(
  bridgeTokenContracts.map(contract => [contract.address.toLowerCase(), contract]),
)

function getDayFromTimestamp(blockTimestamp: string): string {
  return String(blockTimestamp).slice(0, 10)
}

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`
}

function parseAmount(data: string): bigint {
  try {
    return BigInt(data)
  } catch {
    return 0n
  }
}

function amountToFloat(amount: bigint, decimals: number): number {
  return Number(amount) / (10 ** decimals)
}

function isStrictMintOrBurn(row: RawBridgeTransferRow): boolean {
  const topic1 = row.topic1.toLowerCase()
  const topic2 = row.topic2.toLowerCase()
  return (
    (topic1 === ZERO_TOPIC && topic2 !== ZERO_TOPIC) ||
    (topic2 === ZERO_TOPIC && topic1 !== ZERO_TOPIC)
  )
}

function classifyBridgeTransfer(row: RawBridgeTransferRow, decimalsByToken: Map<string, number>): BridgeTransferEvent | null {
  const token = row.address.toLowerCase()
  const contract = tokenContractByAddress.get(token)
  if (!contract || !isStrictMintOrBurn(row)) return null

  const topic1 = row.topic1.toLowerCase()
  const topic2 = row.topic2.toLowerCase()
  const isMint = topic1 === ZERO_TOPIC
  const user = isMint ? topicToAddress(topic2) : topicToAddress(topic1)
  const amountRaw = parseAmount(row.data)
  const decimals = decimalsByToken.get(token) ?? FALLBACK_DECIMALS

  return {
    day: getDayFromTimestamp(row.block_timestamp),
    provider: contract.provider,
    provider_label: providerLabelById.get(contract.provider) ?? contract.provider,
    asset: contract.asset,
    token: contract.address,
    user,
    direction: isMint ? 'inflow' : 'outflow',
    amount: amountToFloat(amountRaw, decimals),
  }
}

async function loadDecimalsByToken(tokens: string[]): Promise<Map<string, number>> {
  const uniqueTokens = [...new Set(tokens)]
  const tokenInfos = await Promise.all(
    uniqueTokens.map(async token => {
      const info = await getTokenInfo(token).catch(() => null)
      return [token, info?.decimals ?? FALLBACK_DECIMALS] as const
    }),
  )

  return new Map(tokenInfos)
}

async function fetchBridgeTransferRows(days: number): Promise<RawBridgeTransferRow[]> {
  const addrList = bridgeTokenAddresses.map(address => `'${address}'`).join(', ')

  return queryClickHouse<RawBridgeTransferRow>(`
    SELECT
      block_timestamp,
      address,
      topic1,
      topic2,
      data,
      tx_hash,
      selector
    FROM logs
    WHERE block_timestamp >= now() - INTERVAL ${days} DAY
      AND selector = '${TRANSFER_TOPIC}'
      AND address IN (${addrList})
      AND (
        (topic1 = '${ZERO_TOPIC}' AND topic2 != '${ZERO_TOPIC}')
        OR
        (topic2 = '${ZERO_TOPIC}' AND topic1 != '${ZERO_TOPIC}')
      )
    ORDER BY block_timestamp ASC
  `)
}

function rollupBridgeTransfers(events: BridgeTransferEvent[]): {
  providerRows: DailyBridgeProviderFlow[]
  assetRows: DailyBridgeProviderAssetFlow[]
} {
  const providerByDay = new Map<string, BridgeFlowAccumulator>()
  const assetByDay = new Map<string, BridgeFlowAccumulator>()

  for (const event of events) {
    const providerKey = `${event.day}:${event.provider}`
    const assetKey = `${event.day}:${event.provider}:${event.token}`

    const providerAcc = providerByDay.get(providerKey) ?? {
      inflow: 0,
      outflow: 0,
      users: new Set<string>(),
    }
    const assetAcc = assetByDay.get(assetKey) ?? {
      inflow: 0,
      outflow: 0,
      users: new Set<string>(),
    }

    if (event.direction === 'inflow') {
      providerAcc.inflow += event.amount
      assetAcc.inflow += event.amount
    } else {
      providerAcc.outflow += event.amount
      assetAcc.outflow += event.amount
    }

    providerAcc.users.add(event.user)
    assetAcc.users.add(event.user)
    providerByDay.set(providerKey, providerAcc)
    assetByDay.set(assetKey, assetAcc)
  }

  const providerRows = [...providerByDay.entries()]
    .map(([key, acc]) => {
      const [day, provider] = key.split(':')
      return {
        day,
        provider,
        provider_label: providerLabelById.get(provider as typeof BRIDGE_PROVIDERS[number]['id']) ?? provider,
        inflow: acc.inflow,
        outflow: acc.outflow,
        net: acc.inflow - acc.outflow,
        unique_users: acc.users.size,
      }
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.provider.localeCompare(b.provider))

  const assetRows = [...assetByDay.entries()]
    .map(([key, acc]) => {
      const [day, provider, token] = key.split(':')
      const contract = tokenContractByAddress.get(token)
      return {
        day,
        provider,
        provider_label: providerLabelById.get(provider as typeof BRIDGE_PROVIDERS[number]['id']) ?? provider,
        asset: contract?.asset ?? token,
        token,
        inflow: acc.inflow,
        outflow: acc.outflow,
        net: acc.inflow - acc.outflow,
        unique_users: acc.users.size,
      }
    })
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.provider.localeCompare(b.provider) ||
        a.asset.localeCompare(b.asset) ||
        a.token.localeCompare(b.token),
    )

  return { providerRows, assetRows }
}

async function getBridgeTransferEvents(days: number): Promise<BridgeTransferEvent[]> {
  const rows = await fetchBridgeTransferRows(days)
  if (rows.length === 0) return []

  const decimalsByToken = await loadDecimalsByToken(rows.map(row => row.address.toLowerCase()))
  const events = rows
    .map(row => classifyBridgeTransfer(row, decimalsByToken))
    .filter((event): event is BridgeTransferEvent => event !== null)

  return events
}

export async function getDailyBridgeProviderFlows(days = 30): Promise<DailyBridgeProviderFlow[]> {
  const key = `analytics:bridge_provider_flows:${days}`
  const cached = await getCached<DailyBridgeProviderFlow[]>(key)
  if (cached) return cached

  const events = await getBridgeTransferEvents(days)
  const { providerRows } = rollupBridgeTransfers(events)

  await setCached(key, providerRows, CACHE_TTL_SECONDS)
  return providerRows
}

export async function getDailyBridgeProviderAssetFlows(days = 30): Promise<DailyBridgeProviderAssetFlow[]> {
  const key = `analytics:bridge_provider_asset_flows:${days}`
  const cached = await getCached<DailyBridgeProviderAssetFlow[]>(key)
  if (cached) return cached

  const events = await getBridgeTransferEvents(days)
  const { assetRows } = rollupBridgeTransfers(events)

  await setCached(key, assetRows, CACHE_TTL_SECONDS)
  return assetRows
}
