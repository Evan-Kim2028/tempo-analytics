'use client'

import {
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

const fmtPercent = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
})

export function WebauthnUsageChart({ data }: { data: WebauthnUsagePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => value.slice(5)}
          interval="preserveStartEnd"
          label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => `${fmtPercent.format(value)}%`}
          width={72}
          label={{ value: 'Share (%)', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(value: number) => [`${fmtPercent.format(value)}%`, 'WebAuthn share']}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Line type="monotone" dataKey="webauthn_pct_of_tempo" name="WebAuthn share" stroke="#06B6D4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
