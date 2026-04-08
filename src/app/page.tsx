import { getCached, setCached } from '@/lib/cache'
import { queryTidx, getTidxStatus } from '@/lib/tidx'
import { StatCard } from '@/components/StatCard'

export const revalidate = 30

interface OverviewStats {
  latestBlock: number
  blockTime: number
  txsLast24h: number
  blocksIndexed: number
  backfillPct: number
  syncRate: number
}

async function getOverviewStats(): Promise<OverviewStats> {
  const cached = await getCached<OverviewStats>('overview:stats')
  if (cached) return cached

  const [status, blockTimeResult, txResult] = await Promise.all([
    getTidxStatus(),
    queryTidx(`
      SELECT ROUND(
        EXTRACT(EPOCH FROM (MAX(timestamp::timestamptz) - MIN(timestamp::timestamptz)))
        / NULLIF(COUNT(*) - 1, 0)::numeric, 3
      ) as avg_block_time
      FROM (SELECT timestamp FROM blocks ORDER BY num DESC LIMIT 500) sub
    `),
    queryTidx(`
      SELECT COUNT(*) as count
      FROM txs
      WHERE block_timestamp >= NOW() - INTERVAL '24 hours'
    `),
  ])

  const chain = status.chains.find(c => c.chain_id === 4217)!
  const stats: OverviewStats = {
    latestBlock: chain.tip_num,
    blockTime: Number(blockTimeResult.rows[0]?.avg_block_time ?? 0.5),
    txsLast24h: Number(txResult.rows[0]?.count ?? 0),
    blocksIndexed: chain.postgres.blocks_count,
    backfillPct: chain.backfill_num != null
      ? Math.round((1 - chain.backfill_num / chain.head_num) * 100)
      : 100,
    syncRate: chain.sync_rate > 0 ? Math.round(chain.sync_rate) : 0,
  }

  await setCached('overview:stats', stats, 30)
  return stats
}

export default async function OverviewPage() {
  const stats = await getOverviewStats()
  const mainnetLaunch = new Date('2026-03-18T00:00:00Z')
  const daysSinceLaunch = Math.floor((Date.now() - mainnetLaunch.getTime()) / 86400000)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Tempo Mainnet</h1>
        <p className="text-tempo-muted text-sm mt-1">
          Chain ID 4217 · Presto · Mainnet live {daysSinceLaunch} days
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Latest Block" value={stats.latestBlock.toLocaleString()} mono />
        <StatCard label="Avg Block Time" value={`${stats.blockTime}s`} sub="last 500 blocks" />
        <StatCard label="Txs (24h)" value={stats.txsLast24h.toLocaleString()} />
        <StatCard label="Blocks Indexed" value={stats.blocksIndexed.toLocaleString()} />
        <StatCard
          label="Backfill"
          value={`${stats.backfillPct}%`}
          sub={stats.backfillPct < 100 ? `${stats.syncRate.toLocaleString()} blocks/sec` : 'complete'}
        />
        <StatCard label="Days Since Launch" value={daysSinceLaunch} sub="March 18, 2026" />
      </div>

      <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
        <p className="text-tempo-muted text-sm">
          Tempo is a payments-optimized L1 with native account abstraction, sub-second finality,
          and stablecoin-only fees. This explorer surfaces on-chain data unique to Tempo's
          architecture — passkey wallets, batch calls, fee sponsorship, and stablecoin usage.
        </p>
      </div>
    </div>
  )
}
