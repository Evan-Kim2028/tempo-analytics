'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TempoTxSharePoint } from '@/lib/tempoAnalytics'

const fmtPercent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const fmtCount   = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const AXIS_PROPS = {
  tick: { fill: '#6B7280', fontSize: 11 },
  width: 72,
  label: { angle: -90, position: 'insideLeft' as const, fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' as const } },
}
const TOOLTIP_STYLE = { contentStyle: { backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }, labelStyle: { color: '#fff', marginBottom: 4 }, itemStyle: { color: '#6B7280' } }

export function TempoTxShareChart({ data }: { data: TempoTxSharePoint[] }) {
  const [mode, setMode] = useState<'pct' | 'count'>('pct')

  const xAxis = (
    <XAxis
      dataKey="day"
      tick={{ fill: '#6B7280', fontSize: 11 }}
      tickFormatter={value => value.slice(5)}
      interval="preserveStartEnd"
      label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
    />
  )

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setMode(m => m === 'pct' ? 'count' : 'pct')}
          className="text-xs border border-tempo-border rounded px-2 py-0.5 text-tempo-muted hover:text-white transition-colors"
        >
          {mode === 'pct' ? 'Show counts' : 'Show %'}
        </button>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        {mode === 'pct' ? (
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
            {xAxis}
            <YAxis
              {...AXIS_PROPS}
              tickFormatter={value => `${fmtPercent.format(value)}%`}
              label={{ ...AXIS_PROPS.label, value: 'Share (%)' }}
            />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => [`${fmtPercent.format(value)}%`, 'Tempo share']} />
            <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
            <Area type="monotone" dataKey="tempo_pct" name="Tempo share" stroke="#10B981" fill="#10B981" fillOpacity={0.15} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
            {xAxis}
            <YAxis
              {...AXIS_PROPS}
              tickFormatter={value => fmtCount.format(value)}
              label={{ ...AXIS_PROPS.label, value: 'Transactions' }}
            />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number, name: string) => [fmtCount.format(value), name]} />
            <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
            <Line type="monotone" dataKey="tempo_txs" name="Tempo txs" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="total_txs" name="All txs" stroke="#6B7280" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
