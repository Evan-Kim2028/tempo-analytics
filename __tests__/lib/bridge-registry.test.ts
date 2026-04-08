import {
  BRIDGE_PROVIDERS,
  BRIDGE_CONTRACTS,
  getBridgeContractsForProvider,
  getBridgeTokenAddresses,
} from '@/lib/bridge-registry'

test('registry exposes only verified v1 providers', () => {
  expect(BRIDGE_PROVIDERS.map(p => p.id)).toEqual(['stargate', 'usdt0', 'frax'])
})

test('each verified provider has at least one Tempo contract mapping', () => {
  for (const provider of BRIDGE_PROVIDERS) {
    expect(getBridgeContractsForProvider(provider.id)).toEqual(
      BRIDGE_CONTRACTS.filter(contract => contract.provider === provider.id),
    )
  }
})

test('registry exposes the verified bridge contract set', () => {
  expect(
    BRIDGE_CONTRACTS.map(({ provider, role, address, asset, confidence }) => ({
      provider,
      role,
      address: address.toLowerCase(),
      asset,
      confidence,
    })),
  ).toEqual([
    { provider: 'stargate', role: 'token', address: '0x20c000000000000000000000b9537d11c60e8b50', asset: 'USDC.e', confidence: 'verified' },
    { provider: 'stargate', role: 'adapter', address: '0x8c76e2f6c5ceda9aa7772e7eff30280226c44392', asset: 'USDC.e', confidence: 'verified' },
    { provider: 'stargate', role: 'token', address: '0x20c0000000000000000000001621e21f71cf12fb', asset: 'EURC.e', confidence: 'verified' },
    { provider: 'stargate', role: 'adapter', address: '0x7753dc8d4bd48db599da21e08b1ab1d6fdffdc71', asset: 'EURC.e', confidence: 'verified' },
    { provider: 'usdt0', role: 'token', address: '0x20c00000000000000000000014f22ca97301eb73', asset: 'USDT0', confidence: 'verified' },
    { provider: 'usdt0', role: 'adapter', address: '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff', asset: 'USDT0', confidence: 'verified' },
    { provider: 'usdt0', role: 'adapter', address: '0xbb95daf376cd63f258d7c37a4efe57c10055e8e0', asset: 'USDT0', confidence: 'verified' },
    { provider: 'frax', role: 'token', address: '0x20c0000000000000000000003554d28269e0f3c2', asset: 'frxUSD', confidence: 'verified' },
    { provider: 'frax', role: 'adapter', address: '0x00000000d61733e7a393a10a5b48c311abe8f1e5', asset: 'frxUSD', confidence: 'verified' },
  ])
})

test('registry exposes bridge token addresses for rollups', () => {
  const addresses = getBridgeTokenAddresses()
  expect(addresses).toEqual(
    BRIDGE_CONTRACTS
      .filter(contract => contract.role === 'token')
      .map(contract => contract.address),
  )
})
