import { notFound } from 'next/navigation'
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import type { TidxRow } from '@/lib/tidx'

export const revalidate = 300

async function getBlock(num: string) {
  const blockNum = parseInt(num, 10)
  if (!Number.isFinite(blockNum) || blockNum < 0) return null

  const key = `block:${blockNum}`
  const cached = await getCached<{ block: TidxRow; txs: TidxRow[] }>(key)
  if (cached) return cached

  const [blockResult, txsResult] = await Promise.all([
    queryTidx(`
      SELECT num,
             '0x' || encode(hash, 'hex') AS hash,
             '0x' || encode(parent_hash, 'hex') AS parent_hash,
             timestamp, gas_limit, gas_used,
             '0x' || encode(miner, 'hex') AS miner
      FROM blocks WHERE num = ${blockNum} LIMIT 1
    `),
    queryTidx(`
      SELECT '0x' || encode(hash, 'hex') AS hash,
             '0x' || encode("from", 'hex') AS "from",
             '0x' || encode("to", 'hex') AS "to",
             value, signature_type,
             '0x' || encode(fee_token, 'hex') AS fee_token,
             '0x' || encode(fee_payer, 'hex') AS fee_payer
      FROM txs
      WHERE block_num = ${blockNum}
      ORDER BY idx ASC
      LIMIT 100
    `),
  ])

  if (!blockResult.rows.length) return null

  const data = { block: blockResult.rows[0], txs: txsResult.rows }
  await setCached(key, data, 300)
  return data
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3 border-b border-tempo-border last:border-0">
      <dt className="text-tempo-muted text-sm">{label}</dt>
      <dd className="col-span-2 text-sm text-white font-mono break-all">
        {value ?? <span className="text-tempo-muted">—</span>}
      </dd>
    </div>
  )
}

export default async function BlockPage({ params }: { params: Promise<{ num: string }> }) {
  const { num } = await params
  const data = await getBlock(num)
  if (!data) notFound()

  const { block, txs } = data
  const blockNum = Number(block.num)

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-2">Block</h1>
      <p className="text-tempo-muted text-sm mb-6">#{blockNum.toLocaleString()}</p>

      <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-8">
        <dl>
          <Field label="Block Number" value={blockNum.toLocaleString()} />
          <Field label="Hash" value={block.hash as string} />
          {block.parent_hash != null && (
            <Field label="Parent Hash" value={
              <a href={`/block/${blockNum - 1}`} className="text-tempo-blue hover:underline">
                {block.parent_hash as string}
              </a>
            } />
          )}
          <Field label="Timestamp" value={block.timestamp as string} />
          <Field label="Miner" value={
            block.miner ? (
              <a href={`/address/${block.miner}`} className="text-tempo-blue hover:underline">
                {block.miner as string}
              </a>
            ) : null
          } />
          <Field label="Transactions" value={`${txs.length}${txs.length === 100 ? '+' : ''}`} />
          {block.gas_used != null && (
            <Field label="Gas Used" value={Number(block.gas_used).toLocaleString()} />
          )}
          {block.gas_limit != null && (
            <Field label="Gas Limit" value={Number(block.gas_limit).toLocaleString()} />
          )}
        </dl>
      </div>

      {txs.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-white mb-4">
            Transactions ({txs.length}{txs.length === 100 ? '+' : ''})
          </h2>
          <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tempo-border">
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">Hash</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">From</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">To</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">Fee Token</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((tx) => {
                  const hash = String(tx.hash)
                  const from = String(tx.from)
                  const to = tx.to ? String(tx.to) : null
                  const feeToken = tx.fee_token ? String(tx.fee_token) : null
                  return (
                    <tr key={hash} className="border-b border-tempo-border last:border-0 hover:bg-tempo-border/30 transition-colors">
                      <td className="px-4 py-3 font-mono">
                        <a href={`/tx/${hash}`} className="text-tempo-blue hover:underline">
                          {hash.slice(0, 10)}…{hash.slice(-8)}
                        </a>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <a href={`/address/${from}`} className="text-white hover:text-tempo-blue">
                          {from.slice(0, 10)}…
                        </a>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {to ? (
                          <a href={`/address/${to}`} className="text-white hover:text-tempo-blue">
                            {to.slice(0, 10)}…
                          </a>
                        ) : (
                          <span className="text-yellow-400">Creation</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-tempo-muted">
                        {feeToken ? `${feeToken.slice(0, 10)}…` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
