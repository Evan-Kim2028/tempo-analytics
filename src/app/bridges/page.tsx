import {
  getBridgeNetInflowChartData,
  getRecentBridgeEvents,
} from '@/lib/bridges'
import { BridgeFlowTable } from '@/components/BridgeFlowTable'
import { BridgeNetInflowChart } from '@/components/charts/BridgeNetInflowChart'

export const revalidate = 900

export default async function BridgesPage() {
  const [recentEvents, chartData] = await Promise.all([
    getRecentBridgeEvents(50, 30),
    getBridgeNetInflowChartData(30),
  ])

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">Bridges</h1>
        <p className="text-tempo-muted text-sm">
          Provider-first bridge flows on Tempo Mainnet. The chart shows 30-day daily net inflows by provider.
        </p>
      </div>

      <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-8">
        <h2 className="text-base font-medium text-white mb-1">Daily Net Inflow by Provider (30d)</h2>
        <p className="text-tempo-muted text-xs mb-4">Stacked net flow (inflow − outflow) per bridge provider per day.</p>
        <BridgeNetInflowChart data={chartData} />
      </div>

      <BridgeFlowTable events={recentEvents} />
    </main>
  )
}
