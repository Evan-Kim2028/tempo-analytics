import { getCached, setCached } from './cache'
import { publicClient } from './chain'
import { getTokenFromList } from './tokenlist'

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
}

// Verified on-chain 2026-04-07. Add new tokens here as they appear.
export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0x20c0000000000000000000000000000000000000': { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD',   name: 'pathUSD',               decimals: 6  },
  '0x20c000000000000000000000b9537d11c60e8b50': { address: '0x20c000000000000000000000b9537d11c60e8b50', symbol: 'USDC.e',    name: 'USD Coin (Bridged)',    decimals: 6  },
  '0x20c000000000000000000000987bef2978df41f9': { address: '0x20c000000000000000000000987bef2978df41f9', symbol: 'TIMECOIN',  name: 'TIMECOIN',              decimals: 6  },
  '0x20c000000000000000000000109394a271f6aae6': { address: '0x20c000000000000000000000109394a271f6aae6', symbol: 'ENSH',      name: 'ENSH',                  decimals: 6  },
  '0x20c00000000000000000000007affa1073fbc0ea': { address: '0x20c00000000000000000000007affa1073fbc0ea', symbol: 'METRONOME', name: 'Metronome',             decimals: 6  },
  '0x0a064aecd773d3d8d09fd8fa72fcd763dd9ef3dc': { address: '0x0a064aecd773d3d8d09fd8fa72fcd763dd9ef3dc', symbol: 'PRC',       name: 'PRC',                   decimals: 18 },
  '0x20c0000000000000000000001621e21f71cf12fb': { address: '0x20c0000000000000000000001621e21f71cf12fb', symbol: 'EURC.e',    name: 'EURC (Bridged)',        decimals: 6  },
  '0x20c00000000000000000000014f22ca97301eb73': { address: '0x20c00000000000000000000014f22ca97301eb73', symbol: 'USDT0',     name: 'USDT0',                 decimals: 6  },
  '0x20c0000000000000000000003554d28269e0f3c2': { address: '0x20c0000000000000000000003554d28269e0f3c2', symbol: 'frxUSD',    name: 'Frax USD',              decimals: 6  },
  '0x20c0000000000000000000000520792dcccccccc': { address: '0x20c0000000000000000000000520792dcccccccc', symbol: 'cUSD',      name: 'cUSD',                  decimals: 6  },
  '0x20c0000000000000000000008ee4fcff88888888': { address: '0x20c0000000000000000000008ee4fcff88888888', symbol: 'stcUSD',    name: 'stcUSD',                decimals: 6  },
  '0x20c0000000000000000000005c0bac7cef389a11': { address: '0x20c0000000000000000000005c0bac7cef389a11', symbol: 'GUSD',      name: 'Gemini Dollar',         decimals: 6  },
  '0x20c0000000000000000000007f7ba549dd0251b9': { address: '0x20c0000000000000000000007f7ba549dd0251b9', symbol: 'rUSD',      name: 'rUSD',                  decimals: 6  },
  '0x20c000000000000000000000aeed2ec36a54d0e5': { address: '0x20c000000000000000000000aeed2ec36a54d0e5', symbol: 'wsrUSD',    name: 'wsrUSD',                decimals: 6  },
  '0x20c0000000000000000000009a4a4b17e0dc6651': { address: '0x20c0000000000000000000009a4a4b17e0dc6651', symbol: 'EURAU',     name: 'EURAU',                 decimals: 6  },
  '0x20c000000000000000000000383a23bacb546ab9': { address: '0x20c000000000000000000000383a23bacb546ab9', symbol: 'reUSD',     name: 'reUSD',                 decimals: 6  },
  '0x20c000000000000000000000ab02d39df30bd17e': { address: '0x20c000000000000000000000ab02d39df30bd17e', symbol: 'iUSD',      name: 'iUSD',                  decimals: 6  },
  '0x20c000000000000000000000048c8f36df1c9a4a': { address: '0x20c000000000000000000000048c8f36df1c9a4a', symbol: 'siUSD',     name: 'siUSD',                 decimals: 6  },
  '0x20c0000000000000000000002f52d5cc21a3207b': { address: '0x20c0000000000000000000002f52d5cc21a3207b', symbol: 'USDe',      name: 'USDe',                  decimals: 6  },
  '0x20c000000000000000000000bd95bfb69fbe6ce3': { address: '0x20c000000000000000000000bd95bfb69fbe6ce3', symbol: 'sUSDe',     name: 'sUSDe',                 decimals: 6  },
  '0x20c000000000000000000000ae247a1130450f09': { address: '0x20c000000000000000000000ae247a1130450f09', symbol: 'SBC',       name: 'SBC',                   decimals: 6  },
}

