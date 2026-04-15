'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts'
import type { InscriptionTotals } from '@/lib/inscriptions'

const COLORS = ['#F59E0B', '#0057FF', '#10B981', '#8B5CF6', '#EF4444',
                '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1']

interface Props {
  totals: InscriptionTotals[]
}

export function InscriptionChart({ totals }: Props) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={totals} layout="vertical" margin={{ top: 4, right: 32, left: 40, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickFormatter={v => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)}
          label={{ value: 'Mints', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="tick"
          tick={{ fill: '#fff', fontSize: 12 }}
          width={72}
          label={{ value: 'Ticker', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          itemStyle={{ color: '#6B7280' }}
          formatter={(v: number) => [v.toLocaleString(), 'mints']}
        />
        <Bar dataKey="mints" radius={[0, 4, 4, 0]}>
          {totals.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
