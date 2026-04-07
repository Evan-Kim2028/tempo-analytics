// Direct ClickHouse HTTP client for analytics queries.
// The tidx API allowlist blocks ClickHouse-specific functions (toStartOfDay, uniq, countIf, etc.),
// so analytics queries go here instead of through queryTidx().

const CH_URL = process.env.CLICKHOUSE_URL ?? 'http://clickhouse:8123'
const CH_DB = 'tidx_4217'

export async function queryClickHouse<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const url = `${CH_URL}/?database=${CH_DB}&query=${encodeURIComponent(sql + ' FORMAT JSON')}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ClickHouse error: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.data as T[]
}
