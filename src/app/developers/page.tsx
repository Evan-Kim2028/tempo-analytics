import { Metadata } from 'next'

export const metadata: Metadata = { title: 'Developers — Tempo Explorer' }

export default function DevelopersPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Developer API</h1>
      <p className="text-tempo-muted">
        Query Tempo analytics data programmatically. Get an API key, deposit credits, and start querying.
      </p>

      <section className="bg-tempo-card border border-tempo-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Quick Start</h2>
        <pre className="bg-tempo-dark rounded p-4 text-xs font-mono text-gray-300 overflow-x-auto">{`curl -X POST https://explorer.tempo.xyz/api/v1/query \\
  -H "Authorization: Bearer tak_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "stablecoin-daily"}'`}</pre>
      </section>

      <section className="bg-tempo-card border border-tempo-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Available Queries</h2>
        <p className="text-tempo-muted text-sm">$0.01 per query. Volume discounts available.</p>
        <div className="grid gap-2 text-sm">
          {[
            ['account-types', 'Signature type distribution'],
            ['batch-calls', 'Batch call frequency'],
            ['fee-sponsorship', 'Daily sponsorship rates (90 days)'],
            ['fee-tokens', 'Gas token usage breakdown'],
            ['mainnet-launch', 'Weekly growth since launch'],
            ['latest-blocks', 'Most recent 1000 blocks'],
            ['stablecoin-daily', 'Stablecoin volume by day'],
            ['dex-daily', 'DEX swaps by pair/day'],
            ['nft-activity', 'NFT transfers by collection/day'],
            ['pool-trades', 'Pool trade history (requires token param)'],
          ].map(([key, desc]) => (
            <div key={key} className="flex justify-between border-b border-tempo-border py-2">
              <code className="text-tempo-blue font-mono">{key}</code>
              <span className="text-tempo-muted">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-tempo-card border border-tempo-border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Pricing</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-tempo-muted border-b border-tempo-border">
              <th className="text-left py-2">Deposit</th>
              <th className="text-left py-2">Credits</th>
              <th className="text-left py-2">Per Query</th>
              <th className="text-left py-2">Discount</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            <tr className="border-b border-tempo-border"><td className="py-2">$0.01</td><td>1</td><td>$0.01</td><td>—</td></tr>
            <tr className="border-b border-tempo-border"><td className="py-2">$0.05</td><td>6</td><td>~$0.0083</td><td>17%</td></tr>
            <tr><td className="py-2">$0.10</td><td>13</td><td>~$0.0077</td><td>23%</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}
