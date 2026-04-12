// src/app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getQuery, executeQuery, formatCsv } from '@/lib/dataService'
import { composePayment } from '@/lib/payment-compose'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { query?: string }
  const { query: queryKey } = body

  const entry = getQuery(queryKey ?? '')
  if (!entry) {
    return NextResponse.json({ error: 'Unknown export query' }, { status: 400 })
  }

  // Session-based access: credit already deducted by the client
  const sessionId = req.headers.get('X-Session-Id')
  if (sessionId) {
    try {
      const result = await executeQuery(queryKey!)
      const csv = formatCsv(result)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
        },
      })
    } catch (e) {
      console.error('Export query failed (session):', e)
      return NextResponse.json({ error: 'Data query failed' }, { status: 503 })
    }
  }

  // Standard mppx payment flow
  let payment
  try {
    payment = await composePayment(req, entry.price)
  } catch (e) {
    console.error('Payment compose error:', e)
    return NextResponse.json(
      { error: 'Payment verification error. The transaction may not be confirmed yet — wait a moment and retry.' },
      { status: 502 },
    )
  }

  if (payment.status === 402) return payment.challenge!

  try {
    const result = await executeQuery(queryKey!)
    const csv = formatCsv(result)
    return payment.wrapResponse(
      new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"`,
        },
      }),
    )
  } catch (e) {
    console.error('Export query failed after payment:', e)
    return payment.wrapResponse(
      NextResponse.json(
        { error: 'Data query failed. Payment was accepted — retry the export with the same credential.' },
        { status: 503 },
      ),
    )
  }
}
