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

  const rows = await queryClickHouse<DailyStat>(`
    SELECT
      toStartOfDay(block_timestamp) as day,
      count() as txs,
      uniq(from) as unique_senders,
      countIf(call_count > 1) as batch_txs,
      countIf(fee_payer != from) as sponsored_txs
    FROM txs
    WHERE block_timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY day
    ORDER BY day ASC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    txs: Number(r.txs),
    unique_senders: Number(r.unique_senders),
    batch_txs: Number(r.batch_txs),
    sponsored_txs: Number(r.sponsored_txs),
  }))

  await setCached(key, result, 900) // 15 min
  return result
}

export async function getSignatureTypeStats(): Promise<SigTypeStat[]> {
  const key = 'analytics:sig_types'
  const cached = await getCached<SigTypeStat[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ signature_type: number | null; txs: string }>(`
    SELECT signature_type, count() as txs
    FROM txs
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

export async function getNetworkSummary(): Promise<NetworkSummary> {
  const key = 'analytics:summary'
  const cached = await getCached<NetworkSummary>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{
    total_txs: string; total_addresses: string
    contract_deployments: string; batch_txs: string; sponsored_txs: string
  }>(`
    SELECT
      count() as total_txs,
      uniq(from) as total_addresses,
      countIf(to IS NULL) as contract_deployments,
      countIf(call_count > 1) as batch_txs,
      countIf(fee_payer != from) as sponsored_txs
    FROM txs
  `)

  const r = rows[0]
  const result: NetworkSummary = {
    total_txs: Number(r.total_txs),
    total_addresses: Number(r.total_addresses),
    contract_deployments: Number(r.contract_deployments),
    batch_txs: Number(r.batch_txs),
    sponsored_txs: Number(r.sponsored_txs),
  }

  await setCached(key, result, 900)
  return result
}
