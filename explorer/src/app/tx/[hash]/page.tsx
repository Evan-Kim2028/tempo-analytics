import { notFound } from 'next/navigation'
import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { TxDetail } from '@/components/TxDetail'
import type { TidxRow } from '@/lib/tidx'
import { decodeCalldata, type DecodedCalldata } from '@/lib/whatsabi'
import { TraceTree } from '@/components/TraceTree'

export const revalidate = 60

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export interface TraceStructLog {
  pc: number
  op: string
  gas: number
  gasCost: number
  depth: number
  stack: string[]
  memory: string[]
  storage: Record<string, string>
  reason?: string
}

export interface TraceResult {
  failed: boolean
  gas: number
  returnValue: string
  structLogs: TraceStructLog[]
}

interface TokenTransfer {
  token: string
  from: string
  to: string
  amount: string
  logIndex: number
}

function decodeTransfers(logs: TidxRow[]): TokenTransfer[] {
  return logs
    .filter(log => log.topic1 && log.topic2 && log.data)
    .map(log => ({
      token: String(log.address),
      from: '0x' + String(log.topic1).slice(-40),
      to: '0x' + String(log.topic2).slice(-40),
      amount: (() => { try { return BigInt(String(log.data)).toString() } catch { return String(log.data) } })(),
      logIndex: Number(log.log_idx),
    }))
}

async function getTrace(hash: string): Promise<TraceResult | null> {
  const key = `trace:${hash}`
  const cached = await getCached<TraceResult>(key)
  if (cached) return cached

  try {
    const rpcUrl = process.env.TEMPO_RPC_URL ?? 'https://rpc.mainnet.tempo.xyz'
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'debug_traceTransaction',
        params: [hash, {}],
        id: 1,
      }),
      cache: 'force-cache',
    })

    const result = await response.json()
    if (result.error || !result.result) {
      return null
    }

    const trace = result.result as TraceResult
    await setCached(key, trace, 3600)
    return trace
  } catch {
    return null
  }
}

async function getTx(hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null
  const key = `tx:${hash}`
  const cached = await getCached<{ tx: TidxRow; receipt: TidxRow | null; transfers: TokenTransfer[]; decoded: DecodedCalldata | null; trace: TraceResult | null }>(key)
  if (cached) return cached

  const [txResult, receiptResult, logsResult, trace] = await Promise.all([
    queryTidx(`SELECT * FROM txs WHERE hash = '${hash}' LIMIT 1`),
    queryTidx(`SELECT * FROM receipts WHERE tx_hash = '${hash}' LIMIT 1`),
    queryTidx(`
      SELECT address, topic1, topic2, data, log_idx
      FROM logs
      WHERE tx_hash = '${hash}' AND topic0 = '${TRANSFER_TOPIC}'
      ORDER BY log_idx ASC
      LIMIT 50
    `),
    getTrace(hash),
  ])

  if (!txResult.rows.length) return null

  const decoded = await decodeCalldata(
    txResult.rows[0].to as string | null,
    txResult.rows[0].input as string,
  )

  const data = {
    tx: txResult.rows[0],
    receipt: receiptResult.rows[0] ?? null,
    transfers: decodeTransfers(logsResult.rows),
    decoded,
    trace,
  }
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
      <TxDetail tx={data.tx} receipt={data.receipt} decoded={data.decoded} />

      {data.transfers.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium text-white mb-4">
            Token Transfers ({data.transfers.length})
          </h2>
          <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tempo-border">
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">Token</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">From</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">To</th>
                  <th className="text-right px-4 py-3 text-tempo-muted font-medium">Amount (raw)</th>
                </tr>
              </thead>
              <tbody>
                {data.transfers.map((t) => (
                  <tr key={t.logIndex} className="border-b border-tempo-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">
                      <a href={`/address/${t.token}`} className="text-tempo-blue hover:underline">
                        {t.token.slice(0, 10)}…{t.token.slice(-8)}
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <a href={`/address/${t.from}`} className="text-white hover:text-tempo-blue">
                        {t.from.slice(0, 10)}…{t.from.slice(-8)}
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <a href={`/address/${t.to}`} className="text-white hover:text-tempo-blue">
                        {t.to.slice(0, 10)}…{t.to.slice(-8)}
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-right text-white">
                      {t.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.trace && data.trace.structLogs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium text-white mb-4">
            Execution Trace ({data.trace.structLogs.length} ops)
          </h2>
          <TraceTree trace={data.trace} />
        </div>
      )}
    </div>
  )
}
