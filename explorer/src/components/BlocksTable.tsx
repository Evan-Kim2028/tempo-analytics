interface Block {
  num: number
  hash: string
  timestamp: string
  gas_used: number
  miner: string
}

export function BlocksTable({ blocks }: { blocks: Block[] }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Block</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden md:table-cell">Time</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden lg:table-cell">Miner</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Gas Used</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map(block => (
            <tr key={block.num} className="border-b border-tempo-border last:border-0 hover:bg-white/5 transition-colors">
              <td className="px-4 py-3">
                <span className="text-tempo-blue font-mono">{block.num.toLocaleString()}</span>
              </td>
              <td className="px-4 py-3 text-tempo-muted hidden md:table-cell font-mono text-xs">
                {new Date(block.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
              </td>
              <td className="px-4 py-3 hidden lg:table-cell">
                <a href={`/address/${block.miner}`} className="text-tempo-muted hover:text-white font-mono text-xs truncate block max-w-xs">
                  {block.miner}
                </a>
              </td>
              <td className="px-4 py-3 text-tempo-muted font-mono text-xs">
                {block.gas_used.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
