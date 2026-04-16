import { queryTidx } from '@/lib/tidx'
import { queryClickHouse } from '@/lib/clickhouse'

export interface QueryEntry {
  key: string
  description: string
  engine: 'tidx' | 'clickhouse' | 'custom'
  sql: string
  params?: { name: string; pattern: RegExp }[]
  price: string
}

export type Row = Record<string, string | number | null>
export interface QueryResult {
  columns: string[]
  rows: Row[]
}

// Exported query semantics that rely on Tempo-specific indexed fields are documented in docs/tempo-semantics.md;
// keep query strings behavior-stable unless they are separately migrated.
const QUERY_CATALOG: QueryEntry[] = [
  {
    key: 'account-types',
    description: 'Signature type distribution across all transactions',
    engine: 'tidx',
    sql: `SELECT signature_type, COUNT(*) as count, ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pct FROM txs GROUP BY signature_type ORDER BY count DESC`,
    price: '10000',
  },
  {
    key: 'batch-calls',
    description: 'Batch call frequency distribution',
    engine: 'tidx',
    sql: `SELECT call_count, COUNT(*) as tx_count FROM txs WHERE call_count > 0 GROUP BY call_count ORDER BY call_count`,
    price: '10000',
  },
  {
    key: 'fee-sponsorship',
    description: 'Daily fee sponsorship rates over the last 90 days',
    engine: 'tidx',
    sql: `SELECT DATE(block_timestamp) as day, COUNT(*) as total_txs, SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) as sponsored, ROUND(SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as pct_sponsored FROM txs GROUP BY day ORDER BY day DESC LIMIT 90`,
    price: '10000',
  },
  {
    key: 'fee-tokens',
    description: 'Gas token usage breakdown',
    engine: 'tidx',
    sql: `SELECT '0x' || encode(fee_token, 'hex') AS fee_token, COUNT(*) as count FROM txs WHERE fee_token IS NOT NULL GROUP BY fee_token ORDER BY count DESC`,
    price: '10000',
  },
  {
    key: 'mainnet-launch',
    description: 'Weekly transaction and unique sender growth since launch',
    engine: 'tidx',
    sql: `SELECT DATE_TRUNC('week', block_timestamp::timestamptz) as week, COUNT(*) as txs, COUNT(DISTINCT "from") as unique_senders FROM txs GROUP BY week ORDER BY week ASC`,
    price: '10000',
  },
  {
    key: 'latest-blocks',
    description: 'Most recent 1000 blocks with gas and miner info',
    engine: 'tidx',
    sql: `SELECT num, '0x' || encode(hash, 'hex') AS hash, timestamp, gas_used, '0x' || encode(miner, 'hex') AS miner FROM blocks ORDER BY num DESC LIMIT 1000`,
    price: '10000',
  },
  {
    key: 'stablecoin-daily',
    description: 'Daily stablecoin volume and transfer counts by token',
    engine: 'clickhouse',
    sql: `SELECT day, token, volume_u6, transfers FROM mv_stablecoin_daily ORDER BY day DESC, volume_u6 DESC`,
    price: '10000',
  },
  {
    key: 'dex-daily',
    description: 'Daily DEX swap counts by trading pair',
    engine: 'clickhouse',
    sql: `SELECT day, pair, swap_count FROM mv_dex_daily ORDER BY day DESC, swap_count DESC`,
    price: '10000',
  },
  {
    key: 'nft-activity',
    description: 'Daily NFT transfer counts by collection',
    engine: 'clickhouse',
    sql: `SELECT day, collection, transfers FROM mv_nft_daily ORDER BY day DESC, transfers DESC`,
    price: '10000',
  },
  {
    key: 'pool-trades',
    description: 'Trade history for a specific Protocol DEX pool',
    engine: 'custom',
    sql: '',
    params: [{ name: 'token', pattern: /^0x[0-9a-fA-F]{40}$/ }],
    price: '10000',
  },
]

export function getQueryCatalog(): QueryEntry[] {
  return QUERY_CATALOG
}

export function getQuery(key: string): QueryEntry | undefined {
  return QUERY_CATALOG.find(e => e.key === key)
}

export async function executeQuery(
  key: string,
  params?: Record<string, string>,
): Promise<QueryResult> {
  const entry = QUERY_CATALOG.find(e => e.key === key)
  if (!entry) throw new Error(`Unknown query: ${key}`)

  if (entry.params) {
    for (const p of entry.params) {
      const value = params?.[p.name]
      if (!value) throw new Error(`Missing required parameter: ${p.name}`)
      if (!p.pattern.test(value)) throw new Error(`Invalid parameter ${p.name}: ${value}`)
    }
  }

  if (entry.key === 'pool-trades') {
    const { getProtocolDexPoolTrades } = await import('@/lib/analytics')
    const trades = await getProtocolDexPoolTrades(params!.token.toLowerCase())
    if (!Array.isArray(trades) || trades.length === 0) return { columns: [], rows: [] }
    return { columns: Object.keys(trades[0]), rows: trades as unknown as Row[] }
  }

  if (entry.engine === 'clickhouse') {
    const rows = await queryClickHouse(entry.sql)
    if (rows.length === 0) return { columns: [], rows: [] }
    return { columns: Object.keys(rows[0]), rows: rows as Row[] }
  }

  const tidx = await queryTidx(entry.sql)
  if (tidx.rows.length === 0) return { columns: [], rows: [] }
  return { columns: Object.keys(tidx.rows[0]), rows: tidx.rows }
}

export function formatCsv(result: QueryResult): string {
  if (result.rows.length === 0) {
    return result.columns.length > 0 ? result.columns.join(',') + '\n' : ''
  }
  const escape = (v: string | number | null): string => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const header = result.columns.join(',')
  const body = result.rows
    .map(row => result.columns.map(col => escape(row[col] ?? null)).join(','))
    .join('\n')
  return `${header}\n${body}`
}

export function formatJson(result: QueryResult): { columns: string[]; rows: Row[]; row_count: number } {
  return { columns: result.columns, rows: result.rows, row_count: result.rows.length }
}
