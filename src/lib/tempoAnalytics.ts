import { getCached, setCached } from '@/lib/cache'
import { queryClickHouse } from '@/lib/clickhouse'
import { KNOWN_TOKENS } from '@/lib/tokens'

const CACHE_TTL_SECONDS = 900

export const USDC_E = '0x20c000000000000000000000b9537d11c60e8b50'
export const PATH_USD = '0x20c0000000000000000000000000000000000000'

function sliceDay(day: string): string {
  return String(day).slice(0, 10)
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0)
}

export function labelFeeToken(address: string): string {
  const lower = address.toLowerCase()
  const known = KNOWN_TOKENS[lower]
  if (known) return known.symbol
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`
}

async function getCachedQuery<T>(
  key: string,
  query: () => Promise<T[]>
): Promise<T[]> {
  const cached = await getCached<T[]>(key)
  if (cached !== null) return cached

  const rows = await query()
  await setCached(key, rows, CACHE_TTL_SECONDS)
  return rows
}

export interface TempoTxSharePoint {
  day: string
  tempo_txs: number
  total_txs: number
  tempo_pct: number
}

export interface TempoFeatureAdoptionPoint {
  day: string
  total_txs: number
  sponsored_txs: number
  batched_txs: number
  time_bounded_txs: number
  fee_token_set_txs: number
  sponsored_pct: number
  batched_pct: number
  time_bounded_pct: number
  fee_token_set_pct: number
}

export interface FeeTokenMixPoint {
  day: string
  fee_token: string
  txs: number
  pct_of_day: number
}

export interface SponsorConcentrationPoint {
  day: string
  sponsored_txs: number
  top1_pct: number
  top5_pct: number
  sponsor_count: number
}

export interface TopSponsorRow {
  sponsor: string
  sponsored_txs: number
  unique_users_sponsored: number
  first_seen: string
  last_seen: string
}

export interface WebauthnUsagePoint {
  day: string
  webauthn_txs: number
  webauthn_pct_of_tempo: number
}

export async function getTempoTxShareByDay(days = 30): Promise<TempoTxSharePoint[]> {
  const key = `tempo-analytics:tx-share:${days}`
  return getCachedQuery(key, async () => {
    const rows = await queryClickHouse<{
      day: string
      tempo_txs: string
      total_txs: string
      tempo_pct: string
    }>(`
      SELECT
        day,
        tempo_txs,
        total_txs,
        round(tempo_txs * 100.0 / total_txs, 2) AS tempo_pct
      FROM (
        SELECT
          toDate(block_timestamp) AS day,
          countIf(type = 118) AS tempo_txs,
          count() AS total_txs
        FROM tidx_4217.txs
        WHERE block_timestamp >= now() - INTERVAL ${days} DAY
        GROUP BY day
      )
      ORDER BY day ASC
    `)

    return rows.map(row => ({
      day: sliceDay(row.day),
      tempo_txs: toNumber(row.tempo_txs),
      total_txs: toNumber(row.total_txs),
      tempo_pct: toNumber(row.tempo_pct),
    }))
  })
}

export async function getTempoFeatureAdoptionByDay(days = 30): Promise<TempoFeatureAdoptionPoint[]> {
  const key = `tempo-analytics:feature-adoption:${days}`
  return getCachedQuery(key, async () => {
    const rows = await queryClickHouse<{
      day: string
      total_txs: string
      sponsored_txs: string
      batched_txs: string
      time_bounded_txs: string
      fee_token_set_txs: string
    }>(`
      SELECT
        day,
        total_txs,
        sponsored_txs,
        batched_txs,
        time_bounded_txs,
        fee_token_set_txs
      FROM (
        SELECT
          toDate(block_timestamp) AS day,
          countIf(type = 118) AS total_txs,
          countIf(type = 118 AND fee_payer IS NOT NULL AND fee_payer != "from") AS sponsored_txs,
          countIf(type = 118 AND call_count > 1) AS batched_txs,
          countIf(type = 118 AND valid_before IS NOT NULL AND valid_after IS NOT NULL) AS time_bounded_txs,
          countIf(type = 118 AND fee_token IS NOT NULL) AS fee_token_set_txs
        FROM tidx_4217.txs
        WHERE block_timestamp >= now() - INTERVAL ${days} DAY
        GROUP BY day
      )
      ORDER BY day ASC
    `)

    return rows.map(row => {
      const total = Math.max(toNumber(row.total_txs), 1)
      return {
        day: sliceDay(row.day),
        total_txs: toNumber(row.total_txs),
        sponsored_txs: toNumber(row.sponsored_txs),
        batched_txs: toNumber(row.batched_txs),
        time_bounded_txs: toNumber(row.time_bounded_txs),
        fee_token_set_txs: toNumber(row.fee_token_set_txs),
        sponsored_pct: Number(((toNumber(row.sponsored_txs) * 100) / total).toFixed(2)),
        batched_pct: Number(((toNumber(row.batched_txs) * 100) / total).toFixed(2)),
        time_bounded_pct: Number(((toNumber(row.time_bounded_txs) * 100) / total).toFixed(2)),
        fee_token_set_pct: Number(((toNumber(row.fee_token_set_txs) * 100) / total).toFixed(2)),
      }
    })
  })
}

export async function getFeeTokenMixByDay(days = 30): Promise<FeeTokenMixPoint[]> {
  const key = `tempo-analytics:fee-token-mix-v2:${days}`
  return getCachedQuery(key, async () => {
    const rows = await queryClickHouse<{
      day: string
      fee_token: string
      txs: string
      pct_of_day: string
    }>(`
      SELECT
        day,
        fee_token,
        txs,
        round(txs * 100.0 / sum(txs) OVER (PARTITION BY day), 2) AS pct_of_day
      FROM (
        SELECT
          toDate(block_timestamp) AS day,
          lower(fee_token) AS fee_token,
          count() AS txs
        FROM tidx_4217.txs
        WHERE block_timestamp >= now() - INTERVAL ${days} DAY
          AND type = 118
          AND fee_token IS NOT NULL
        GROUP BY day, fee_token
      )
      ORDER BY day ASC, txs DESC
    `)

    return rows.map(row => ({
      day: sliceDay(row.day),
      fee_token: labelFeeToken(row.fee_token),
      txs: toNumber(row.txs),
      pct_of_day: toNumber(row.pct_of_day),
    }))
  })
}

export interface FeeTokenMixChartData {
  /** One record per day; keys are fee-token labels + 'day' */
  rows:   Array<Record<string, string | number>>
  /** Token labels ordered by first appearance (most-used first per ClickHouse sort) */
  tokens: string[]
}

export async function getFeeTokenMixChartData(days = 30): Promise<FeeTokenMixChartData> {
  const key = `tempo-analytics:fee-token-mix-chart-v2:${days}`
  const cached = await getCached<FeeTokenMixChartData>(key)
  if (cached !== null) return cached

  const points = await getFeeTokenMixByDay(days)

  const rowsByDay = new Map<string, Record<string, string | number>>()
  const tokens: string[] = []

  for (const point of points) {
    if (!tokens.includes(point.fee_token)) tokens.push(point.fee_token)
    const row = rowsByDay.get(point.day) ?? { day: point.day }
    row[point.fee_token] = point.pct_of_day
    rowsByDay.set(point.day, row)
  }

  const result: FeeTokenMixChartData = {
    rows:   Array.from(rowsByDay.values()),
    tokens,
  }
  await setCached(key, result, CACHE_TTL_SECONDS)
  return result
}

export async function getSponsorConcentrationByDay(
  days = 30,
  minSponsored = 100
): Promise<SponsorConcentrationPoint[]> {
  const key = `tempo-analytics:sponsor-concentration:${days}:${minSponsored}`
  return getCachedQuery(key, async () => {
    const rows = await queryClickHouse<{
      day: string
      sponsored_txs: string
      top1_pct: string
      top5_pct: string
      sponsor_count: string
    }>(`
      WITH daily_sponsors AS (
        SELECT
          toDate(block_timestamp) AS day,
          concat('0x', lower(hex(fee_payer))) AS sponsor,
          count() AS sponsor_txs
        FROM tidx_4217.txs
        WHERE block_timestamp >= now() - INTERVAL ${days} DAY
          AND type = 118
          AND fee_payer IS NOT NULL
          AND fee_payer != "from"
        GROUP BY day, sponsor
      )
      SELECT
        day,
        sum(sponsor_txs) AS sponsored_txs,
        round(max(sponsor_txs) * 100.0 / sum(sponsor_txs), 2) AS top1_pct,
        round(sumIf(sponsor_txs, rn <= 5) * 100.0 / sum(sponsor_txs), 2) AS top5_pct,
        count() AS sponsor_count
      FROM (
        SELECT
          day,
          sponsor,
          sponsor_txs,
          row_number() OVER (PARTITION BY day ORDER BY sponsor_txs DESC) AS rn
        FROM daily_sponsors
      )
      GROUP BY day
      ORDER BY day ASC
    `)

    return rows
      .map(row => ({
        day: sliceDay(row.day),
        sponsored_txs: toNumber(row.sponsored_txs),
        top1_pct: toNumber(row.top1_pct),
        top5_pct: toNumber(row.top5_pct),
        sponsor_count: toNumber(row.sponsor_count),
      }))
      .filter(row => row.sponsored_txs >= minSponsored)
  })
}

export async function getTopSponsors(limit = 10): Promise<TopSponsorRow[]> {
  const key = `tempo-analytics:top-sponsors:${limit}`
  return getCachedQuery(key, async () => {
    const rows = await queryClickHouse<{
      sponsor: string
      sponsored_txs: string
      unique_users_sponsored: string
      first_seen: string
      last_seen: string
    }>(`
      SELECT
        concat('0x', lower(hex(fee_payer))) AS sponsor,
        count() AS sponsored_txs,
        uniqExact("from") AS unique_users_sponsored,
        min(block_timestamp) AS first_seen,
        max(block_timestamp) AS last_seen
      FROM tidx_4217.txs
      WHERE type = 118
        AND fee_payer IS NOT NULL
        AND fee_payer != "from"
      GROUP BY sponsor
      ORDER BY sponsored_txs DESC
      LIMIT ${limit}
    `)

    return rows.map(row => ({
      sponsor: row.sponsor,
      sponsored_txs: toNumber(row.sponsored_txs),
      unique_users_sponsored: toNumber(row.unique_users_sponsored),
      first_seen: String(row.first_seen),
      last_seen: String(row.last_seen),
    }))
  })
}

export async function getWebauthnUsageByDay(days = 30): Promise<WebauthnUsagePoint[]> {
  const key = `tempo-analytics:webauthn-usage:${days}`
  return getCachedQuery(key, async () => {
    const rows = await queryClickHouse<{
      day: string
      webauthn_txs: string
      webauthn_pct_of_tempo: string
    }>(`
      SELECT
        day,
        webauthn_txs,
        if(total_tempo_txs = 0, 0, round(webauthn_txs * 100.0 / total_tempo_txs, 2)) AS webauthn_pct_of_tempo
      FROM (
        SELECT
          toDate(block_timestamp) AS day,
          countIf(type = 118) AS total_tempo_txs,
          countIf(type = 118 AND signature_type = 2) AS webauthn_txs
        FROM tidx_4217.txs
        WHERE block_timestamp >= now() - INTERVAL ${days} DAY
        GROUP BY day
      )
      ORDER BY day ASC
    `)

    return rows.map(row => ({
      day: sliceDay(row.day),
      webauthn_txs: toNumber(row.webauthn_txs),
      webauthn_pct_of_tempo: toNumber(row.webauthn_pct_of_tempo),
    }))
  })
}
