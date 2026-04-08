import { queryClickHouse } from './clickhouse'
import { getCached, setCached } from './cache'

export interface InscriptionData {
  p: string
  op: string
  tick: string
  amt?: string
  max?: string
  lim?: string
}

export function parseInscriptionInput(input: string): InscriptionData | null {
  if (!input || input === '0x' || !input.toLowerCase().startsWith('0x7b')) return null
  try {
    const raw = Buffer.from(input.slice(2), 'hex').toString('utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    if (parsed.tick) parsed.tick = String(parsed.tick).toUpperCase()
    return parsed as InscriptionData
  } catch {
    return null
  }
}

export interface InscriptionTotals {
  tick: string
  mints: number
}

export interface DailyInscriptionStat {
  day: string
  op: string
  tick: string
  count: number
}

export async function getInscriptionTotals(): Promise<InscriptionTotals[]> {
  const key = 'analytics:inscriptions:totals'
  const cached = await getCached<InscriptionTotals[]>(key)
  if (cached) return cached

  const rows = await queryClickHouse<{ tick: string; mints: string }>(`
    SELECT tick, sum(count) AS mints
    FROM mv_inscription_daily
    WHERE op = 'mint' AND tick != ''
    GROUP BY tick
    ORDER BY mints DESC
    LIMIT 10
  `)

  const result = rows.map(r => ({ tick: r.tick, mints: Number(r.mints) }))
  await setCached(key, result, 900)
  return result
}

export async function getDailyInscriptionStats(days = 30): Promise<DailyInscriptionStat[]> {
  const key = `analytics:inscriptions:daily:${days}`
  const cached = await getCached<DailyInscriptionStat[]>(key)
  if (cached) return cached

  // Get top 5 tickers by all-time mint volume to constrain the chart
  const topTickers = await queryClickHouse<{ tick: string }>(`
    SELECT tick FROM mv_inscription_daily
    WHERE op = 'mint' AND tick != ''
    GROUP BY tick ORDER BY sum(count) DESC LIMIT 5
  `)
  const tickers = topTickers
    .map(r => r.tick)
    .filter(t => /^[A-Z0-9]{1,12}$/.test(t))
    .map(t => `'${t}'`)
    .join(', ')

  const rows = await queryClickHouse<{
    day: string; op: string; tick: string; count: string
  }>(`
    SELECT day, op, tick, sum(count) AS count
    FROM mv_inscription_daily
    WHERE day >= today() - ${days}
      AND op IN ('mint', 'deploy', 'list', 'buy')
      AND tick IN (${tickers || "''"})
    GROUP BY day, op, tick
    ORDER BY day ASC, count DESC
  `)

  const result = rows.map(r => ({
    day: String(r.day).slice(0, 10),
    op: r.op,
    tick: r.tick,
    count: Number(r.count),
  }))

  await setCached(key, result, 900)
  return result
}
