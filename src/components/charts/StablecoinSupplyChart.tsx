'use client'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { StablecoinSupplyPoint } from '@/lib/analytics'

const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

export function StablecoinSupplyChart({ data }: { data: StablecoinSupplyPoint[] }) {
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
          tickFormatter={v => fmtUSD.format(v)}
          width={72}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          labelStyle={{ color: '#fff', marginBottom: 4 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number) => [fmtUSD.format(v), '']}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area type="monotone" dataKey="pathUSD" name="pathUSD" stackId="1" stroke="#10B981" fill="#10B981" fillOpacity={0.5} />
        <Area type="monotone" dataKey="usdc_e" name="USDC.e" stackId="1" stroke="#0057FF" fill="#0057FF" fillOpacity={0.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
