import { NextRequest, NextResponse } from 'next/server'
import { createChallenge, verifyPayment } from '@/lib/mpp'
import { queryTidx } from '@/lib/tidx'

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
}

function rowsToCsv(result: { columns?: string[]; rows: Record<string, string | number | null>[] }): string {
  // Handle both shaped (TidxQueryResult) and raw column formats
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { query?: string }
  const { query: queryKey } = body

  if (!queryKey || !EXPORT_QUERIES[queryKey]) {
    return NextResponse.json({ error: 'Unknown export query' }, { status: 400 })
  }

  const paymentTxHash = req.headers.get('X-Payment')

  if (!paymentTxHash) {
    return NextResponse.json({ challenge: createChallenge() }, { status: 402 })
  }

  const verification = await verifyPayment(paymentTxHash)
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error, challenge: createChallenge() }, { status: 402 })
  }

  const result = await queryTidx(EXPORT_QUERIES[queryKey])
  const csv = rowsToCsv(result)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
    },
  })
}
