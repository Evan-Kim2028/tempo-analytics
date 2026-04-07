import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'

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
