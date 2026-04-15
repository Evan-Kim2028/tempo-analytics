'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PaymentsDailyPoint } from '@/lib/payments'

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })

export function PaymentsAmountChart({ data }: { data: PaymentsDailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
        <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => value.slice(5)} label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }} />
        <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={value => usdFormatter.format(value)} width={72} label={{ value: 'Amount (USD)', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }} />
        <Tooltip contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }} formatter={(value: number) => [usdFormatter.format(value), 'Payment amount']} />
        <Bar dataKey="total_amount" name="Amount moved" fill="#38BDF8" fillOpacity={0.85} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
