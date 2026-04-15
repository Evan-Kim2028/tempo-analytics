'use client'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { StablecoinSupplyHistory } from '@/lib/analytics'

const PALETTE = [
  '#10B981', '#0057FF', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16',
  '#FB923C', '#22D3EE', '#A78BFA', '#F472B6',
  '#4ADE80', '#FACC15', '#60A5FA', '#FCA5A5',
  '#6B7280',
]

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

function CustomLegend({ tokens, total }: {
  tokens: StablecoinSupplyHistory['tokens']
  total: number
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
      {tokens.map((t, i) => (
        <div key={t.address} className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
          />
          <span className="text-tempo-muted">{t.symbol}</span>
          <span className="text-white font-mono">{fmtUSD.format(t.supply_latest)}</span>
          <span className="text-tempo-muted">
            ({total > 0 ? ((t.supply_latest / total) * 100).toFixed(1) : '0'}%)
          </span>
        </div>
      ))}
    </div>
  )
}

export function StablecoinSupplyChart({ data }: { data: StablecoinSupplyHistory }) {
  const total = data.tokens.reduce((s, t) => s + t.supply_latest, 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data.days} margin={{ top: 4, right: 16, left: 8, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
          <XAxis
            dataKey="day"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => String(v).slice(5)}
            interval="preserveStartEnd"
            label={{ value: 'Date', position: 'insideBottom', offset: -2, fill: '#6B7280', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 11 }}
            tickFormatter={v => fmtUSD.format(v)}
            width={72}
            label={{ value: 'Supply (USD)', angle: -90, position: 'insideLeft', fill: '#6B7280', fontSize: 11, style: { textAnchor: 'middle' } }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#13131A', border: '1px solid #1E1E2E', borderRadius: 6 }}
            labelStyle={{ color: '#fff', marginBottom: 4 }}
            itemStyle={{ color: '#6B7280' }}
            formatter={(v: number, _name: string, entry) => {
              const token = data.tokens.find(t => t.address === entry.dataKey)
              return [fmtUSD.format(v), token?.symbol ?? entry.dataKey]
            }}
          />
          {data.tokens.map((t, i) => (
            <Area
              key={t.address}
              type="monotone"
              dataKey={t.address}
              name={t.symbol}
              stackId="1"
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <CustomLegend tokens={data.tokens} total={total} />
    </div>
  )
}
