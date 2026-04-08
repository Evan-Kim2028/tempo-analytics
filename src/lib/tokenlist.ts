import { getCached, setCached } from './cache'
import { KNOWN_TOKENS, type TokenInfo } from './tokens'

const TOKENLIST_URL = 'https://tokenlist.tempo.xyz/list/4217'
const CACHE_KEY = 'tokenlist:4217'
const CACHE_TTL = 3600 // 1 hour

export async function getVerifiedTokens(): Promise<TokenInfo[]> {
  const cached = await getCached<TokenInfo[]>(CACHE_KEY)
  if (cached) return cached

  try {
    const res = await fetch(TOKENLIST_URL, { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`tokenlist HTTP ${res.status}`)
    const data = await res.json() as { tokens: Array<{ address: string; symbol: string; name: string; decimals: number }> }

    const tokens: TokenInfo[] = data.tokens.map(t => ({
      address: t.address.toLowerCase(),
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
    }))

    await setCached(CACHE_KEY, tokens, CACHE_TTL)
    return tokens
  } catch {
    // Fallback: return KNOWN_TOKENS as array
    return Object.values(KNOWN_TOKENS)
  }
}

export async function getTokenFromList(address: string): Promise<TokenInfo | null> {
  const lower = address.toLowerCase()
  const tokens = await getVerifiedTokens()
  return tokens.find(t => t.address === lower) ?? null
}

export async function isVerifiedToken(address: string): Promise<boolean> {
  return (await getTokenFromList(address)) !== null
}

export async function getStablecoinAddresses(): Promise<string[]> {
  // All tokens in the verified list are stablecoins on Tempo Mainnet
  const tokens = await getVerifiedTokens()
  return tokens.map(t => t.address)
}
