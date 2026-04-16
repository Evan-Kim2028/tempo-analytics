'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MicropaymentStatsDailyPoint } from '@/lib/payments'

export function MicropaymentTierChart({ data }: { data: MicropaymentStatsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis
          dataKey="day"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={value => value.slice(5)}
          label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
        />
        <YAxis
          tick={{ fill: '#6B7280', fontSize: 11 }}
          width={72}
          label={{ value: 'Transactions', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="sub_cent_count"   name="Sub-cent (<$0.01)"   stackId="1" fill="#0057FF" fillOpacity={0.85} />
        <Bar dataKey="sub_nickel_count" name="Sub-nickel (<$0.05)" stackId="1" fill="#10B981" fillOpacity={0.85} />
        <Bar dataKey="sub_dime_count"   name="Sub-dime (<$0.10)"   stackId="1" fill="#8B5CF6" fillOpacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  )
}
