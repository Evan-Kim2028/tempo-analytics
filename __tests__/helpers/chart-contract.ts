/**
 * Chart Data Contract Helpers
 * ============================
 * Every recharts chart in this app must be fed by a server-side data function
 * that returns pre-shaped data. These helpers assert the invariants recharts needs
 * to actually render visible bars/lines:
 *
 *   - day fields are present and in YYYY-MM-DD format (at least 10 chars)
 *   - all values used as recharts dataKey props are finite numbers (never NaN,
 *     never undefined, never null — recharts silently drops such entries)
 *   - pivot charts: every key in the series list appears in the days rows
 *
 * Usage
 * -----
 * Simple array charts (static dataKeys like `dataKey="batch_txs"`):
 *   expectRechartsRow(rows[0], ['batch_txs', 'sponsored_txs'])
 *
 * Pivot/stacked charts (dynamic dataKeys like `dataKey={token.address}`):
 *   expectPivotContract(data.days, data.tokens.map(t => ({ key: t.address })))
 *
 * Adding a new chart
 * ------------------
 * 1. Create a server-side data function that returns pre-pivoted data.
 *    Never compute pivots inside a client component — pass ready-to-render data.
 * 2. Add a contract test in __tests__/lib/chart-data-contracts.test.ts using
 *    these helpers.
 */

/**
 * Asserts that a single recharts data row satisfies the render contract:
 *   - has a `day` string of at least 10 chars
 *   - all specified numeric fields are finite, non-NaN numbers
 */
export function expectRechartsRow(
  row: Record<string, unknown>,
  numericKeys: string[],
): void {
  expect(row).toHaveProperty('day')
  expect(typeof row['day']).toBe('string')
  expect((row['day'] as string).length).toBeGreaterThanOrEqual(10)

  for (const key of numericKeys) {
    const value = row[key]
    expect({ key, typeofValue: typeof value }).toEqual({ key, typeofValue: 'number' })
    expect({ key, isNaN: Number.isNaN(value) }).toEqual({ key, isNaN: false })
    expect({ key, isFinite: Number.isFinite(value) }).toEqual({ key, isFinite: true })
  }
}

/**
 * Asserts that an array of recharts rows all satisfy the render contract
 * for the given numeric keys.
 */
export function expectRechartsRows(
  rows: Array<Record<string, unknown>>,
  numericKeys: string[],
): void {
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expectRechartsRow(row, numericKeys)
  }
}

/**
 * Asserts the pivot contract for stacked/dynamic-key charts:
 *   - days array is non-empty
 *   - series array is non-empty
 *   - every series key appears in at least one days row as a finite number
 *   - no days row has NaN/non-number for any series key that IS present
 *
 * @param days   The array passed to <BarChart data={...}> or <LineChart data={...}>
 * @param series Array of { key } objects where key is the recharts dataKey value
 */
export function expectPivotContract(
  days: Array<Record<string, unknown>>,
  series: Array<{ key: string }>,
): void {
  expect(days.length).toBeGreaterThan(0)
  expect(series.length).toBeGreaterThan(0)

  for (const { key } of series) {
    const rowsWithKey = days.filter(d => d[key] !== undefined)
    // Every series key must appear in at least one row
    expect({ key, rowsWithKey: rowsWithKey.length }).not.toEqual({ key, rowsWithKey: 0 })

    for (const row of rowsWithKey) {
      expect({ key, typeofValue: typeof row[key] }).toEqual({ key, typeofValue: 'number' })
      expect({ key, isNaN: Number.isNaN(row[key]) }).toEqual({ key, isNaN: false })
      expect({ key, isFinite: Number.isFinite(row[key]) }).toEqual({ key, isFinite: true })
    }
  }
}
