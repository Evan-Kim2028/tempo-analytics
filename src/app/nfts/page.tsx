import {
  getTopNFTCollections,
  getNFTDailyActivity,
  getNFTMinterConcentration,
  getTopNFTMinters,
} from '@/lib/analytics'
import { getTokenInfo } from '@/lib/tokens'

export const revalidate = 900

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function NFTsPage() {
  const [collections, daily, concentration, topMinters] = await Promise.all([
    getTopNFTCollections(20),
    getNFTDailyActivity(30),
    getNFTMinterConcentration(),
    getTopNFTMinters(50),
  ])

  // Resolve collection names (best-effort)
  const collectionNames = await Promise.all(
    collections.map(c => getTokenInfo(c.collection))
  )

  const totalTransfers30d = daily.reduce((s, d) => s + d.transfers, 0)
  const uniqueCollections30d = daily.length > 0
    ? Math.max(...daily.map(d => d.active_collections))
    : 0

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">NFTs</h1>
        <p className="text-tempo-muted text-sm">
          ERC-721 transfer activity on Tempo Mainnet.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfers</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalTransfers30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Active Collections (peak 30d)</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(uniqueCollections30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Top 10 Minters</p>
          <p className="text-2xl font-semibold text-white">{(concentration.top10_share_pct ?? 0).toFixed(1)}%</p>
          <p className="text-tempo-muted text-xs mt-1">of all-time mints</p>
        </div>
      </div>

      {/* Top collections table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">Top Collections (all time)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left px-6 py-3 text-tempo-muted font-normal">Collection</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">All-time Transfers</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">Days Active</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((c, i) => {
                const info = collectionNames[i]
                return (
                  <tr key={c.collection} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                    <td className="px-6 py-4">
                      {info && (
                        <span className="text-white font-medium mr-2">{info.symbol}</span>
                      )}
                      <a href={`/address/${c.collection}`} className="font-mono text-xs text-tempo-blue hover:underline">
                        {c.collection.slice(0, 10)}…{c.collection.slice(-6)}
                      </a>
                    </td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtCount(c.total_transfers)}</td>
                    <td className="text-right px-6 py-4 text-tempo-muted">{c.days_active}d</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Minter Concentration */}
      <div className="mt-8 bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">Minter Concentration</h2>
          <p className="text-tempo-muted text-xs mt-1">
            {(concentration.unique_minters ?? 0).toLocaleString()} unique minters,{' '}
            {(concentration.total_mints ?? 0).toLocaleString()} total all-time mints
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left  px-6 py-3 text-tempo-muted font-normal">Rank</th>
                <th className="text-left  px-4 py-3 text-tempo-muted font-normal">Address</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">Mints</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">% of Total</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">Collections</th>
              </tr>
            </thead>
            <tbody>
              {topMinters.map(m => (
                <tr key={m.minter} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                  <td className="px-6 py-4 text-tempo-muted">{m.rank}</td>
                  <td className="px-4 py-4">
                    <a href={`/address/${m.minter}`} className="font-mono text-xs text-tempo-blue hover:underline">
                      {m.minter.slice(0, 10)}…{m.minter.slice(-6)}
                    </a>
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">{fmtCount(m.mints)}</td>
                  <td className="text-right px-4 py-4 text-tempo-muted">{(m.pct_total ?? 0).toFixed(1)}%</td>
                  <td className="text-right px-6 py-4 text-tempo-muted">{m.collections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
