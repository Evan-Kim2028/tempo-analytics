'use client'

import { useState } from 'react'
import type { TraceResult, TraceStructLog } from '@/app/tx/[hash]/page'

interface TraceTreeProps {
  trace: TraceResult
}

function formatHex(value: string, maxLength: number = 66): string {
  if (!value) return ''
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength) + '...'
}

function getOpColor(op: string): string {
  if (op.startsWith('PUSH')) return 'text-blue-400'
  if (op.startsWith('DUP')) return 'text-cyan-400'
  if (op === 'CALL' || op === 'STATICCALL' || op === 'DELEGATECALL') return 'text-yellow-400'
  if (op === 'REVERT' || op === 'SELFDESTRUCT') return 'text-red-400'
  if (op === 'SSTORE' || op === 'SLOAD') return 'text-purple-400'
  if (op === 'MSTORE' || op === 'MLOAD') return 'text-indigo-400'
  return 'text-gray-400'
}

function TraceRow({ log, index }: { log: TraceStructLog; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = log.stack.length > 0 || log.memory.length > 0 || Object.keys(log.storage).length > 0

  return (
    <div className="border-b border-tempo-border last:border-0">
      <div
        className="px-4 py-2 hover:bg-tempo-hover cursor-pointer flex items-center gap-3 text-xs font-mono"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-6 text-right text-tempo-muted">{index}</span>
        <span className="w-8">
          {hasDetails && (
            <span className="text-blue-400">{expanded ? '▼' : '▶'}</span>
          )}
        </span>
        <span className="w-16 text-right text-gray-500">{log.pc}</span>
        <span className={`w-24 font-semibold ${getOpColor(log.op)}`}>
          {log.op}
        </span>
        <span className="w-16 text-right text-gray-500">{log.gas}</span>
        <span className="w-16 text-right text-gray-500">{log.gasCost}</span>
        <span className="w-12 text-right text-gray-500">{log.depth}</span>
        <span className="text-gray-600">
          Stack: {log.stack.length > 0 ? log.stack.length : '-'}
        </span>
      </div>

      {expanded && hasDetails && (
        <div className="bg-tempo-hover px-4 py-3 pl-8 border-t border-tempo-border">
          {log.stack.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-tempo-muted mb-2">Stack ({log.stack.length})</h4>
              <div className="space-y-1">
                {log.stack.map((item, i) => (
                  <div key={i} className="text-xs font-mono text-gray-300">
                    <span className="text-gray-600 mr-2">[{i}]</span>
                    {formatHex(item, 100)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {log.memory.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-tempo-muted mb-2">Memory ({log.memory.length} bytes)</h4>
              <div className="text-xs font-mono text-gray-300 bg-black bg-opacity-30 p-2 rounded max-h-48 overflow-y-auto">
                {log.memory.map((chunk, i) => (
                  <div key={i} className="text-gray-400">
                    {chunk}
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(log.storage).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-tempo-muted mb-2">Storage ({Object.keys(log.storage).length})</h4>
              <div className="space-y-1">
                {Object.entries(log.storage).map(([key, value]) => (
                  <div key={key} className="text-xs font-mono text-gray-300">
                    <span className="text-purple-400">{formatHex(key, 66)}</span>
                    <span className="text-gray-600 mx-2">=</span>
                    <span className="text-green-400">{formatHex(value, 66)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TraceTree({ trace }: TraceTreeProps) {
  const [showAll, setShowAll] = useState(false)
  const displayLogs = showAll ? trace.structLogs : trace.structLogs.slice(0, 100)

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-tempo-border bg-tempo-hover">
        <div className="text-xs font-mono text-tempo-muted flex items-center gap-3">
          <span className="w-6 text-right">ID</span>
          <span className="w-8"></span>
          <span className="w-16 text-right">PC</span>
          <span className="w-24">Op</span>
          <span className="w-16 text-right">Gas</span>
          <span className="w-16 text-right">Cost</span>
          <span className="w-12 text-right">Depth</span>
          <span>Stack</span>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {displayLogs.map((log, i) => (
          <TraceRow key={i} log={log} index={i} />
        ))}
      </div>

      {!showAll && trace.structLogs.length > 100 && (
        <div className="px-4 py-3 border-t border-tempo-border bg-tempo-hover text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Show all {trace.structLogs.length} operations
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-t border-tempo-border text-xs text-tempo-muted space-y-1">
        <div>
          <span className="font-semibold">Failed:</span> {trace.failed ? 'Yes' : 'No'}
        </div>
        <div>
          <span className="font-semibold">Gas Used:</span> {trace.gas}
        </div>
        <div>
          <span className="font-semibold">Return Value:</span> {formatHex(trace.returnValue, 100)}
        </div>
      </div>
    </div>
  )
}
