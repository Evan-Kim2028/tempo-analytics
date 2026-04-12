import { NextRequest, NextResponse } from 'next/server'
import { getQuery, executeQuery, formatJson } from '@/lib/dataService'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { query?: string; params?: Record<string, string> }
  const { query: queryKey, params } = body

  const entry = getQuery(queryKey ?? '')
  if (!entry) {
    return NextResponse.json({ error: 'Unknown query' }, { status: 400 })
  }

  try {
    const result = await executeQuery(queryKey!, params)
    return NextResponse.json(formatJson(result))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Query failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
