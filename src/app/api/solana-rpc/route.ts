import { NextRequest } from 'next/server'

const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const data = await res.text()
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
