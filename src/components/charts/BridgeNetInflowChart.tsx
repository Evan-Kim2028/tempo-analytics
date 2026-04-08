'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { BridgeNetInflowChartData } from '@/lib/bridges'

const PALETTE = [
  '#0057FF', '#10B981', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16',
]

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

export function BridgeNetInflowChart({ data }: { data: BridgeNetInflowChartData }) {
  if (data.days.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-tempo-muted text-sm">
        No bridge flow data for this period.
      </div>
    )
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data.days} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
          <XAxis
            dataKey="day"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => String(v).slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => fmtUSD.format(v)}
            width={64}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
            labelStyle={{ color: '#fff', marginBottom: 4 }}
            itemStyle={{ color: '#6B7280' }}
            formatter={(v: number, _name: string, entry) => {
              const p = data.providers.find(p => p.id === entry.dataKey)
              return [fmtUSD.format(v), p?.label ?? String(entry.dataKey)]
            }}
          />
          <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
          {data.providers.map((p, i) => (
            <Bar
              key={p.id}
              dataKey={p.id}
              name={p.label}
              stackId="1"
              fill={PALETTE[i % PALETTE.length]}
              radius={i === data.providers.length - 1 ? [2, 2, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {data.providers.map((p, i) => (
          <div key={p.id} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="text-tempo-muted">{p.label}</span>
            <span className="text-white font-mono">{fmtUSD.format(p.total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
