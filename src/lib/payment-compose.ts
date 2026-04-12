import { Mppx, tempo } from 'mppx/server'
import { solana } from '@solana/mpp/server'

const TEMPO_USDC_E = '0x20C000000000000000000000b9537d11c60E8b50'
const TEMPO_RECIPIENT = process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}`
if (!TEMPO_RECIPIENT) {
  throw new Error('TEMPO_RECIPIENT_ADDRESS env var is required')
}
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOLANA_RECIPIENT = process.env.SOLANA_RECIPIENT_ADDRESS
const EXPORT_PRICE = '0.01'
const SOLANA_EXPORT_PRICE = '10000'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mppx: any = null

export function getPaymentInstance() {
  if (!_mppx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods: any[] = [
      tempo.charge({ recipient: TEMPO_RECIPIENT, currency: TEMPO_USDC_E }),
    ]
    if (SOLANA_RECIPIENT) {
      methods.push(
        solana.charge({ recipient: SOLANA_RECIPIENT, currency: SOLANA_USDC, decimals: 6 }),
      )
    }
    _mppx = Mppx.create({ methods })
  }
  return _mppx
}

export interface PaymentResult {
  status: 402 | 200
  alreadyConsumed: boolean
  challenge?: Response
  wrapResponse: (res: Response) => Response
}

export async function composePayment(req: Request, amount: string): Promise<PaymentResult> {
  const mppx = getPaymentInstance()
  const entries: [unknown, { amount: string }][] = [
    [mppx.tempo.charge, { amount: EXPORT_PRICE }],
  ]
  if (mppx.solana) {
    entries.push([mppx.solana.charge, { amount: SOLANA_EXPORT_PRICE }])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any
  let alreadyConsumed = false
  try {
    result = await mppx.compose(...entries)(req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/already consumed/i.test(msg) || /already been used/i.test(msg)) {
      alreadyConsumed = true
    } else {
      throw e
    }
  }

  if (!alreadyConsumed && result.status === 402) {
    return {
      status: 402,
      alreadyConsumed: false,
      challenge: result.challenge,
      wrapResponse: (res: Response) => res,
    }
  }

  return {
    status: 200,
    alreadyConsumed,
    wrapResponse: (res: Response) => alreadyConsumed ? res : result.withReceipt(res),
  }
}

// ── Session balance management ──

const CREDIT_TIERS = [
  { minDeposit: BigInt(100000), creditsPerCent: 13 / 10 },
  { minDeposit: BigInt(50000), creditsPerCent: 6 / 5 },
  { minDeposit: BigInt(0), creditsPerCent: 1 },
]

export function calculateCredits(depositSmallestUnits: bigint): number {
  const cents = Number(depositSmallestUnits) / 10000
  for (const tier of CREDIT_TIERS) {
    if (depositSmallestUnits >= tier.minDeposit) {
      return Math.floor(cents * tier.creditsPerCent)
    }
  }
  return 0
}

const sessionBalances = new Map<string, number>()

export function getSessionBalance(sessionId: string): number {
  return sessionBalances.get(sessionId) ?? 0
}

export function setSessionBalance(sessionId: string, credits: number): void {
  if (credits <= 0) {
    sessionBalances.delete(sessionId)
  } else {
    sessionBalances.set(sessionId, credits)
  }
}

export function deductSessionCredit(sessionId: string): boolean {
  const balance = sessionBalances.get(sessionId)
  if (!balance || balance <= 0) return false
  if (balance === 1) {
    sessionBalances.delete(sessionId)
  } else {
    sessionBalances.set(sessionId, balance - 1)
  }
  return true
}
