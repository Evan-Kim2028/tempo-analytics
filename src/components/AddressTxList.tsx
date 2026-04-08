import { CopyableHash } from '@/components/CopyableHash'

interface TxRow {
  hash: string
  block_num: number
  block_timestamp: string
  from: string
  to: string | null
  value: string
  signature_type: number
  fee_token: string | null
  fee_payer: string
  call_count: number
}

const SIG_BADGES: Record<number, { label: string; color: string }> = {
  0: { label: 'EOA', color: 'text-gray-400' },
  1: { label: 'P256', color: 'text-blue-400' },
  2: { label: 'Passkey', color: 'text-purple-400' },
}

export function AddressTxList({ txs, address }: { txs: TxRow[]; address: string }) {
  if (!txs.length) return <p className="text-tempo-muted text-sm">No transactions found.</p>

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Tx Hash</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden md:table-cell">Block</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Direction</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden lg:table-cell">Type</th>
          </tr>
        </thead>
        <tbody>
          {txs.map(tx => {
            const sig = SIG_BADGES[tx.signature_type] ?? { label: `Type ${tx.signature_type}`, color: 'text-gray-400' }
            const isOut = tx.from?.toLowerCase() === address.toLowerCase()
            return (
              <tr key={tx.hash} className="border-b border-tempo-border last:border-0 hover:bg-white/5">
                <td className="px-4 py-3">
                  <CopyableHash hash={tx.hash} display={`${tx.hash.slice(0, 18)}…`} />
                </td>
                <td className="px-4 py-3 text-tempo-muted font-mono text-xs hidden md:table-cell">
                  {tx.block_num.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${isOut ? 'text-red-400' : 'text-green-400'}`}>
                    {isOut ? 'OUT' : 'IN'}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className={`text-xs ${sig.color}`}>{sig.label}</span>
                  {tx.call_count > 0 && <span className="text-yellow-400 text-xs ml-2">batch</span>}
                  {tx.fee_payer && tx.fee_payer !== tx.from && <span className="text-teal-400 text-xs ml-2">sponsored</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
