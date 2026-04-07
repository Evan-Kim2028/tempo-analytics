import { notFound } from 'next/navigation'
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { TxDetail } from '@/components/TxDetail'
import type { TidxRow } from '@/lib/tidx'

export const revalidate = 60

async function getTx(hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null
  const key = `tx:${hash}`
  const cached = await getCached<{ tx: TidxRow; receipt: TidxRow | null }>(key)
  if (cached) return cached

  const [txResult, receiptResult] = await Promise.all([
    queryTidx(`SELECT * FROM txs WHERE hash = '${hash}' LIMIT 1`),
    queryTidx(`SELECT * FROM receipts WHERE tx_hash = '${hash}' LIMIT 1`),
  ])

  if (!txResult.rows.length) return null

  const data = { tx: txResult.rows[0], receipt: receiptResult.rows[0] ?? null }
  await setCached(key, data, 60)
  return data
}

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  const data = await getTx(hash)
  if (!data) notFound()

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-2">Transaction</h1>
      <p className="text-tempo-muted font-mono text-sm mb-6 break-all">{hash}</p>
      <TxDetail tx={data.tx} receipt={data.receipt} />
    </div>
  )
}
