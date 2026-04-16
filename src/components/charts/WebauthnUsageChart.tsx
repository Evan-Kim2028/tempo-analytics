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
import type { WebauthnUsagePoint } from '@/lib/tempoAnalytics'

const fmtPercent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const fmtCount   = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const AXIS_PROPS = {
  tick: { fill: '#6B7280', fontSize: 11 },
  width: 72,
  label: { angle: -90, position: 'insideLeft' as const, fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' as const } },
}
const TOOLTIP_STYLE = { contentStyle: { backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }, labelStyle: { color: '#fff', marginBottom: 4 }, itemStyle: { color: '#6B7280' } }

export function WebauthnUsageChart({ data }: { data: WebauthnUsagePoint[] }) {
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
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => [`${fmtPercent.format(value)}%`, 'WebAuthn share']} />
            <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
            <Area type="monotone" dataKey="webauthn_pct_of_tempo" name="WebAuthn share" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.15} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
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
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => [fmtCount.format(value), 'WebAuthn txs']} />
            <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
            <Line type="monotone" dataKey="webauthn_txs" name="WebAuthn txs" stroke="#06B6D4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
