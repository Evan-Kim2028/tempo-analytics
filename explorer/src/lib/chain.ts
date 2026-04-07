// explorer/src/lib/chain.ts
import { createPublicClient, http, defineChain } from 'viem'

export const tempoChain = defineChain({
  id: 4217,
  name: 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.TEMPO_RPC_URL ?? 'https://rpc.mainnet.tempo.xyz'] },
  },
})

export const publicClient = createPublicClient({
  chain: tempoChain,
  transport: http(),
})
