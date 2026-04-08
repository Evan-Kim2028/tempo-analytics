'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { DailyBridgeProviderFlow } from '@/lib/bridges'

const PALETTE = [
  '#0057FF', '#10B981', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16',
]

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

export function BridgeNetInflowChart({ data }: { data: DailyBridgeProviderFlow[] }) {
  // Pivot: one row per day, columns per provider
  const dayMap = new Map<string, Record<string, string | number>>()
  for (const row of data) {
    if (!dayMap.has(row.day)) dayMap.set(row.day, { day: row.day })
    dayMap.get(row.day)![row.provider] = row.net_flow
  }
  const chartData = [...dayMap.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)))

  // Providers ordered by total net_flow desc
  const providerTotals = new Map<string, { label: string; total: number }>()
  for (const row of data) {
    const existing = providerTotals.get(row.provider) ?? { label: row.provider_label, total: 0 }
    existing.total += row.net_flow
    providerTotals.set(row.provider, existing)
  }
  const providers = [...providerTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id, { label }], i) => ({ id, label, color: PALETTE[i % PALETTE.length] }))

  if (chartData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-tempo-muted text-sm">
        No bridge flow data for this period.
      </div>
    )
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
              const p = providers.find(p => p.id === entry.dataKey)
              return [fmtUSD.format(v), p?.label ?? entry.dataKey]
            }}
          />
          <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
          {providers.map((p, i) => (
            <Bar
              key={p.id}
              dataKey={p.id}
              name={p.label}
              stackId="1"
              fill={p.color}
              radius={i === providers.length - 1 ? [2, 2, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {providers.map(p => (
          <div key={p.id} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-tempo-muted">{p.label}</span>
            <span className="text-white font-mono">
              {fmtUSD.format(providerTotals.get(p.id)?.total ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
