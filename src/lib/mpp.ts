import { Mppx, tempo } from 'mppx/server'
import { publicClient } from '@/lib/chain'

const AMOUNT = '0.01' // $0.01 — mppx scales by 10^decimals internally

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cached: { method: any; server: any } | null = null

function getServer() {
  if (!_cached) {
    const method = tempo.charge({
      getClient: () => publicClient,
      testnet: process.env.TEMPO_TESTNET === 'true',
    })
    _cached = { method, server: Mppx.create({ methods: [method], realm: 'tempo-analytics' }) }
  }
  return _cached
}

export function chargeHandler(respond: () => Promise<Response>) {
  const { method, server } = getServer()
  const currencies = [process.env.USDC_ADDRESS, process.env.PATH_USD_ADDRESS].filter(Boolean) as string[]
  const recipient  = process.env.PAYMENT_ADDRESS ?? ''
  const entries = currencies.map(currency =>
    [method, { amount: AMOUNT, currency, recipient }] as const
  )
  const composed = server.compose(...entries)

  return async (req: Request): Promise<Response> => {
    const result = await composed(req)
    if (result.status === 402) return result.challenge
    return result.withReceipt(await respond())
  }
}
