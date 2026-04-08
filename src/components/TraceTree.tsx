// explorer/src/components/TraceTree.tsx
'use client'

export interface TraceFrame {
  depth: number
  type: string
  from: string
  to: string
  value: string
  input: string
  output: string
  gas: string
  gasUsed: string
  error?: string
}

const CALL_COLORS: Record<string, string> = {
  CALL: 'text-tempo-blue',
  STATICCALL: 'text-green-400',
  DELEGATECALL: 'text-yellow-400',
  CREATE: 'text-purple-400',
  CREATE2: 'text-purple-400',
}

export function TraceTree({ frames }: { frames: TraceFrame[] }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 overflow-x-auto">
      <div className="font-mono text-xs space-y-1">
        {frames.map((frame, i) => (
          <div
            key={i}
            style={{ paddingLeft: `${frame.depth * 20}px` }}
            className={`flex items-baseline gap-2 ${frame.error ? 'opacity-50' : ''}`}
          >
            <span className={CALL_COLORS[frame.type] ?? 'text-white'}>{frame.type}</span>
            <a href={`/address/${frame.to}`} className="text-white hover:text-tempo-blue">
              {frame.to.slice(0, 10)}…{frame.to.slice(-6)}
            </a>
            <span className="text-tempo-muted">
              {frame.input.length > 10 ? frame.input.slice(0, 10) + '…' : frame.input}
            </span>
            {frame.error && <span className="text-red-400 ml-auto">{frame.error}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
