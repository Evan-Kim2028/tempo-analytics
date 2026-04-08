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

// payWithTempo — implemented in Task 4
export async function payWithTempo(_request: TempoPaymentRequest): Promise<string> {
  throw new Error('Not implemented')
}
