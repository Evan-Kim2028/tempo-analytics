import { Mppx, tempo } from 'mppx/server'
import { publicClient } from '@/lib/chain'

const AMOUNT = '100000' // $0.10 in USDC 6-decimal base units

export function chargeHandler(respond: () => Promise<Response>) {
  // Read env vars lazily (so tests can set them in beforeEach)
  const currency0 = process.env.USDC_ADDRESS    ?? ''
  const currency1 = process.env.PATH_USD_ADDRESS ?? ''
  const recipient  = process.env.PAYMENT_ADDRESS ?? ''

  const method = tempo.charge({ getClient: () => publicClient })
  const server = Mppx.create({ methods: [method], realm: 'tempo-analytics' })
  const composed = server.compose(
    [method, { amount: AMOUNT, currency: currency0, recipient }],
    [method, { amount: AMOUNT, currency: currency1, recipient }],
  )

  return async (req: Request): Promise<Response> => {
    const result = await composed(req)
    if (result.status === 402) return result.challenge
    return result.withReceipt(await respond())
  }
}
