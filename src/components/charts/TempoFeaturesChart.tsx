'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { DailyStat } from '@/lib/analytics'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function TempoFeaturesChart({ data }: { data: DailyStat[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => v.slice(5)}
          interval="preserveStartEnd"
          label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => fmt.format(v)}
          width={72}
          label={{ value: 'Transactions', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number, name: string) => [v.toLocaleString(), name]}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="batch_txs" name="Batch Calls" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
        <Bar dataKey="sponsored_txs" name="Sponsored" fill="#F59E0B" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
