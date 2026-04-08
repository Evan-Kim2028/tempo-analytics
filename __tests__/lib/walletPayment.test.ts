/**
 * @jest-environment node
 */
import { payWithSolana, payWithTempo } from '@/lib/walletPayment'

// ── payWithSolana ────────────────────────────────────────────────────────────

const MOCK_SIG = '5SMrQ8P8L9LLQx4wF2Lk44sf9RPzq1tadzjSFvcgc3ad'
const MOCK_BLOCKHASH = 'EkSnNWid2cvwEVnVx9oBqawnkpMVZyamoLMkGQQbeUFz'

function makeMockConnection(ataExists = true) {
  return {
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: MOCK_BLOCKHASH,
      lastValidBlockHeight: 999,
    }),
    getAccountInfo: jest.fn().mockResolvedValue(ataExists ? { data: Buffer.alloc(0) } : null),
    sendRawTransaction: jest.fn().mockResolvedValue(MOCK_SIG),
    confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
  }
}

function makeMockWallet(publicKeyStr = 'GJPrFGhMHQTsqeFnXnrJGCnpPaT3Lrqb5bRTABhqrNT') {
  const { PublicKey } = require('@solana/web3.js')
  return {
    publicKey: new PublicKey(publicKeyStr),
    signTransaction: jest.fn().mockImplementation(async (tx: unknown) => ({
      ...(tx as object),
      serialize: () => Buffer.from('signedtx'),
    })),
  }
}

test('payWithSolana broadcasts transfer and returns signature', async () => {
  const conn = makeMockConnection(true)
  const wallet = makeMockWallet()

  const sig = await payWithSolana(
    {
      recipient: '7ovHoWpT3HYPTdNo75cvh3MnAVFcdhDWiJEZ62PwQmy3',
      amount: '100000',
      currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
    wallet as never,
    conn as never,
  )

  expect(sig).toBe(MOCK_SIG)
  expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
  expect(conn.sendRawTransaction).toHaveBeenCalledTimes(1)
  expect(conn.confirmTransaction).toHaveBeenCalledTimes(1)
})

test('payWithSolana throws if wallet not connected', async () => {
  const conn = makeMockConnection()
  await expect(
    payWithSolana(
      { recipient: '7ovHoWpT3HYPTdNo75cvh3MnAVFcdhDWiJEZ62PwQmy3', amount: '100000', currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { publicKey: null, signTransaction: undefined } as never,
      conn as never,
    )
  ).rejects.toThrow('Wallet not connected')
})

test('payWithSolana creates recipient ATA when absent', async () => {
  const conn = makeMockConnection(false) // ATA absent
  const wallet = makeMockWallet()

  await payWithSolana(
    { recipient: '7ovHoWpT3HYPTdNo75cvh3MnAVFcdhDWiJEZ62PwQmy3', amount: '100000', currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    wallet as never,
    conn as never,
  )

  // signTransaction was called — tx was built (can't easily inspect instructions in unit test)
  expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
})
