import { createPublicClient, http, parseUnits, defineChain } from 'viem'
import { getCached, setCached } from '@/lib/cache'
import { randomBytes } from 'crypto'

const tempo = defineChain({
  id: 4217,
  name: 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.tempo.xyz'] },
  },
})

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
    const client = createPublicClient({ chain: tempo, transport: http() })

    const receipt = await client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    })

    if (receipt.status !== 'success') {
      return { ok: false, error: 'Transaction failed on-chain' }
    }

    const logs = await client.getLogs({
      address: USDC_ADDRESS as `0x${string}`,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { indexed: true, name: 'from', type: 'address' },
          { indexed: true, name: 'to', type: 'address' },
          { indexed: false, name: 'value', type: 'uint256' },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    })

    const paymentLog = logs.find(
      log =>
        log.transactionHash?.toLowerCase() === txHash.toLowerCase() &&
        (log.args as { to?: string }).to?.toLowerCase() === PAYMENT_ADDRESS.toLowerCase()
    )

    if (!paymentLog) {
      return { ok: false, error: 'No USDC transfer to payment address found in tx' }
    }

    const transferred = (paymentLog.args as { value?: bigint }).value ?? BigInt(0)
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
