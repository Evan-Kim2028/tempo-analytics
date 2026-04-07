import { getCached, setCached } from './cache'
import { publicClient } from './chain'

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
}

// Verified on-chain 2026-04-07. Add new tokens here as they appear.
export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0x20c0000000000000000000000000000000000000': {
    address: '0x20c0000000000000000000000000000000000000',
    symbol: 'pathUSD', name: 'pathUSD', decimals: 6,
  },
  '0x20c000000000000000000000b9537d11c60e8b50': {
    address: '0x20c000000000000000000000b9537d11c60e8b50',
    symbol: 'USDC.e', name: 'USD Coin (Bridged)', decimals: 6,
  },
  '0x20c000000000000000000000987bef2978df41f9': {
    address: '0x20c000000000000000000000987bef2978df41f9',
    symbol: 'TIMECOIN', name: 'TIMECOIN', decimals: 6,
  },
  '0x20c000000000000000000000109394a271f6aae6': {
    address: '0x20c000000000000000000000109394a271f6aae6',
    symbol: 'ENSH', name: 'ENSH', decimals: 6,
  },
  '0x20c00000000000000000000007affa1073fbc0ea': {
    address: '0x20c00000000000000000000007affa1073fbc0ea',
    symbol: 'METRONOME', name: 'Metronome', decimals: 6,
  },
  '0x0a064aecd773d3d8d09fd8fa72fcd763dd9ef3dc': {
    address: '0x0a064aecd773d3d8d09fd8fa72fcd763dd9ef3dc',
    symbol: 'PRC', name: 'PRC', decimals: 18,
  },
}

// These addresses are excluded from all analytics displays.
export const EXCLUDED_TOKENS = new Set([
  '0x20c00000000000000000000016c6514b53947fdc', // DONOTUSE — 18.4T supply, test/deprecated
])

// Stablecoin addresses used for fee payments (in tx.fee_token)
export const STABLECOIN_ADDRESSES = [
  '0x20c0000000000000000000000000000000000000', // pathUSD
  '0x20c000000000000000000000b9537d11c60e8b50', // USDC.e
]

const ERC20_ABI = [
  { name: 'symbol',   type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'name',     type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }],  stateMutability: 'view' },
] as const

export async function getTokenInfo(address: string): Promise<TokenInfo | null> {
  const lower = address.toLowerCase()
  const known = KNOWN_TOKENS[lower]
  if (known) return known

  const cacheKey = `token:meta:${lower}`
  const cached = await getCached<TokenInfo>(cacheKey)
  if (cached) return cached

  try {
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'name' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' }),
    ])
    const info: TokenInfo = { address: lower, symbol: symbol as string, name: name as string, decimals: decimals as number }
    await setCached(cacheKey, info, 86400) // 24h — token metadata is stable
    return info
  } catch {
    return null
  }
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const FIXED2   = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10 ** decimals
  const float = Number(raw) / divisor
  if (float >= 1_000_000) return COMPACT.format(float)
  return FIXED2.format(float)
}
