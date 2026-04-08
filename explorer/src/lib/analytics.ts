import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'
import { getTokenInfo, getTokenSupply } from './tokens'
import { getStablecoinAddresses } from './tokenlist'
import { getDexPairInfo, computePairUsdVolume } from './dex'

export interface DailyStat {
  day: string
  txs: number
  unique_senders: number
  batch_txs: number
  sponsored_txs: number
}

export interface SigTypeStat {
  signature_type: number | null
  txs: number
}

export interface FeeTokenStat {
  fee_token: string | null
  txs: number
}

export interface NetworkSummary {
  total_txs: number
  total_addresses: number
  contract_deployments: number
  batch_txs: number
  sponsored_txs: number
}

export async function getDailyStats(days = 30): Promise<DailyStat[]> {
  const key = `analytics:daily:${days}`
  const cached = await getCached<DailyStat[]>(key)
  if (cached) return cached

  // Join mv_daily_stats (SummingMergeTree) with mv_daily_uniq (AggregatingMergeTree)
  const rows = await queryClickHouse<{
    day: string; txs: string; unique_senders: string
    batch_txs: string; sponsored_txs: string
  }>(`
    SELECT
      s.day                             AS day,
      sum(s.txs)                        AS txs,
      uniqMerge(u.unique_senders_state) AS unique_senders,
      sum(s.batch_txs)                  AS batch_txs,
      sum(s.sponsored_txs)              AS sponsored_txs
    FROM mv_daily_stats s
    ANY LEFT JOIN (
      SELECT day, uniqMerge(unique_senders_state) AS unique_senders_state
      FROM mv_daily_uniq
      GROUP BY day
    ) u ON s.day = u.day
    WHERE s.day >= today() - ${days}
    GROUP BY s.day
    ORDER BY s.day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    txs: Number(r.txs),
    unique_senders: Number(r.unique_senders),
    batch_txs: Number(r.batch_txs),
    sponsored_txs: Number(r.sponsored_txs),
  }))

  await setCached(key, result, 900)
  return result
}

export async function getSignatureTypeStats(): Promise<SigTypeStat[]> {
  const key = 'analytics:sig_types'
  const cached = await getCached<SigTypeStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ signature_type: number | null; txs: string }>(`
    SELECT signature_type, count() as txs
    FROM txs
    WHERE block_timestamp >= now() - INTERVAL 90 DAY
    GROUP BY signature_type
    ORDER BY txs DESC
  `)

  const result = rows.map(r => ({
    signature_type: r.signature_type,
    txs: Number(r.txs),
  }))

  await setCached(key, result, 900)
  return result
}

export async function getFeeTokenStats(): Promise<FeeTokenStat[]> {
  const key = 'analytics:fee_tokens'
  const cached = await getCached<FeeTokenStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ fee_token: string | null; txs: string }>(`
    SELECT fee_token, count() as txs
    FROM txs
    GROUP BY fee_token
    ORDER BY txs DESC
    LIMIT 10
  `)

  const result = rows.map(r => ({
    fee_token: r.fee_token,
    txs: Number(r.txs),
  }))

  await setCached(key, result, 900)
  return result
}

export interface DailyStatCategorized {
  day: string
  user_txs: number
  protocol_txs: number
  inscription_txs: number
}

export async function getNetworkSummary(): Promise<NetworkSummary> {
  const key = 'analytics:summary'
  const cached = await getCached<NetworkSummary>(key)
  if (cached) return cached

  const [statsRows, uniqRows, receiptRows] = await Promise.all([
    queryClickHouse<{
      total_txs: string; batch_txs: string; sponsored_txs: string
      inscription_txs: string
    }>(`
      SELECT
        sum(txs)               AS total_txs,
        sum(batch_txs)         AS batch_txs,
        sum(sponsored_txs)     AS sponsored_txs,
        sum(inscription_txs)   AS inscription_txs
      FROM mv_daily_stats
    `),
    queryClickHouse<{ total_addresses: string }>(`
      SELECT uniqMerge(unique_senders_state) AS total_addresses
      FROM mv_daily_uniq
    `),
    // contract deploys not in mv_daily_stats — small full scan (32K rows) is acceptable
    queryClickHouse<{ contract_deployments: string }>(`
      SELECT countIf(to IS NULL) AS contract_deployments FROM txs
    `),
  ])

  const s = statsRows[0]
  const result: NetworkSummary = {
    total_txs: Number(s.total_txs),
    total_addresses: Number(uniqRows[0].total_addresses),
    contract_deployments: Number(receiptRows[0].contract_deployments),
    batch_txs: Number(s.batch_txs),
    sponsored_txs: Number(s.sponsored_txs),
  }

  await setCached(key, result, 900)
  return result
}

export async function getDailyStatsCategorized(days = 30): Promise<DailyStatCategorized[]> {
  const key = `analytics:categorized:${days}`
  const cached = await getCached<DailyStatCategorized[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; user_txs: string; protocol_txs: string; inscription_txs: string
  }>(`
    SELECT
      day,
      sum(user_txs)        AS user_txs,
      sum(protocol_txs)    AS protocol_txs,
      sum(inscription_txs) AS inscription_txs
    FROM mv_daily_stats
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    user_txs: Number(r.user_txs),
    protocol_txs: Number(r.protocol_txs),
    inscription_txs: Number(r.inscription_txs),
  }))

  await setCached(key, result, 900)
  return result
}

