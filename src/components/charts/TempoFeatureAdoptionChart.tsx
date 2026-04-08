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
import type { TempoFeatureAdoptionPoint } from '@/lib/tempoAnalytics'

const fmtPercent = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})

export function TempoFeatureAdoptionChart({ data }: { data: TempoFeatureAdoptionPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => value.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => `${fmtPercent.format(value)}%`}
          width={48}
          domain={[0, 'auto']}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(value: number, name: string) => [`${fmtPercent.format(value)}%`, name]}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Line type="monotone" dataKey="sponsored_pct" name="Sponsored" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
        <Line type="monotone" dataKey="batched_pct" name="Batched" stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
        <Line type="monotone" dataKey="time_bounded_pct" name="Time bounded" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
        <Line type="monotone" dataKey="fee_token_set_pct" name="Fee token" stroke="#0057FF" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}
