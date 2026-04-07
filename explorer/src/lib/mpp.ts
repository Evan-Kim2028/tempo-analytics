import { parseUnits } from 'viem'
import { getCached, setCached } from '@/lib/cache'
import { publicClient } from '@/lib/chain'
import { randomBytes } from 'crypto'

const EXPORT_PRICE_USDC = '0.10'

export interface MppChallenge {
  price: string
  currency: string
  recipient: string
  nonce: string
  expires: number
}

export function createChallenge(): MppChallenge {
  return {
    price: EXPORT_PRICE_USDC,
    currency: 'USDC',
    recipient: process.env.PAYMENT_ADDRESS ?? '',
    nonce: randomBytes(16).toString('hex'),
    expires: Math.floor(Date.now() / 1000) + 300,
  }
}

export interface PaymentVerification {
  ok: boolean
  error?: string
}

export async function verifyPayment(txHash: string): Promise<PaymentVerification> {
  const usedKey = `used_tx:${txHash.toLowerCase()}`
  const alreadyUsed = await getCached<string>(usedKey)
  if (alreadyUsed) return { ok: false, error: 'Payment tx already used' }

  const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS
  const USDC_ADDRESS = process.env.USDC_ADDRESS

  if (!PAYMENT_ADDRESS || !USDC_ADDRESS) {
    return { ok: false, error: 'Payment not configured on server' }
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    })

    if (receipt.status !== 'success') {
      return { ok: false, error: 'Transaction failed on-chain' }
    }

    // Filter Transfer logs directly from receipt (no extra RPC call needed)
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const paddedPaymentAddr = PAYMENT_ADDRESS.toLowerCase().replace('0x', '0x000000000000000000000000')

    const paymentLog = receipt.logs.find(log =>
      log.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics[2]?.toLowerCase() === paddedPaymentAddr
    )

    if (!paymentLog) {
      return { ok: false, error: 'No USDC transfer to payment address found in tx' }
    }

    // Decode uint256 value from data field (32-byte ABI-encoded)
    const transferred = BigInt(paymentLog.data)
    const minAmount = parseUnits(EXPORT_PRICE_USDC, 6)

    if (transferred < minAmount) {
      return { ok: false, error: `Insufficient payment: need ≥ $${EXPORT_PRICE_USDC} USDC` }
    }

    await setCached(usedKey, 'used', 172800)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Verification failed: ${(err as Error).message}` }
  }
}