// ─── Stablecoin ──────────────────────────────────────────────────
export interface StablecoinDailyStat {
  day: string
  pathUSD_volume: number   // USD (6-decimal normalized)
  usdc_e_volume: number
  pathUSD_transfers: number
  usdc_e_transfers: number
}

export async function getStablecoinDailyVolume(days = 30): Promise<StablecoinDailyStat[]> {
  const key = `analytics:stablecoins:v2:${days}`
  const cached = await getCached<StablecoinDailyStat[]>(key)
  if (cached) return cached

  const stableAddrs = await getStablecoinAddresses()
  if (stableAddrs.length === 0) return []

  const addrList = stableAddrs.map(a => `'${a}'`).join(', ')

  const rows = await queryClickHouse<{
    day: string; token: string; volume_raw: string; transfers: string
  }>(`
    SELECT day, token, sum(volume_raw) AS volume_raw, sum(transfers) AS transfers
    FROM mv_erc20_volume_daily
    WHERE day >= today() - ${days}
      AND token IN (${addrList})
    GROUP BY day, token
    ORDER BY day ASC, token ASC
  `)

  // Group by day, then by token within each day
  const byDay = new Map<string, StablecoinDailyStat>()
  for (const r of rows) {
    const day = String(r.day).slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, {
      day,
      pathUSD_volume: 0, usdc_e_volume: 0,
      pathUSD_transfers: 0, usdc_e_transfers: 0,
    })
    const stat = byDay.get(day)!
    if (r.token === stableAddrs[0]) {
      stat.pathUSD_volume = Number(r.volume_raw) / 1e6
      stat.pathUSD_transfers = Number(r.transfers)
    } else if (r.token === stableAddrs[1]) {
      stat.usdc_e_volume = Number(r.volume_raw) / 1e6
      stat.usdc_e_transfers = Number(r.transfers)
    }
  }

  const result = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  await setCached(key, result, 900)
  return result
}

export interface StablecoinStat {
  address: string
  symbol: string
  name: string
  supply: number | null        // USD (6-decimal normalized), null if RPC failed
  volume_24h: number
  volume_7d: number
  volume_30d: number
  transfers_30d: number
  fee_txs_30d: number
}

