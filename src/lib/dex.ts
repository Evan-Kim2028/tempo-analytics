import { getCached, setCached } from './cache'
import { publicClient } from './chain'
import { isVerifiedToken } from './tokenlist'

const PAIR_ABI = [
  { name: 'token0', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'token1', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

export interface PairInfo {
  pair: string
  token0: string
  token1: string
}

export async function getDexPairInfo(pair: string): Promise<PairInfo> {
  const lower = pair.toLowerCase()
  const cacheKey = `dex:pair:${lower}`
  const cached = await getCached<PairInfo>(cacheKey)
  if (cached) return cached

  const [token0, token1] = await Promise.all([
    publicClient.readContract({ address: lower as `0x${string}`, abi: PAIR_ABI, functionName: 'token0' }),
    publicClient.readContract({ address: lower as `0x${string}`, abi: PAIR_ABI, functionName: 'token1' }),
  ])

  const info: PairInfo = {
    pair: lower,
    token0: (token0 as string).toLowerCase(),
    token1: (token1 as string).toLowerCase(),
  }
  await setCached(cacheKey, info, 86400) // 24h — pair tokens never change
  return info
}

export async function isWhitelistedPair(token0: string, token1: string): Promise<boolean> {
  const [v0, v1] = await Promise.all([isVerifiedToken(token0), isVerifiedToken(token1)])
  return v0 || v1
}

export interface PairAmounts {
  token0: string
  token1: string
  amount0In: bigint
  amount1In: bigint
  amount0Out: bigint
  amount1Out: bigint
}

export async function computePairUsdVolume(amounts: PairAmounts): Promise<number | null> {
  const [v0, v1] = await Promise.all([
    isVerifiedToken(amounts.token0),
    isVerifiedToken(amounts.token1),
  ])

  if (!v0 && !v1) return null

  // Use the stablecoin side (all Tempo stablecoins are 6-decimal)
  if (v0) {
    return Number(amounts.amount0In + amounts.amount0Out) / 1e6
  } else {
    return Number(amounts.amount1In + amounts.amount1Out) / 1e6
  }
}
