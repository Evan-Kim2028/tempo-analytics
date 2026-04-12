import { Mppx, solana } from '@solana/mpp/client'
import { Mppx as MppxCore, tempo } from 'mppx/client'
import { createWalletClient, custom } from 'viem'
import { tempo as tempoChain } from 'viem/chains'
import type { TransactionSigner } from '@solana/kit'

export function createSolanaMppxClient(signer: TransactionSigner) {
  return Mppx.create({
    methods: [solana.charge({ signer, broadcast: true })],
    polyfill: false,
  })
}

export function createTempoMppxClient() {
  return MppxCore.create({
    methods: [tempo.charge({
      getClient: async () => {
        const ethereum = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
        if (!ethereum) throw new Error('No EVM wallet detected. Install MetaMask or Rabby.')
        const [address] = await ethereum.request({ method: 'eth_requestAccounts' }) as [string]
        return createWalletClient({
          account: address as `0x${string}`,
          chain: tempoChain,
          transport: custom(ethereum),
        })
      },
    })],
    polyfill: false,
  })
}
