import { NextRequest, NextResponse } from 'next/server'
import { calculateCredits, setSessionBalance, getSessionBalance, deductSessionCredit } from '@/lib/payment-compose'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    action?: string
    deposit?: string
    sessionId?: string
  }

  if (body.action === 'open') {
    if (!body.deposit) return NextResponse.json({ error: 'deposit required' }, { status: 400 })
    const deposit = BigInt(body.deposit)
    const credits = calculateCredits(deposit)
    if (credits <= 0) return NextResponse.json({ error: 'deposit too small' }, { status: 400 })
    const sessionId = crypto.randomUUID()
    setSessionBalance(sessionId, credits)
    return NextResponse.json({ sessionId, credits })
  }

  if (body.action === 'balance') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    return NextResponse.json({ credits: getSessionBalance(body.sessionId) })
  }

  if (body.action === 'use') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const ok = deductSessionCredit(body.sessionId)
    if (!ok) return NextResponse.json({ error: 'no credits remaining' }, { status: 402 })
    return NextResponse.json({ credits: getSessionBalance(body.sessionId) })
  }

  if (body.action === 'close') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const remaining = getSessionBalance(body.sessionId)
    setSessionBalance(body.sessionId, 0)
    return NextResponse.json({ closed: true, refundedCredits: remaining })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
