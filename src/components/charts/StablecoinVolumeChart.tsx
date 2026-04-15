'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { StablecoinDailyStat } from '@/lib/analytics'

const PALETTE = [
  '#0057FF', '#10B981', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16',
  '#FB923C', '#22D3EE', '#A78BFA', '#F472B6',
  '#4ADE80', '#FACC15', '#60A5FA', '#FCA5A5',
  '#6B7280',
]

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

function CustomLegend({ tokens, total }: {
  tokens: StablecoinDailyStat['tokens']
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
          <span className="text-white font-mono">{fmtUSD.format(t.volume_total)}</span>
          <span className="text-tempo-muted">
            ({total > 0 ? ((t.volume_total / total) * 100).toFixed(1) : '0'}%)
          </span>
        </div>
      ))}
    </div>
  )
}

export function StablecoinVolumeChart({ data }: { data: StablecoinDailyStat }) {
  const total = data.tokens.reduce((s, t) => s + t.volume_total, 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
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
              const token = data.tokens.find(t => t.address === entry.dataKey)
              return [fmtUSD.format(v), token?.symbol ?? entry.dataKey]
            }}
          />
          {data.tokens.map((t, i) => (
            <Bar
              key={t.address}
              dataKey={t.address}
              name={t.symbol}
              stackId="1"
              fill={PALETTE[i % PALETTE.length]}
              radius={i === data.tokens.length - 1 ? [2, 2, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <CustomLegend tokens={data.tokens} total={total} />
    </div>
  )
}
