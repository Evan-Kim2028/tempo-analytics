'use client'

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

export function PaymentsCountChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
        <Area type="monotone" dataKey="successful_payments" name="Successful" stackId="1" stroke="#10B981" fill="#10B981" fillOpacity={0.4} />
        <Area type="monotone" dataKey="failed_attempts" name="Failed" stackId="1" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.35} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
