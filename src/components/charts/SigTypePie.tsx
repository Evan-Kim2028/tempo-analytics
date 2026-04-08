'use client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { SigTypeStat } from '@/lib/analytics'

const SIG_LABELS: Record<number, string> = {
  0: 'Secp256k1',
  1: 'P256',
  2: 'WebAuthn',
}
const COLORS = ['#0057FF', '#10B981', '#F59E0B', '#8B5CF6']

export function SigTypePie({ data }: { data: SigTypeStat[] }) {
  const chartData = data.map(d => ({
    name: d.signature_type != null ? (SIG_LABELS[d.signature_type] ?? `Type ${d.signature_type}`) : 'Unknown',
    value: d.txs,
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
          itemStyle={{ color: '#fff' }}
          formatter={(v: number) => [v.toLocaleString(), '']}
        />
        <Legend wrapperStyle={{ color: '#6B7280', fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
