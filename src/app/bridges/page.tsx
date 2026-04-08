import {
  getDailyBridgeProviderAssetFlows,
  getDailyBridgeProviderFlows,
} from '@/lib/bridges'
import { BridgeFlowTable } from '@/components/BridgeFlowTable'

export const revalidate = 900

export default async function BridgesPage() {
  const [providerFlows, providerAssetFlows] = await Promise.all([
    getDailyBridgeProviderFlows(30),
    getDailyBridgeProviderAssetFlows(30),
  ])

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">Bridges</h1>
        <p className="text-tempo-muted text-sm">
          Provider-first bridge flows on Tempo Mainnet. The tables below show 30-day daily rollups by provider and by asset.
        </p>
      </div>

      <BridgeFlowTable providerFlows={providerFlows} providerAssetFlows={providerAssetFlows} />
    </main>
  )
}
