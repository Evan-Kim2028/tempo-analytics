'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

export function PaymentsMemoPatternChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} width={72} label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Bar dataKey="readable_memos" name="Readable" stackId="1" fill="#A855F7" fillOpacity={0.85} />
        <Bar dataKey="opaque_memos" name="Opaque" stackId="1" fill="#6366F1" fillOpacity={0.85} />
        <Bar dataKey="empty_memos" name="Empty" stackId="1" fill="#6B7280" fillOpacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  )
}
