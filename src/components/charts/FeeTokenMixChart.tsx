'use client'
import {
  CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { FeeTokenMixChartData } from '@/lib/tempoAnalytics'

const COLORS = ['#0057FF', '#10B981', '#F59E0B', '#8B5CF6', '#F43F5E', '#06B6D4']
const fmtPercent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export function FeeTokenMixChart({ data }: { data: FeeTokenMixChartData }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data.rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => String(value).slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => `${fmtPercent.format(value)}%`}
          width={48}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(value: number, name: string) => [`${fmtPercent.format(value)}%`, name]}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        {data.tokens.map((token, index) => (
          <Line
            key={token}
            type="monotone"
            dataKey={token}
            name={token}
            stroke={COLORS[index % COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
