'use client'

import { useState } from 'react'
import { Challenge, Credential } from 'mppx'

interface ExportButtonProps {
  queryKey: string
  label?: string
}

type ExportState = 'idle' | 'awaiting_payment' | 'verifying' | 'downloading' | 'error'

export function ExportButton({ queryKey, label = 'Export CSV' }: ExportButtonProps) {
  const [state, setState] = useState<ExportState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<{
    challenges: Challenge.Challenge[]; selected: number
  } | null>(null)
  const [txHash, setTxHash] = useState('')

  async function handleExport() {
    setState('awaiting_payment')
    setError(null)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryKey }),
      })
      if (res.status === 402) {
        const challenges = Challenge.fromResponseList(res)
        setChallenge({ challenges, selected: 0 })
        return
      }
      setState('error')
      setError('Export failed')
    } catch {
      setState('error')
      setError('Network error — please try again')
    }
  }

  async function handlePaymentSubmit() {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      setError('Enter a valid transaction hash (0x followed by 64 hex characters)')
      return
    }

    if (!challenge) return

    setState('verifying')
    setError(null)

    try {
      const selectedChallenge = challenge.challenges[challenge.selected]
      const credential = Credential.from({
        challenge: selectedChallenge,
        payload: { hash: txHash, type: 'hash' as const },
      })
      const serialized = Credential.serialize(credential)

      const res = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `${serialized}`,
        },
        body: JSON.stringify({ query: queryKey }),
      })
      if (res.status === 402) {
        const newChallenges = Challenge.fromResponseList(res)
        setChallenge({ challenges: newChallenges, selected: challenge.selected })
        setState('awaiting_payment')
        setError('Payment verification failed — please try again')
        return
      }
      if (!res.ok) {
        setState('error')
        setError('Download failed')
        return
      }
      setState('downloading')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tempo-${queryKey}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setState('idle')
      setChallenge(null)
      setTxHash('')
    } catch {
      setState('error')
      setError('Network error — please try again')
    }
  }

  if (state === 'awaiting_payment' && challenge) {
    const selectedChallenge = challenge.challenges[challenge.selected]
    const { amount, currency, recipient, decimals } = selectedChallenge.request as {
      amount: string; currency: string; recipient: string; decimals: number
    }
    const displayAmount = (parseFloat(amount) / 10 ** decimals).toFixed(2)

    return (
      <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 text-sm max-w-sm">
        <p className="text-white font-medium mb-2">Pay to Export</p>

        {challenge.challenges.length > 1 && (
          <div className="flex gap-1 mb-3">
            {challenge.challenges.map((c, i) => {
              const addr = (c.request as { currency: string }).currency
              const tabLabel = `${addr.slice(0, 6)}…${addr.slice(-4)}`
              return (
                <button
                  key={i}
                  onClick={() => setChallenge({ ...challenge, selected: i })}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    i === challenge.selected
                      ? 'bg-tempo-blue text-white'
                      : 'bg-tempo-dark text-tempo-muted hover:text-white'
                  }`}
                >
                  {tabLabel}
                </button>
              )
            })}
          </div>
        )}

        <p className="text-tempo-muted mb-1">
          Send <strong className="text-white">{displayAmount} {`${currency.slice(0, 6)}…${currency.slice(-4)}`}</strong> to:
        </p>
        <p className="font-mono text-xs text-tempo-blue break-all mb-4">{recipient}</p>
        <input
          type="text"
          aria-label="Transaction hash"
          placeholder="Paste transaction hash (0x...)"
          value={txHash}
          onChange={e => setTxHash(e.target.value)}
          className="w-full bg-tempo-dark border border-tempo-border rounded px-3 py-2 text-sm font-mono text-white placeholder:text-tempo-muted mb-3 focus:outline-none focus:border-tempo-blue"
        />
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handlePaymentSubmit}
            className="bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors"
          >
            Verify &amp; Download
          </button>
          <button
            onClick={() => { setState('idle'); setChallenge(null); setError(null) }}
            className="text-tempo-muted hover:text-white px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={handleExport}
      disabled={state === 'verifying' || state === 'downloading'}
      className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors disabled:opacity-50"
    >
      {state === 'verifying' ? 'Verifying…' : state === 'downloading' ? 'Downloading…' : label}
    </button>
  )
}
