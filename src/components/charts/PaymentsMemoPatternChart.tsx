'use client'

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

export function PaymentsMemoPatternChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area type="monotone" dataKey="readable_memos" name="Readable" stackId="1" stroke="#A855F7" fill="#A855F7" fillOpacity={0.35} />
        <Area type="monotone" dataKey="opaque_memos" name="Opaque" stackId="1" stroke="#6366F1" fill="#6366F1" fillOpacity={0.35} />
        <Area type="monotone" dataKey="empty_memos" name="Empty" stackId="1" stroke="#6B7280" fill="#6B7280" fillOpacity={0.3} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
