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
    expect(getBridgeContractsForProvider(provider.id).length).toBeGreaterThan(0)
  }
})

test('registry exposes bridge token addresses for rollups', () => {
  const addresses = getBridgeTokenAddresses()
  expect(addresses.length).toBeGreaterThan(0)
  expect(addresses.every(a => a.startsWith('0x'))).toBe(true)
})

