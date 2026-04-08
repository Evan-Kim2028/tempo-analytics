import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import type { WalletContextState } from '@solana/wallet-adapter-react'

export interface SolanaPaymentRequest {
  recipient: string
  amount: string
  currency: string // USDC mint address
}

export interface TempoPaymentRequest {
  recipient: string
  amount: string
  currency: string // USDC.e contract address
}

type PartialWallet = Pick<WalletContextState, 'publicKey' | 'signTransaction'>

export async function payWithSolana(
  request: SolanaPaymentRequest,
  wallet: PartialWallet,
  connection: Connection,
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected')
  }

  const payerPk     = wallet.publicKey
  const recipientPk = new PublicKey(request.recipient)
  const mintPk      = new PublicKey(request.currency)
  const amount      = BigInt(request.amount)

  const payerAta     = getAssociatedTokenAddressSync(mintPk, payerPk)
  const recipientAta = getAssociatedTokenAddressSync(mintPk, recipientPk)

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payerPk })

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta)
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payerPk, recipientAta, recipientPk, mintPk,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    )
  }

  tx.add(
    createTransferInstruction(payerAta, recipientAta, payerPk, amount, [], TOKEN_PROGRAM_ID)
  )

  const signed = await wallet.signTransaction(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export async function payWithTempo(request: TempoPaymentRequest): Promise<string> {
  const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum
  if (!ethereum) throw new Error('No EVM wallet detected. Install MetaMask or Rabby.')

  const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const from = accounts[0]

  // ABI-encode ERC-20 transfer(address to, uint256 amount)
  // selector: keccak256("transfer(address,uint256)")[0:4] = 0xa9059cbb
  const paddedTo     = request.recipient.toLowerCase().replace('0x', '').padStart(64, '0')
  const paddedAmount = BigInt(request.amount).toString(16).padStart(64, '0')
  const data = `0xa9059cbb${paddedTo}${paddedAmount}`

  const hash = await ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: request.currency, data }],
  }) as string

  return hash
}
