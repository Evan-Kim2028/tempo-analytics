import { NextRequest } from 'next/server'
import { getProtocolDexPoolTrades } from '@/lib/analytics'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    return Response.json({ error: 'invalid token address' }, { status: 400 })
  }

  const trades = await getProtocolDexPoolTrades(token.toLowerCase())
  return Response.json(trades)
}
