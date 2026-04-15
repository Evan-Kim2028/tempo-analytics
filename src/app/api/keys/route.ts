import { NextResponse } from 'next/server'
import { calculateCredits } from '@/lib/payment-compose'

const keys = new Map<string, { owner: string; balance: number; createdAt: string; expiresAt: string }>()

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { deposit?: string; owner?: string; expiry?: number }

  if (!body.deposit || !body.owner) {
    return NextResponse.json({ error: 'deposit and owner required' }, { status: 400 })
  }

  const credits = calculateCredits(BigInt(body.deposit))
  if (credits <= 0) return NextResponse.json({ error: 'deposit too small' }, { status: 400 })

  const apiKey = `tak_${crypto.randomUUID().replace(/-/g, '')}`
  const expiryDays = body.expiry ?? 30
  const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString()

  keys.set(apiKey, {
    owner: body.owner,
    balance: credits,
    createdAt: new Date().toISOString(),
    expiresAt,
  })

  return NextResponse.json({ apiKey, credits, expiresAt })
}

export async function GET() {
  const all = Array.from(keys.entries()).map(([key, data]) => ({
    key: `${key.slice(0, 8)}...${key.slice(-4)}`,
    ...data,
  }))
  return NextResponse.json(all)
}