export async function getStablecoinStats(): Promise<StablecoinStat[]> {
  const key = 'analytics:stablecoin:stats'
  const cached = await getCached<StablecoinStat[]>(key)
  if (cached) return cached

  const stableAddrs = await getStablecoinAddresses()
  if (stableAddrs.length === 0) return []

  const addrList = stableAddrs.map(a => `'${a}'`).join(', ')

  const [volumeRows, feeRows, supplies, tokenInfos] = await Promise.all([
    queryClickHouse<{ token: string; vol_1d: string; vol_7d: string; vol_30d: string; transfers_30d: string }>(`
      SELECT token,
        sumIf(volume_raw, day >= today() - 1)  AS vol_1d,
        sumIf(volume_raw, day >= today() - 7)  AS vol_7d,
        sumIf(volume_raw, day >= today() - 30) AS vol_30d,
        sumIf(transfers,  day >= today() - 30) AS transfers_30d
      FROM mv_erc20_volume_daily
      WHERE token IN (${addrList})
      GROUP BY token
    `),
    queryClickHouse<{ fee_token: string; txs: string }>(`
      SELECT fee_token, sum(txs) AS txs
      FROM mv_fee_token_daily
      WHERE day >= today() - 30
        AND fee_token IN (${addrList})
      GROUP BY fee_token
    `),
    Promise.all(stableAddrs.map(a => getTokenSupply(a))),
    Promise.all(stableAddrs.map(a => getTokenInfo(a))),
  ])

  const volByToken = new Map(volumeRows.map(r => [r.token, r]))
  const feeByToken = new Map(feeRows.map(r => [r.fee_token, Number(r.txs)]))

  const result: StablecoinStat[] = stableAddrs.map((addr, i) => {
    const v = volByToken.get(addr)
    const info = tokenInfos[i]
    const rawSupply = supplies[i]
    return {
      address: addr,
      symbol: info?.symbol ?? addr.slice(-8),
      name: info?.name ?? 'Unknown',
      supply: rawSupply !== null ? Number(rawSupply) / 1e6 : null,
      volume_24h: v ? Number(v.vol_1d) / 1e6 : 0,
      volume_7d: v ? Number(v.vol_7d) / 1e6 : 0,
      volume_30d: v ? Number(v.vol_30d) / 1e6 : 0,
      transfers_30d: v ? Number(v.transfers_30d) : 0,
      fee_txs_30d: feeByToken.get(addr) ?? 0,
    }
  })

  await setCached(key, result, 900)
  return result
}

// ─── DEX ─────────────────────────────────────────────────────────
export interface DexDailyStat {
  day: string
  total_swaps: number
}

export async function getDexDailyActivity(days = 30): Promise<DexDailyStat[]> {
  const key = `analytics:dex:${days}`
  const cached = await getCached<DexDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ day: string; total_swaps: string }>(`
    SELECT day, sum(swap_count) AS total_swaps
    FROM mv_dex_daily
    WHERE day >= today() - ${days}
    GROUP BY day ORDER BY day ASC
  `)

  const result = rows.map(r => ({ day: String(r.day).slice(0, 10), total_swaps: Number(r.total_swaps) }))
  await setCached(key, result, 900)
  return result
}

export interface TopDexPair {
  pair: string
  total_swaps: number
}

export async function getTopDexPairs(limit = 10): Promise<TopDexPair[]> {
  const key = `analytics:dex:pairs:${limit}`
  const cached = await getCached<TopDexPair[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ pair: string; total_swaps: string }>(`
    SELECT pair, sum(swap_count) AS total_swaps
    FROM mv_dex_daily
    GROUP BY pair ORDER BY total_swaps DESC LIMIT ${limit}
  `)

  const result = rows.map(r => ({ pair: r.pair, total_swaps: Number(r.total_swaps) }))
  await setCached(key, result, 3600)
  return result
}

// ─── NFT ─────────────────────────────────────────────────────────
export interface TopNFTCollection {
  collection: string
  total_transfers: number
  days_active: number
}

