'use client'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { DailyStatCategorized } from '@/lib/analytics'

const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function TxCategoryChart({ data }: { data: DailyStatCategorized[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => v.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => fmt.format(v)}
          width={48}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number, name: string) => [v.toLocaleString(), name]}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="user_txs"
          name="User"
          stackId="1"
          stroke="#0057FF"
          fill="#0057FF"
          fillOpacity={0.6}
        />
        <Area
          type="monotone"
          dataKey="inscription_txs"
          name="Inscriptions"
          stackId="1"
          stroke="#F59E0B"
          fill="#F59E0B"
          fillOpacity={0.6}
        />
        <Area
          type="monotone"
          dataKey="protocol_txs"
          name="Protocol"
          stackId="1"
          stroke="#374151"
          fill="#374151"
          fillOpacity={0.8}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
