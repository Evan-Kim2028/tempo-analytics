// explorer/src/lib/defi.ts
import { getCached, setCached } from './cache'
import { queryClickHouse } from './clickhouse'
import { publicClient } from './chain'
import { getStablecoinAddresses } from './tokenlist'
import { getTokenInfo } from './tokens'
import { isWhitelistedPair } from './dex'
import { getTopPools } from './analytics'

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

const BALANCE_OF_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** Pads a 20-byte address to 32-byte topic format used in ClickHouse logs */
function padAddr(addr: string): string {
  return '0x000000000000000000000000' + addr.toLowerCase().slice(2)
}

// ─────────────────────────────────────────────
// TVL
// ─────────────────────────────────────────────

const PROTOCOL_DEX = '0xdec0000000000000000000000000000000000000' as const

export async function getProtocolDexTVL(): Promise<number> {
  const key = 'defi:tvl:protocol_dex'
  const cached = await getCached<number>(key)
  if (cached) return cached

  const stableAddrs = await getStablecoinAddresses()
  const balances = await Promise.allSettled(
    stableAddrs.map(token =>
      publicClient.readContract({
        address: token as `0x${string}`,
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [PROTOCOL_DEX],
      })
    )
  )

  // All Tempo stablecoins are 6-decimal
  const tvl = balances.reduce((sum, r) => {
    if (r.status === 'fulfilled') return sum + Number(r.value) / 1e6
    return sum
  }, 0)

  await setCached(key, tvl, 900) // 15 min
  return tvl
}

export async function getCommunityDexTVL(): Promise<number> {
  const key = 'defi:tvl:community_dex'
  const cached = await getCached<number>(key)
  if (cached) return cached

  const pools = await getTopPools(10)

  const stableChecks = await Promise.all(
    pools.map(async pool => {
      const [isT0Stable, isT1Stable] = await Promise.all([
        isWhitelistedPair(pool.token0, pool.token0),
        isWhitelistedPair(pool.token1, pool.token1),
      ])
      const stablecoinToken = isT0Stable ? pool.token0 : isT1Stable ? pool.token1 : null
      return { pool, stablecoinToken }
    })
  )

  const balances = await Promise.allSettled(
    stableChecks
      .filter(s => s.stablecoinToken)
      .map(({ pool, stablecoinToken }) =>
        publicClient.readContract({
          address: stablecoinToken! as `0x${string}`,
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [pool.pair as `0x${string}`],
        }).then(balance => (Number(balance) / 1e6) * 2)
      )
  )

  const tvl = balances.reduce((sum, r) =>
    r.status === 'fulfilled' ? sum + r.value : sum, 0)

  await setCached(key, tvl, 900)
  return tvl
}

// ─────────────────────────────────────────────
// Per-address DeFi activity (ClickHouse)
// ─────────────────────────────────────────────

export interface AddressTransfer {
  block_timestamp: string
  token: string
  token_symbol: string
  direction: 'in' | 'out'
  counterparty: string
  amount_raw: string
  hash: string
}

export interface AddressDefiStats {
  transfers_in: number
  transfers_out: number
  community_swaps: number
  protocol_swaps: number
  lp_adds: number
  lp_removes: number
  recent_transfers: AddressTransfer[]
}

export async function getAddressDefiStats(address: string): Promise<AddressDefiStats> {
  const lower = address.toLowerCase()
  const key = `defi:addr:${lower}`
  const cached = await getCached<AddressDefiStats>(key)
  if (cached) return cached

  const padded = padAddr(lower)
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const SWAP_V2  = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
  const SWAP_PDX = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
  const MINT_V2  = '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f'
  const BURN_V2  = '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496'

  const [transferRows, swapRows, lpRows, transferCountRows] = await Promise.all([
    // Last 20 ERC-20 transfers
    queryClickHouse<{
      block_timestamp: string; address: string; topic1: string; topic2: string
      data: string; tx_hash: string
    }>(`
      SELECT block_timestamp, address, topic1, topic2,
             data, tx_hash
      FROM logs
      WHERE selector = '${TRANSFER}'
        AND (topic1 = '${padded}' OR topic2 = '${padded}')
        AND topic3 IS NULL
      ORDER BY block_timestamp DESC
      LIMIT 20
    `),
    // Swap counts: community + protocol DEX
    queryClickHouse<{ community: string; protocol_dex: string }>(`
      SELECT
        countIf(selector = '${SWAP_V2}' AND (topic2 = '${padded}' OR topic3 = '${padded}')) AS community,
        countIf(selector = '${SWAP_PDX}' AND topic3 = '${padded}') AS protocol_dex
      FROM logs
      WHERE (selector = '${SWAP_V2}' AND (topic2 = '${padded}' OR topic3 = '${padded}'))
         OR (selector = '${SWAP_PDX}' AND address = '${PROTOCOL_DEX}' AND topic3 = '${padded}')
    `),
    // LP activity: Mint + Burn events involving address
    queryClickHouse<{ lp_adds: string; lp_removes: string }>(`
      SELECT
        countIf(selector = '${MINT_V2}') AS lp_adds,
        countIf(selector = '${BURN_V2}') AS lp_removes
      FROM logs
      WHERE (selector = '${MINT_V2}' AND topic1 = '${padded}')
         OR (selector = '${BURN_V2}' AND (topic1 = '${padded}' OR topic2 = '${padded}'))
    `),
    // Full-history transfer in/out counts (not capped by LIMIT 20)
    queryClickHouse<{ transfers_in: string; transfers_out: string }>(`
      SELECT
        countIf(topic2 = '${padded}') AS transfers_in,
        countIf(topic1 = '${padded}') AS transfers_out
      FROM logs
      WHERE selector = '${TRANSFER}'
        AND (topic1 = '${padded}' OR topic2 = '${padded}')
        AND topic3 IS NULL
    `),
  ])

  // Full-history transfer counts from aggregation query
  const transferCounts = transferCountRows[0] ?? { transfers_in: '0', transfers_out: '0' }
  const transfers_in = Number(transferCounts.transfers_in)
  const transfers_out = Number(transferCounts.transfers_out)

  // Resolve token symbols for recent transfers (best-effort)
  const recent_transfers: AddressTransfer[] = await Promise.all(
    transferRows.map(async r => {
      const info = await getTokenInfo(r.address).catch(() => null)
      return {
        block_timestamp: r.block_timestamp,
        token: r.address,
        token_symbol: info?.symbol ?? r.address.slice(-6),
        direction: (r.topic2.toLowerCase() === padded ? 'in' : 'out') as 'in' | 'out',
        counterparty: r.topic2.toLowerCase() === padded
          ? '0x' + r.topic1.slice(-40)
          : '0x' + r.topic2.slice(-40),
        amount_raw: r.data,
        hash: r.tx_hash,
      }
    })
  )

  const swapData = swapRows[0] ?? { community: '0', protocol_dex: '0' }
  const lpData = lpRows[0] ?? { lp_adds: '0', lp_removes: '0' }

  const result: AddressDefiStats = {
    transfers_in,
    transfers_out,
    community_swaps: Number(swapData.community),
    protocol_swaps: Number(swapData.protocol_dex),
    lp_adds: Number(lpData.lp_adds),
    lp_removes: Number(lpData.lp_removes),
    recent_transfers,
  }

  await setCached(key, result, 60)
  return result
}
