import { NextRequest, NextResponse } from 'next/server'
import { Mppx, tempo } from 'mppx/server'
import { server as solana } from 'mppx-solana'
import { queryTidx } from '@/lib/tidx'

// Protocol-level constants — these are well-known public contract addresses
const TEMPO_USDC_E = '0x20C000000000000000000000b9537d11c60E8b50'
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TEMPO_RECIPIENT = process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}` | undefined

// $0.10 expressed in each token's native base units (both USDC, 6 decimals)
const EXPORT_PRICE = '0.10'          // human-readable for tempo.charge (parseUnits internally)
const EXPORT_PRICE_SOL = '100000'    // base units for mppx-solana (6 decimals → $0.10)

const EXPORT_QUERIES: Record<string, string> = {
  'account-types': `
    SELECT signature_type, COUNT(*) as count,
           ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pct
    FROM txs
    GROUP BY signature_type
    ORDER BY count DESC
  `,
  'batch-calls': `
    SELECT call_count, COUNT(*) as tx_count
    FROM txs
    WHERE call_count > 0
    GROUP BY call_count
    ORDER BY call_count
  `,
  'fee-sponsorship': `
    SELECT DATE(block_timestamp) as day,
           COUNT(*) as total_txs,
           SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) as sponsored,
           ROUND(SUM(CASE WHEN fee_payer != "from" THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as pct_sponsored
    FROM txs
    GROUP BY day
    ORDER BY day DESC
    LIMIT 90
  `,
  'fee-tokens': `
    SELECT '0x' || encode(fee_token, 'hex') AS fee_token, COUNT(*) as count
    FROM txs
    WHERE fee_token IS NOT NULL
    GROUP BY fee_token
    ORDER BY count DESC
  `,
  'mainnet-launch': `
    SELECT DATE_TRUNC('week', block_timestamp::timestamptz) as week,
           COUNT(*) as txs,
           COUNT(DISTINCT "from") as unique_senders
    FROM txs
    GROUP BY week
    ORDER BY week ASC
  `,
  'latest-blocks': `
    SELECT num, '0x' || encode(hash, 'hex') AS hash, timestamp, gas_used,
           '0x' || encode(miner, 'hex') AS miner
    FROM blocks
    ORDER BY num DESC
    LIMIT 1000
  `,
  'stablecoin-daily': `
    SELECT day, token, symbol, volume_usd, transfers
    FROM mv_stablecoin_daily
    ORDER BY day DESC, volume_usd DESC
  `,
  'dex-daily': `
    SELECT day, volume_usd, swap_count
    FROM mv_dex_daily
    ORDER BY day DESC
  `,
  'nft-activity': `
    SELECT day, transfers, active_collections
    FROM mv_nft_daily
    ORDER BY day DESC
  `,
}

function rowsToCsv(result: { columns?: string[]; rows: Record<string, string | number | null>[] }): string {
  const columns = result.columns ?? Object.keys(result.rows[0] ?? {})
  const escape = (v: string | number | null): string => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const header = columns.join(',')
  const body = result.rows.map(row => columns.map(col => escape(row[col] ?? null)).join(',')).join('\n')
  return `${header}\n${body}`
}

const mppx = Mppx.create({
  methods: [
    tempo.charge({
      recipient: TEMPO_RECIPIENT,
      currency: TEMPO_USDC_E,
    }),
    solana({
      recipient: process.env.SOLANA_RECIPIENT_ADDRESS,
      currency: SOLANA_USDC,
      decimals: 6,
    }),
  ],
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { query?: string }
  const { query: queryKey } = body

  if (!queryKey || !EXPORT_QUERIES[queryKey]) {
    return NextResponse.json({ error: 'Unknown export query' }, { status: 400 })
  }

  const result = await mppx.compose(
    [mppx.tempo.charge, { amount: EXPORT_PRICE }],
    [mppx.solana.charge, { amount: EXPORT_PRICE_SOL, cluster: 'mainnet-beta' }],
  )(req)

  if (result.status === 402) return result.challenge

  const data = await queryTidx(EXPORT_QUERIES[queryKey])
  const csv = rowsToCsv(data)

  return result.withReceipt(
    new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
      },
    }),
  )
}
