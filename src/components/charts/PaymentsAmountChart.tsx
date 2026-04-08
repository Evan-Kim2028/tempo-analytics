'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })

export function PaymentsAmountChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => usdFormatter.format(value)} width={72} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} formatter={(value: number) => [usdFormatter.format(value), 'Payment amount']} />
        <Line type="monotone" dataKey="total_amount" name="Amount moved" stroke="#38BDF8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
