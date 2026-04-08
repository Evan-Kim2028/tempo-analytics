'use client'

import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { payWithSolana, payWithTempo } from '@/lib/walletPayment'

interface ExportButtonProps {
  queryKey: string
  label?: string
}

type ExportState = 'idle' | 'challenged' | 'signing' | 'verifying' | 'error'

interface ParsedChallenge {
  id: string
  realm: string
  method: string
  intent: string
  request: string
  expires?: string
}

interface DecodedRequest {
  recipient?: string
  amount?: string
  currency?: string
}

function parseChallenges(header: string): ParsedChallenge[] {
  const parts = header.split(/,\s*(?=Payment\s)/i)
  const challenges: ParsedChallenge[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!/^Payment\s/i.test(trimmed)) continue
    const fields: Record<string, string> = {}
    for (const [, key, value] of trimmed.matchAll(/(\w+)="([^"]*)"/g)) {
      fields[key] = value
    }
    if (fields.id && fields.realm && fields.method && fields.intent && fields.request) {
      challenges.push({
        id: fields.id,
        realm: fields.realm,
        method: fields.method,
        intent: fields.intent,
        request: fields.request,
        expires: fields.expires,
      })
    }
  }
  return challenges
}

function decodeRequest(requestB64: string): DecodedRequest {
  try {
    const padded = requestB64.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '='))
    return JSON.parse(json) as DecodedRequest
  } catch {
    return {}
  }
}