export async function getTopNFTCollections(limit = 10): Promise<TopNFTCollection[]> {
  const key = `analytics:nft:top:${limit}`
  const cached = await getCached<TopNFTCollection[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    collection: string; total_transfers: string; days_active: string
  }>(`
    SELECT
      collection,
      sum(transfers)     AS total_transfers,
      uniq(day)          AS days_active
    FROM mv_nft_daily
    GROUP BY collection
    ORDER BY total_transfers DESC
    LIMIT ${limit}
  `)

  const result = rows.map(r => ({
    collection: r.collection,
    total_transfers: Number(r.total_transfers),
    days_active: Number(r.days_active),
  }))
  await setCached(key, result, 3600)
  return result
}

export interface NftDailyStat {
  day: string
  transfers: number
  active_collections: number
}

export async function getNFTDailyActivity(days = 30): Promise<NftDailyStat[]> {
  const key = `analytics:nft:daily:${days}`
  const cached = await getCached<NftDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; transfers: string; active_collections: string
  }>(`
    SELECT day, sum(transfers) AS transfers, uniq(collection) AS active_collections
    FROM mv_nft_daily
    WHERE day >= today() - ${days}
    GROUP BY day ORDER BY day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    transfers: Number(r.transfers),
    active_collections: Number(r.active_collections),
  }))
  await setCached(key, result, 900)
  return result
}

// ─── DEX USD Volume ───────────────────────────────────────────────
export interface DexDailyVolumeUSD {
  day: string
  volume_usd: number
  swap_count: number
}

export async function getDexDailyVolumeUSD(days = 30): Promise<DexDailyVolumeUSD[]> {
  const key = `analytics:dex:volume_usd:${days}`
  const cached = await getCached<DexDailyVolumeUSD[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; pair: string
    amount0In: string; amount1In: string; amount0Out: string; amount1Out: string
    swap_count: string
  }>(`
    SELECT day, pair,
      sum(amount0In) AS amount0In, sum(amount1In) AS amount1In,
      sum(amount0Out) AS amount0Out, sum(amount1Out) AS amount1Out,
      sum(swap_count) AS swap_count
    FROM mv_dex_swap_amounts_daily
    WHERE day >= today() - ${days}
    GROUP BY day, pair
    ORDER BY day ASC
  `)

  const uniquePairs = [...new Set(rows.map(r => r.pair))]
  const pairInfoMap = new Map<string, Awaited<ReturnType<typeof getDexPairInfo>>>()
  await Promise.all(uniquePairs.map(async p => {
    try { pairInfoMap.set(p, await getDexPairInfo(p)) } catch { /* skip invalid pairs */ }
  }))

  const byDay = new Map<string, { volume_usd: number; swap_count: number }>()

  for (const r of rows) {
    const info = pairInfoMap.get(r.pair)
    if (!info) continue

    const usdVol = await computePairUsdVolume({
      token0: info.token0,
      token1: info.token1,
      amount0In: BigInt(r.amount0In),
      amount1In: BigInt(r.amount1In),
      amount0Out: BigInt(r.amount0Out),
      amount1Out: BigInt(r.amount1Out),
    })
    if (usdVol === null) continue

    const day = String(r.day).slice(0, 10)
    const existing = byDay.get(day) ?? { volume_usd: 0, swap_count: 0 }
    byDay.set(day, {
      volume_usd: existing.volume_usd + usdVol,
      swap_count: existing.swap_count + Number(r.swap_count),
    })
  }

  const result: DexDailyVolumeUSD[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }))

  await setCached(key, result, 900)
  return result
}

export interface PoolStat {
  pair: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  swaps_30d: number
  volume_usd_30d: number
}

export async function getTopPools(limit = 10): Promise<PoolStat[]> {
  const key = `analytics:dex:pools:${limit}`
  const cached = await getCached<PoolStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    pair: string; amount0In: string; amount1In: string
    amount0Out: string; amount1Out: string; swap_count: string
  }>(`
    SELECT pair,
      sum(amount0In) AS amount0In, sum(amount1In) AS amount1In,
      sum(amount0Out) AS amount0Out, sum(amount1Out) AS amount1Out,
      sum(swap_count) AS swap_count
    FROM mv_dex_swap_amounts_daily
    WHERE day >= today() - 30
    GROUP BY pair
    ORDER BY swap_count DESC
    LIMIT ${limit * 2}
  `)

  const pools: PoolStat[] = []
  for (const r of rows) {
    if (pools.length >= limit) break
    try {
      const info = await getDexPairInfo(r.pair)
      const usdVol = await computePairUsdVolume({
        token0: info.token0, token1: info.token1,
        amount0In: BigInt(r.amount0In), amount1In: BigInt(r.amount1In),
        amount0Out: BigInt(r.amount0Out), amount1Out: BigInt(r.amount1Out),
      })
      if (usdVol === null) continue

      const [t0info, t1info] = await Promise.all([
        getTokenInfo(info.token0),
        getTokenInfo(info.token1),
      ])
      pools.push({
        pair: r.pair,
        token0: info.token0,
        token1: info.token1,
        token0Symbol: t0info?.symbol ?? info.token0.slice(-8),
        token1Symbol: t1info?.symbol ?? info.token1.slice(-8),
        swaps_30d: Number(r.swap_count),
        volume_usd_30d: usdVol,
      })
    } catch { /* skip pairs that fail RPC resolution */ }
  }

  await setCached(key, pools, 3600)
  return pools
}

export interface FeeTokenDailyStat {
  day: string
  usdc_e: number    // tx count using USDC.e as fee token
  pathusd: number   // tx count using pathUSD as fee token
  others: number    // tx count using other tokens
  total: number
}

export async function getFeeTokenDailyStats(days = 30): Promise<FeeTokenDailyStat[]> {
  const key = `analytics:fee_token_daily:${days}`
  const cached = await getCached<FeeTokenDailyStat[]>(key)
  if (cached) return cached

  const USDC_E = '0x20c000000000000000000000b9537d11c60e8b50'
  const PATHUSD = '0x20c0000000000000000000000000000000000000'

  const rows = await queryClickHouse<{
    day: string; usdc_e: string; pathusd: string; others: string
  }>(`
    SELECT
      day,
      sumIf(txs, fee_token = '${USDC_E}')  AS usdc_e,
      sumIf(txs, fee_token = '${PATHUSD}') AS pathusd,
      sumIf(txs, fee_token NOT IN ('${USDC_E}', '${PATHUSD}')) AS others
    FROM mv_fee_token_daily
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const result: FeeTokenDailyStat[] = rows.map(r => {
    const usdc_e = Number(r.usdc_e)
    const pathusd = Number(r.pathusd)
    const others = Number(r.others)
    return { day: String(r.day).slice(0, 10), usdc_e, pathusd, others, total: usdc_e + pathusd + others }
  })

  await setCached(key, result, 900)
  return result
}

export interface ProtocolDexDailyStat {
  day: string
  swaps: number
  volume_usd: number
}

export async function getProtocolDexDailyStats(days = 30): Promise<ProtocolDexDailyStat[]> {
  const key = `analytics:protocol_dex:${days}`
  const cached = await getCached<ProtocolDexDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; swaps: string; volume_raw: string
  }>(`
    SELECT day, sum(swaps) AS swaps, sum(volume_raw) AS volume_raw
    FROM mv_protocol_dex_daily
    WHERE day >= today() - ${days}
    GROUP BY day
    ORDER BY day ASC
  `)

  const result: ProtocolDexDailyStat[] = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    swaps: Number(r.swaps),
    volume_usd: Number(r.volume_raw) / 1e6,
  }))

  await setCached(key, result, 900)
  return result
}
