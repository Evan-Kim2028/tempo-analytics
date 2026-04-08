# tempo-analytics — Development Conventions

## Chart data contract

Every recharts chart must be fed by a **server-side data function** that returns
pre-shaped data. Never compute pivots or data transforms inside a `'use client'`
component — pass ready-to-render data from the server.

### Why

Recharts needs a stable, serialized data array to render visible bars and lines.
Client-side transforms can silently produce invisible charts (bars at height 0,
series that don't appear) with no error in the console.

### Pattern (static dataKeys)

```ts
// lib/analytics.ts
export interface MyChartPoint { day: string; my_metric: number }
export async function getMyChartData(days = 30): Promise<MyChartPoint[]> { ... }
```

```tsx
// components/charts/MyChart.tsx
'use client'
export function MyChart({ data }: { data: MyChartPoint[] }) {
  return <BarChart data={data}><Bar dataKey="my_metric" /></BarChart>
}
```

### Pattern (dynamic / stacked dataKeys)

```ts
// lib/analytics.ts
export interface MyPivotData {
  days:   Array<Record<string, string | number>>  // { day, seriesKeyA: number, ... }
  series: Array<{ id: string; label: string; total: number }>
}
export async function getMyPivotData(days = 30): Promise<MyPivotData> { ... }
```

```tsx
// components/charts/MyChart.tsx — receives pre-pivoted data, no transforms
'use client'
export function MyChart({ data }: { data: MyPivotData }) {
  return (
    <BarChart data={data.days}>
      {data.series.map(s => <Bar key={s.id} dataKey={s.id} />)}
    </BarChart>
  )
}
```

### Adding a new chart — checklist

1. Create the server-side data function in the relevant `src/lib/` file.
2. Add a contract test in `__tests__/lib/chart-data-contracts.test.ts`:
   - Static dataKeys → `expectRechartsRows(rows, ['my_metric', ...])`
   - Dynamic dataKeys → `expectPivotContract(data.days, data.series.map(s => ({ key: s.id })))`
3. Import helpers from `__tests__/helpers/chart-contract.ts`.

The contract tests enforce:
- `day` fields are present as strings (≥10 chars)
- All recharts `dataKey` values are finite numbers (not NaN, not undefined)
- Pivot charts: every series key appears in at least one days row

## CI verification

Always run `npm test` and `npm run build` locally before committing.
