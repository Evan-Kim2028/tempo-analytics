'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { FeeTokenDailyStat } from '@/lib/analytics'

const fmtCount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function FeeAmmChart({ data }: { data: FeeTokenDailyStat[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
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
          tickFormatter={v => fmtCount.format(v)}
          width={72}
          label={{ value: 'Transactions', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number, name: string) => [fmtCount.format(v), name]}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="usdc_e"  name="USDC.e"  stackId="1" fill="#0057FF" />
        <Bar dataKey="pathusd" name="pathUSD" stackId="1" fill="#10B981" />
        <Bar dataKey="others"  name="Others"  stackId="1" fill="#6B7280" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
