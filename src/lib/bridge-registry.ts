export type BridgeProviderId = 'stargate' | 'usdt0' | 'frax'

export type BridgeContractRole =
  | 'router'
  | 'pool'
  | 'vault'
  | 'escrow'
  | 'token'
  | 'adapter'
  | 'endpoint'
  | 'messenger'

export interface BridgeProvider {
  id: BridgeProviderId
  label: string
}

export interface BridgeContract {
  provider: BridgeProviderId
  address: `0x${string}`
  role: BridgeContractRole
  asset: string
  confidence: 'verified'
}

export const BRIDGE_PROVIDERS: readonly BridgeProvider[] = [
  { id: 'stargate', label: 'Stargate' },
  { id: 'usdt0', label: 'USDT0' },
  { id: 'frax', label: 'Frax' },
] as const

// Verified from Tempo's mainnet token list.
export const BRIDGE_CONTRACTS: readonly BridgeContract[] = [
  { provider: 'stargate', address: '0x20c000000000000000000000b9537d11c60e8b50', role: 'token', asset: 'USDC.e', confidence: 'verified' },
  { provider: 'stargate', address: '0x20c0000000000000000000001621e21f71cf12fb', role: 'token', asset: 'EURC.e', confidence: 'verified' },
  { provider: 'usdt0', address: '0x20c00000000000000000000014f22ca97301eb73', role: 'token', asset: 'USDT0', confidence: 'verified' },
  { provider: 'frax', address: '0x20c0000000000000000000003554d28269e0f3c2', role: 'token', asset: 'frxUSD', confidence: 'verified' },
] as const

export function getBridgeContractsForProvider(provider: BridgeProviderId): BridgeContract[] {
  return BRIDGE_CONTRACTS.filter(contract => contract.provider === provider)
}

export function getBridgeTokenAddresses(): `0x${string}`[] {
  return BRIDGE_CONTRACTS
    .filter(contract => contract.role === 'token')
    .map(contract => contract.address)
}

