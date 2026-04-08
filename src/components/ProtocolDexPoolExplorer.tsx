'use client'
import { Fragment, useState, useCallback, useRef } from 'react'
import type { ProtocolDexPool, ProtocolDexTrade } from '@/lib/analytics'

type SortKey = 'volume' | 'swaps' | 'avg_trade' | 'dau_1d' | 'dau_7d' | 'dau_30d'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function ProtocolDexPoolExplorer({ pools }: { pools: ProtocolDexPool[] }) {
  const [showKnownOnly, setShowKnownOnly]   = useState(false)
  const [sortBy, setSortBy]                 = useState<SortKey>('volume')
  const [expandedToken, setExpandedToken]   = useState<string | null>(null)
  const [trades, setTrades]                 = useState<ProtocolDexTrade[]>([])
  const [tradesLoading, setTradesLoading]   = useState(false)
  const [tradesError, setTradesError]       = useState(false)
  const abortRef                            = useRef<AbortController | null>(null)

  const filtered = pools
    .filter(p => !showKnownOnly || p.whitelisted)
    .sort((a, b) => {
      if (sortBy === 'volume')    return b.volume_usd  - a.volume_usd
      if (sortBy === 'swaps')     return b.swaps_30d   - a.swaps_30d
      if (sortBy === 'dau_1d')    return b.dau_1d      - a.dau_1d
      if (sortBy === 'dau_7d')    return b.dau_7d      - a.dau_7d
      if (sortBy === 'dau_30d')   return b.dau_30d     - a.dau_30d
      return b.avg_trade - a.avg_trade
    })

  const togglePool = useCallback(async (token: string) => {
    if (expandedToken === token) {
      setExpandedToken(null)
      abortRef.current?.abort()
      return
    }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setExpandedToken(token)
    setTrades([])
    setTradesError(false)
    setTradesLoading(true)
    try {
      const res  = await fetch(`/api/protocol-dex/pool-trades?token=${token}`, { signal: abortRef.current.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as ProtocolDexTrade[]
      setTrades(data)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setTradesError(true)
    } finally {
      setTradesLoading(false)
    }
  }, [expandedToken])

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      {/* Controls */}
      <div className="px-6 py-4 border-b border-tempo-border flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-tempo-muted text-xs">Filter:</span>
          <div className="flex rounded overflow-hidden border border-tempo-border text-xs">
            <button
              onClick={() => setShowKnownOnly(false)}
              className={`px-3 py-1 transition-colors ${!showKnownOnly ? 'bg-tempo-border text-white' : 'text-tempo-muted hover:text-white'}`}
            >
              All Pools
            </button>
            <button
              onClick={() => setShowKnownOnly(true)}
              className={`px-3 py-1 transition-colors ${showKnownOnly ? 'bg-tempo-border text-white' : 'text-tempo-muted hover:text-white'}`}
            >
              Known Tokens Only
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-tempo-muted text-xs">Sort:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            className="bg-tempo-card border border-tempo-border rounded px-2 py-1 text-xs text-white"
          >
            <option value="volume">Volume (30d)</option>
            <option value="swaps">Swaps (30d)</option>
            <option value="avg_trade">Avg Trade Size</option>
            <option value="dau_30d">DAU (30d)</option>
            <option value="dau_7d">DAU (7d)</option>
            <option value="dau_1d">DAU (1d)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left  px-6 py-3 text-tempo-muted font-normal">Pool</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Volume</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Swaps</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Avg Trade</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">DAU (1d)</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">DAU (7d)</th>
              <th className="text-right px-6 py-3 text-tempo-muted font-normal">DAU (30d)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(pool => (
              <Fragment key={pool.token}>
                <tr
                  onClick={() => togglePool(pool.token)}
                  className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors cursor-pointer select-none"
                >
                  <td className="px-6 py-4">
                    <span className="text-white font-medium">{pool.symbol}</span>
                    <div className="font-mono text-xs text-tempo-muted mt-0.5">
                      {pool.token.slice(0, 10)}…{pool.token.slice(-6)}
                    </div>
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">
                    {pool.whitelisted ? fmtUSD(pool.volume_usd) : '—'}
                  </td>
                  <td className="text-right px-4 py-4 text-tempo-muted">
                    {fmtCount(pool.swaps_30d)}
                  </td>
                  <td className="text-right px-4 py-4 text-white font-mono">
                    {pool.whitelisted ? fmtUSD(pool.avg_trade) : '—'}
                  </td>
                  <td className="text-right px-4 py-4 text-tempo-muted font-mono">
                    {pool.dau_1d > 0 ? fmtCount(pool.dau_1d) : '—'}
                  </td>
                  <td className="text-right px-4 py-4 text-tempo-muted font-mono">
                    {pool.dau_7d > 0 ? fmtCount(pool.dau_7d) : '—'}
                  </td>
                  <td className="text-right px-6 py-4 text-tempo-muted font-mono">
                    {pool.dau_30d > 0 ? fmtCount(pool.dau_30d) : '—'}
                  </td>
                </tr>

                {expandedToken === pool.token && (
                  <tr className="border-b border-tempo-border bg-tempo-border/10">
                    <td colSpan={7} className="px-6 py-4">
                      <p className="text-sm font-medium text-white mb-3">
                        Recent Trades — {pool.symbol}
                      </p>
                      {tradesLoading ? (
                        <p className="text-tempo-muted text-xs">Loading…</p>
                      ) : tradesError ? (
                        <p className="text-red-400 text-xs">Failed to load trades. Try again.</p>
                      ) : trades.length === 0 ? (
                        <p className="text-tempo-muted text-xs">No recent trades found.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-tempo-muted border-b border-tempo-border/50">
                              <th className="text-left  pb-2 font-normal">Time</th>
                              <th className="text-left  pb-2 font-normal">Taker</th>
                              <th className="text-right pb-2 font-normal">Amount</th>
                              <th className="text-right pb-2 font-normal">Direction</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trades.map((t, i) => (
                              <tr key={i} className="border-t border-tempo-border/30">
                                <td className="py-1.5 text-tempo-muted pr-4">{timeAgo(t.timestamp)}</td>
                                <td className="py-1.5 font-mono">
                                  <a
                                    href={`/address/${t.taker}`}
                                    className="text-tempo-blue hover:underline"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {t.taker.slice(0, 8)}…{t.taker.slice(-4)}
                                  </a>
                                </td>
                                <td className="py-1.5 text-right font-mono text-white">
                                  {t.amount_usd !== null
                                    ? fmtUSD(t.amount_usd)
                                    : t.amount_raw.toLocaleString()}
                                </td>
                                <td className="py-1.5 text-right">
                                  {t.direction === 0
                                    ? <span className="text-green-400">▲ Buy</span>
                                    : <span className="text-red-400">▼ Sell</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-tempo-muted text-sm">
                  No pools found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
