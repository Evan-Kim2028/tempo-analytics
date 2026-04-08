export type TidxRow = Record<string, string | number | null>

export interface TidxQueryResult {
  rows: TidxRow[]
  row_count: number
  engine: string
  query_time_ms: number
}

export interface TidxChainStatus {
  chain_id: number
  head_num: number
  synced_num: number
  tip_num: number
  lag: number
  backfill_num: number | null
  backfill_remaining: number
  sync_rate: number
  postgres: {
    blocks: number; txs: number; logs: number; receipts: number
    blocks_count: number; txs_count: number; logs_count: number; receipts_count: number; rate: number
  }
  clickhouse: {
    blocks: number; txs: number; logs: number; receipts: number
    blocks_count: number; txs_count: number; logs_count: number; receipts_count: number; rate: number
  }
}

export interface TidxStatus {
  ok: boolean
  version: string
  chains: TidxChainStatus[]
}

const TIDX_URL = process.env.TIDX_URL ?? 'http://localhost:8080'
const CHAIN_ID = '4217'

export async function queryTidx(sql: string): Promise<TidxQueryResult> {
  const url = `${TIDX_URL}/query?sql=${encodeURIComponent(sql)}&chainId=${CHAIN_ID}`
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error ?? 'tidx query failed')
  const rows: TidxRow[] = data.rows.map((row: (string | number | null)[]) =>
    Object.fromEntries(data.columns.map((col: string, i: number) => [col, row[i]]))
  )
  return { rows, row_count: data.row_count, engine: data.engine, query_time_ms: data.query_time_ms }
}

export async function getTidxStatus(): Promise<TidxStatus> {
  const res = await fetch(`${TIDX_URL}/status`, { cache: 'no-store' })
  return res.json()
}
