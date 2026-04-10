// explorer/src/lib/chain.ts
import { createPublicClient, http, defineChain } from 'viem'

const isTestnet = process.env.TEMPO_TESTNET === 'true'

export const tempoChain = defineChain({
  id: isTestnet ? 42431 : 4217,
  name: isTestnet ? 'Tempo Moderato' : 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.TEMPO_RPC_URL ?? (isTestnet ? 'https://rpc.moderato.tempo.xyz' : 'https://rpc.mainnet.tempo.xyz')] },
  },
})

export const publicClient = createPublicClient({
  chain: tempoChain,
  transport: http(),
})
