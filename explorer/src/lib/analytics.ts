import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'
import { STABLECOIN_ADDRESSES } from './tokens'

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
  const key = `analytics:stablecoins:${days}`
  const cached = await getCached<StablecoinDailyStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    day: string; token: string; volume_u6: string; transfers: string
  }>(`
    SELECT day, token, sum(volume_u6) AS volume_u6, sum(transfers) AS transfers
    FROM mv_stablecoin_daily
    WHERE day >= today() - ${days}
    GROUP BY day, token
    ORDER BY day ASC, token ASC
  `)

  const byDay = new Map<string, StablecoinDailyStat>()
  for (const r of rows) {
    const day = String(r.day).slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, { day, pathUSD_volume: 0, usdc_e_volume: 0, pathUSD_transfers: 0, usdc_e_transfers: 0 })
    const stat = byDay.get(day)!
    if (r.token === STABLECOIN_ADDRESSES[0]) {
      stat.pathUSD_volume = Number(r.volume_u6) / 1e6
      stat.pathUSD_transfers = Number(r.transfers)
    } else {
      stat.usdc_e_volume = Number(r.volume_u6) / 1e6
      stat.usdc_e_transfers = Number(r.transfers)
    }
  }

  const result = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
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