function buildCredential(challenge: ParsedChallenge, payload: unknown): string {
  const wire = {
    challenge: {
      id: challenge.id,
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      request: challenge.request,
      ...(challenge.expires && { expires: challenge.expires }),
    },
    payload,
  }
  const json = JSON.stringify(wire)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach(b => (binary += String.fromCharCode(b)))
  return 'Payment ' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function formatAddress(address: string | null | undefined, method: string): string {
  if (!address) return '—'
  if (method === 'solana') return `${address.slice(0, 6)}…${address.slice(-4)}`
  return `${address.slice(0, 8)}…${address.slice(-4)}`
}

export function ExportButton({ queryKey, label = 'Export CSV' }: ExportButtonProps) {
  const { publicKey, connect, wallets, select, connected, signTransaction } = useWallet()
  const { connection } = useConnection()

  const [state, setState] = useState<ExportState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [challenges, setChallenges] = useState<ParsedChallenge[]>([])
  const [activeMethod, setActiveMethod] = useState<string>('solana')
  const [showManual, setShowManual] = useState(false)
  const [manualProof, setManualProof] = useState('')

  async function handleExport() {
    setError(null)
    setShowManual(false)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryKey }),
      })
      if (res.status === 402) {
        const wwwAuth = res.headers.get('WWW-Authenticate') ?? ''
        const parsed = parseChallenges(wwwAuth)
        if (parsed.length === 0) {
          setState('error')
          setError('Payment required but no challenge received')
          return
        }
        setChallenges(parsed)
        setActiveMethod(parsed[0].method)
        setState('challenged')
        return
      }
      setState('error')
      setError('Export failed')
    } catch {
      setState('error')
      setError('Network error — please try again')
    }
  }

  async function downloadWithCredential(credential: string) {
    setState('verifying')
    setError(null)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: credential },
        body: JSON.stringify({ query: queryKey }),
      })
      if (res.status === 402) {
        setState('challenged')
        setError('Payment verification failed — check your transaction and try again')
        return
      }
      if (!res.ok) {
        setState('error')
        setError('Download failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tempo-${queryKey}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setState('idle')
      setChallenges([])
      setManualProof('')
    } catch {
      setState('error')
      setError('Network error — please try again')
    }
  }

  async function handleWalletPay() {
    const challenge = challenges.find(c => c.method === activeMethod)
    if (!challenge) return
    const req = decodeRequest(challenge.request)
    if (!req.recipient || !req.amount || !req.currency) {
      setError('Malformed payment challenge')
      return
    }

    setState('signing')
    setError(null)

    try {
      let txId: string
      if (activeMethod === 'solana') {
        txId = await payWithSolana(
          { recipient: req.recipient, amount: req.amount, currency: req.currency },
          { publicKey, signTransaction },
          connection,
        )
      } else {
        txId = await payWithTempo(
          { recipient: req.recipient, amount: req.amount, currency: req.currency },
        )
      }

      const payload = activeMethod === 'tempo'
        ? { hash: txId, type: 'hash' }
        : { signature: txId, type: 'hash' }
      const credential = buildCredential(challenge, payload)
      await downloadWithCredential(credential)
    } catch (e) {
      setState('challenged')
      setError(e instanceof Error ? e.message : 'Payment failed')
    }
  }

  async function handleManualSubmit() {
    const challenge = challenges.find(c => c.method === activeMethod)
    if (!challenge) return
    const trimmed = manualProof.trim()
    if (!trimmed) { setError('Paste your transaction hash or signature'); return }
    if (activeMethod === 'tempo' && !/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      setError('Enter a valid Tempo transaction hash (0x followed by 64 hex characters)')
      return
    }
    if (activeMethod === 'solana' && trimmed.length < 32) {
      setError('Enter a valid Solana transaction signature')
      return
    }
    const payload = activeMethod === 'tempo'
      ? { hash: trimmed, type: 'hash' }
      : { signature: trimmed, type: 'hash' }
    const credential = buildCredential(challenge, payload)
    await downloadWithCredential(credential)
  }

  // ── Idle state ──────────────────────────────────────────────────────────────
  if (state === 'idle' || state === 'error') {
    return (
      <button
        onClick={handleExport}
        className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors"
      >
        {state === 'error' ? (
          <span className="text-red-400">{error ?? 'Error'}</span>
        ) : label}
      </button>
    )
  }

  // ── Signing / verifying spinners ────────────────────────────────────────────
  if (state === 'signing' || state === 'verifying') {
    return (
      <div className="text-sm text-tempo-muted flex items-center gap-2">
        <span className="animate-spin">⟳</span>
        {state === 'signing' ? 'Waiting for wallet…' : 'Verifying payment…'}
      </div>
    )
  }

  // ── Challenged state ────────────────────────────────────────────────────────
  const challenge = challenges.find(c => c.method === activeMethod)
  const req = challenge ? decodeRequest(challenge.request) : {}

  const methodLabel: Record<string, string> = {
    tempo: 'Tempo (USDC.e)',
    solana: 'Solana (USDC)',
  }

  const isSolanaConnected = connected && !!publicKey
  const installedSolanaWallets = wallets.filter(w => (w.readyState as string) === 'Installed')

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 text-sm max-w-sm">
      <p className="text-white font-medium mb-3">Pay $0.10 to Export</p>

      {/* Method tabs */}
      {challenges.length > 1 && (
        <div className="flex gap-1 mb-4">
          {challenges.map(c => (
            <button
              key={c.method}
              onClick={() => { setActiveMethod(c.method); setError(null); setShowManual(false) }}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                activeMethod === c.method
                  ? 'bg-tempo-blue text-white'
                  : 'text-tempo-muted hover:text-white border border-tempo-border'
              }`}
            >
              {methodLabel[c.method] ?? c.method}
            </button>
          ))}
        </div>
      )}

      {/* Solana tab */}
      {activeMethod === 'solana' && (
        <div className="space-y-3">
          {isSolanaConnected ? (
            <>
              <p className="text-tempo-muted text-xs">
                Connected: <span className="font-mono text-white">{formatAddress(publicKey.toBase58(), 'solana')}</span>
              </p>
              <button
                onClick={handleWalletPay}
                className="w-full bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors"
              >
                Pay $0.10 USDC
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-tempo-muted text-xs mb-2">Connect a Solana wallet to pay:</p>
              {installedSolanaWallets.length > 0 ? (
                installedSolanaWallets.map(w => (
                  <button
                    key={w.adapter.name}
                    onClick={async () => {
                      select(w.adapter.name as Parameters<typeof select>[0])
                      try { await connect() } catch { /* user cancelled */ }
                    }}
                    className="w-full text-left px-3 py-2 rounded border border-tempo-border hover:border-tempo-blue text-white text-xs transition-colors"
                  >
                    {w.adapter.name}
                  </button>
                ))
              ) : (
                <p className="text-tempo-muted text-xs">
                  No Solana wallet detected.{' '}
                  <a href="https://phantom.app" target="_blank" rel="noopener" className="text-tempo-blue hover:underline">
                    Get Phantom ↗
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tempo tab */}
      {activeMethod === 'tempo' && (
        <div className="space-y-3">
          <p className="text-tempo-muted text-xs">
            Pay via MetaMask, Rabby, or any EVM wallet on Tempo Mainnet (chain ID 4217).
          </p>
          <button
            onClick={handleWalletPay}
            className="w-full bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors"
          >
            Pay $0.10 USDC.e
          </button>
        </div>
      )}

      {/* Error */}
      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

      {/* Manual fallback toggle */}
      <button
        onClick={() => setShowManual(v => !v)}
        className="text-tempo-muted hover:text-white text-xs mt-4 underline underline-offset-2"
      >
        {showManual ? 'Hide manual entry' : 'Pay manually instead'}
      </button>

      {showManual && (
        <div className="mt-3 space-y-2">
          <p className="text-tempo-muted text-xs">
            Send <strong className="text-white">$0.10 {activeMethod === 'tempo' ? 'USDC.e' : 'USDC'}</strong> to:{' '}
            <span className="font-mono text-tempo-blue break-all">{req.recipient ?? '—'}</span>
          </p>
          <input
            type="text"
            placeholder={activeMethod === 'tempo' ? 'Transaction hash (0x…)' : 'Transaction signature'}
            value={manualProof}
            onChange={e => setManualProof(e.target.value)}
            className="w-full bg-tempo-dark border border-tempo-border rounded px-3 py-2 text-xs font-mono text-white placeholder:text-tempo-muted focus:outline-none focus:border-tempo-blue"
          />
          <button
            onClick={handleManualSubmit}
            className="bg-tempo-blue text-white px-4 py-1.5 rounded text-xs hover:bg-blue-600 transition-colors"
          >
            Verify & Download
          </button>
        </div>
      )}

      <button
        onClick={() => { setState('idle'); setChallenges([]); setError(null) }}
        className="text-tempo-muted hover:text-white text-xs mt-2 block"
      >
        Cancel
      </button>
    </div>
  )
}
