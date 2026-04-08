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

// ── payWithTempo ─────────────────────────────────────────────────────────────

const MOCK_TX_HASH = '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1'

function mockEthereum(hash = MOCK_TX_HASH) {
  return {
    request: jest.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve(['0xDeadBeef00000000000000000000000000000001'])
      if (method === 'eth_sendTransaction') return Promise.resolve(hash)
      return Promise.reject(new Error(`Unknown method: ${method}`))
    }),
  }
}

test('payWithTempo requests accounts then sends ERC-20 transfer', async () => {
  const eth = mockEthereum()
  Object.defineProperty(global, 'window', {
    value: { ethereum: eth },
    writable: true,
  })

  const hash = await payWithTempo({
    recipient: '0xc8BDAEDEcB05001B5EC22D273393792274f59281',
    amount: '100000',
    currency: '0x20C000000000000000000000b9537d11c60E8b50',
  })

  expect(hash).toBe(MOCK_TX_HASH)
  expect(eth.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  const sendCall = eth.request.mock.calls.find(
    (c: [{ method: string }]) => c[0].method === 'eth_sendTransaction'
  )
  expect(sendCall).toBeDefined()
  const txParams = sendCall[0].params[0]
  expect(txParams.to).toBe('0x20C000000000000000000000b9537d11c60E8b50')
  // data starts with transfer selector 0xa9059cbb
  expect(txParams.data.startsWith('0xa9059cbb')).toBe(true)
})

test('payWithTempo throws if no EVM wallet detected', async () => {
  Object.defineProperty(global, 'window', { value: {}, writable: true })
  await expect(
    payWithTempo({
      recipient: '0xc8BDAEDEcB05001B5EC22D273393792274f59281',
      amount: '100000',
      currency: '0x20C000000000000000000000b9537d11c60E8b50',
    })
  ).rejects.toThrow('No EVM wallet detected')
})
