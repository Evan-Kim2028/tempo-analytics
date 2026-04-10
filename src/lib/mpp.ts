import { Mppx, tempo } from 'mppx/server'
import { publicClient } from '@/lib/chain'

const AMOUNT = '100000' // $0.10 in USDC 6-decimal base units

export function chargeHandler(respond: () => Promise<Response>) {
  // Read env vars lazily (so tests can set them in beforeEach)
  const currency0 = process.env.USDC_ADDRESS    ?? ''
  const currency1 = process.env.PATH_USD_ADDRESS ?? ''
  const recipient  = process.env.PAYMENT_ADDRESS ?? ''

  // Create a fresh method per call with the respond callback baked in.
  // respond is a field on Method.Server (not a charge.Parameters key),
  // so we set it on the returned method object.
  const method = tempo.charge({ getClient: () => publicClient })
  method.respond = respond as typeof method.respond
  const server = Mppx.create({ methods: [method], realm: 'tempo-analytics' })

  return server.compose(
    [method, { amount: AMOUNT, currency: currency0, recipient }],
    [method, { amount: AMOUNT, currency: currency1, recipient }],
  )
}
