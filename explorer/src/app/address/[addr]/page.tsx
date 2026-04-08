import { notFound } from 'next/navigation'
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { AddressTxList } from '@/components/AddressTxList'
import { StatCard } from '@/components/StatCard'
import { getAddressDefiStats, type AddressDefiStats } from '@/lib/defi'
import { AddressDefiActivity } from '@/components/AddressDefiActivity'

export const revalidate = 60

async function getAddressData(addr: string) {
  if (!/^0x[0-9a-fA-F]{40}$/i.test(addr)) return null
  const key = `address:${addr.toLowerCase()}`
  const cached = await getCached<{ txs: unknown[]; stats: unknown; defi: unknown }>(key)
  if (cached) return cached

  const lowerAddr = addr.toLowerCase()
  const hexAddr = lowerAddr.slice(2) // strip 0x for decode(); bytea columns need decode('hex...', 'hex')

  const [txResult, statsResult, sponsoredResult] = await Promise.all([
    queryTidx(`
      SELECT block_num, block_timestamp,
             '0x' || encode(hash, 'hex') AS hash,
             '0x' || encode("from", 'hex') AS "from",
             '0x' || encode("to", 'hex') AS "to",
             value, signature_type,
             '0x' || encode(fee_token, 'hex') AS fee_token,
             '0x' || encode(fee_payer, 'hex') AS fee_payer,
             call_count
      FROM txs
      WHERE "from" = decode('${hexAddr}', 'hex') OR "to" = decode('${hexAddr}', 'hex')
      ORDER BY block_num DESC
      LIMIT 50
    `),
    queryTidx(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN "from" = decode('${hexAddr}', 'hex') THEN 1 ELSE 0 END) as sent,
             SUM(CASE WHEN "to" = decode('${hexAddr}', 'hex') THEN 1 ELSE 0 END) as received
      FROM txs
      WHERE "from" = decode('${hexAddr}', 'hex') OR "to" = decode('${hexAddr}', 'hex')
    `),
    queryTidx(`
      SELECT COUNT(*) as count
      FROM txs
      WHERE fee_payer = decode('${hexAddr}', 'hex') AND "from" != decode('${hexAddr}', 'hex')
    `),
  ])

  const defiStats = await getAddressDefiStats(lowerAddr)

  const data = {
    txs: txResult.rows,
    stats: {
      ...statsResult.rows[0],
      sponsored_others: sponsoredResult.rows[0]?.count ?? 0,
    },
    defi: defiStats,
  }
  await setCached(key, data, 60)
  return data
}

export default async function AddressPage({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params
  const data = await getAddressData(addr)
  if (!data) notFound()
  const stats = data.stats as Record<string, number>

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-2">Address</h1>
      <p className="text-tempo-muted font-mono text-sm mb-6 break-all">{addr}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Txs" value={Number(stats.total ?? 0).toLocaleString()} />
        <StatCard label="Sent" value={Number(stats.sent ?? 0).toLocaleString()} />
        <StatCard label="Received" value={Number(stats.received ?? 0).toLocaleString()} />
        <StatCard label="Sponsored Others" value={Number(stats.sponsored_others ?? 0).toLocaleString()} />
      </div>

      <h2 className="text-lg font-medium text-white mb-4">Transactions</h2>
      <AddressTxList txs={data.txs as Parameters<typeof AddressTxList>[0]['txs']} address={addr} />
      <AddressDefiActivity
        stats={data.defi as AddressDefiStats}
        address={addr}
      />
    </div>
  )
}