// These addresses are excluded from all analytics displays.
export const EXCLUDED_TOKENS = new Set([
  '0x20c00000000000000000000016c6514b53947fdc', // DONOTUSE — 18.4T supply, test/deprecated
])

// Whitelisted stablecoin / stable-FX addresses tracked by the stablecoins MV.
// Mirrors tokenlist.tempo.xyz/list/4217 (all 6-dec USD/EUR-denominated assets).
// Keep in sync with WHERE clauses in:
//   sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql
//   sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql
//   sql/clickhouse/backfills/stablecoins/mv_stablecoin_{daily,supply_daily}.sql
export const STABLECOIN_ADDRESSES = [
  '0x20c0000000000000000000000000000000000000', // pathUSD
  '0x20c000000000000000000000b9537d11c60e8b50', // USDC.e
  '0x20c0000000000000000000001621e21f71cf12fb', // EURC.e
  '0x20c00000000000000000000014f22ca97301eb73', // USDT0
  '0x20c0000000000000000000003554d28269e0f3c2', // frxUSD
  '0x20c0000000000000000000000520792dcccccccc', // cUSD
  '0x20c0000000000000000000008ee4fcff88888888', // stcUSD
  '0x20c0000000000000000000005c0bac7cef389a11', // GUSD
  '0x20c0000000000000000000007f7ba549dd0251b9', // rUSD
  '0x20c000000000000000000000aeed2ec36a54d0e5', // wsrUSD
  '0x20c0000000000000000000009a4a4b17e0dc6651', // EURAU
  '0x20c000000000000000000000383a23bacb546ab9', // reUSD
  '0x20c000000000000000000000ab02d39df30bd17e', // iUSD
  '0x20c000000000000000000000048c8f36df1c9a4a', // siUSD
  '0x20c0000000000000000000002f52d5cc21a3207b', // USDe
  '0x20c000000000000000000000bd95bfb69fbe6ce3', // sUSDe
  '0x20c000000000000000000000ae247a1130450f09', // SBC
]

const ERC20_ABI = [
  { name: 'symbol',   type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'name',     type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }],  stateMutability: 'view' },
] as const

export async function getTokenInfo(
  address: string,
  { skipRPC = false }: { skipRPC?: boolean } = {},
): Promise<TokenInfo | null> {
  const lower = address.toLowerCase()

  // 1. Instant local lookup (genesis/system tokens)
  const known = KNOWN_TOKENS[lower]
  if (known) return known

  // 2. Live tokenlist (verified tokens, 1h cache)
  const listed = await getTokenFromList(lower)
  if (listed) return listed

  // 3. Best-effort cache for previously RPC-fetched unknowns
  const cacheKey = `token:meta:${lower}`
  const cached = await getCached<TokenInfo>(cacheKey)
  if (cached) return cached

  // 4. RPC fallback for unknown contracts — skipped when caller doesn't need metadata
  //    for non-whitelisted tokens (e.g., pool explorer shows address anyway)
  if (skipRPC) return null
  try {
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'name' }),
      publicClient.readContract({ address: lower as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' }),
    ])
    const info: TokenInfo = { address: lower, symbol: symbol as string, name: name as string, decimals: decimals as number }
    await setCached(cacheKey, info, 86400)
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

const TOTAL_SUPPLY_ABI = [
  { name: 'totalSupply', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export async function getTokenSupply(address: string): Promise<bigint | null> {
  const lower = address.toLowerCase()
  const cacheKey = `token:supply:${lower}`
  const cached = await getCached<string>(cacheKey)
  if (cached) return BigInt(cached)

  try {
    const supply = await publicClient.readContract({
      address: lower as `0x${string}`,
      abi: TOTAL_SUPPLY_ABI,
      functionName: 'totalSupply',
    })
    await setCached(cacheKey, String(supply), 900) // 15 min
    return supply as bigint
  } catch {
    return null
  }
}
