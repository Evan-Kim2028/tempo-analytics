'use client'

import { useState } from 'react'

interface ExportButtonProps {
  queryKey: string
  label?: string
}

type ExportState = 'idle' | 'challenged' | 'verifying' | 'error'

interface ParsedChallenge {
  id: string
  realm: string
  method: string
  intent: string
  request: string   // raw base64url string — echoed back verbatim in credential
  expires?: string
}

interface PaymentRequest {
  recipient?: string
  amount?: string
  currency?: string
}

// Split combined WWW-Authenticate header value into individual Payment challenges.
// compose() appends multiple headers; browsers join them with ", ".
// Each challenge begins with "Payment " so we split on that boundary.
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

function decodeRequest(requestB64: string): PaymentRequest {
  try {
    const padded = requestB64.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '='))
    return JSON.parse(json) as PaymentRequest
  } catch {
    return {}
  }
}

// Build the Authorization: Payment credential value for a given challenge + proof.
// The credential is base64url(JSON({ challenge, payload })).
// The challenge.request field must remain as the raw base64url string (not decoded).
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

function formatRecipient(address: string | undefined, method: string): string {
  if (!address) return '—'
  if (method === 'solana') return `${address.slice(0, 8)}…${address.slice(-6)}`
  return `${address.slice(0, 10)}…${address.slice(-6)}`
}

export function ExportButton({ queryKey, label = 'Export CSV' }: ExportButtonProps) {
  const [state, setState] = useState<ExportState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [challenges, setChallenges] = useState<ParsedChallenge[]>([])
  const [activeMethod, setActiveMethod] = useState<string>('tempo')
  const [proof, setProof] = useState('')

  async function handleExport() {
    setError(null)
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
        setProof('')
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

  async function handlePaymentSubmit() {
    const challenge = challenges.find(c => c.method === activeMethod)
    if (!challenge) return

    const trimmed = proof.trim()
    if (!trimmed) {
      setError('Paste your transaction hash or signature')
      return
    }

    // Validate format per method
    if (challenge.method === 'tempo' && !/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      setError('Enter a valid Tempo transaction hash (0x followed by 64 hex characters)')
      return
    }
    if (challenge.method === 'solana' && trimmed.length < 32) {
      setError('Enter a valid Solana transaction signature')
      return
    }

    const payload =
      challenge.method === 'tempo'
        ? { hash: trimmed, type: 'hash' }
        : { signature: trimmed, type: 'hash' }

    const credential = buildCredential(challenge, payload)

    setState('verifying')
    setError(null)

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: credential,
        },
        body: JSON.stringify({ query: queryKey }),
      })

      if (res.status === 402) {
        const wwwAuth = res.headers.get('WWW-Authenticate') ?? ''
        const parsed = parseChallenges(wwwAuth)
        setChallenges(parsed.length > 0 ? parsed : challenges)
        setState('challenged')
        setError('Payment verification failed — check your transaction hash and try again')
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
      setProof('')
    } catch {
      setState('error')
      setError('Network error — please try again')
    }
  }

  if (state === 'challenged' || state === 'verifying') {
    const challenge = challenges.find(c => c.method === activeMethod)
    const req = challenge ? decodeRequest(challenge.request) : {}

    const methodLabel: Record<string, string> = {
      tempo: 'Tempo (USDC.e)',
      solana: 'Solana (USDC)',
    }
    const proofLabel: Record<string, string> = {
      tempo: 'Transaction hash (0x…)',
      solana: 'Transaction signature',
    }

    return (
      <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 text-sm max-w-sm">
        <p className="text-white font-medium mb-3">Pay $0.10 to Export</p>

        {/* Method tabs */}
        {challenges.length > 1 && (
          <div className="flex gap-1 mb-4">
            {challenges.map(c => (
              <button
                key={c.method}
                onClick={() => { setActiveMethod(c.method); setProof(''); setError(null) }}
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

        {challenge && (
          <>
            <p className="text-tempo-muted mb-1 text-xs">
              Send <strong className="text-white">$0.10 {challenge.method === 'tempo' ? 'USDC.e' : 'USDC'}</strong> to:
            </p>
            <p className="font-mono text-xs text-tempo-blue break-all mb-4">
              {req.recipient ?? formatRecipient(req.recipient, challenge.method)}
            </p>
          </>
        )}

        <input
          type="text"
          aria-label={proofLabel[activeMethod] ?? 'Transaction proof'}
          placeholder={proofLabel[activeMethod] ?? 'Paste proof…'}
          value={proof}
          onChange={e => setProof(e.target.value)}
          className="w-full bg-tempo-dark border border-tempo-border rounded px-3 py-2 text-sm font-mono text-white placeholder:text-tempo-muted mb-3 focus:outline-none focus:border-tempo-blue"
        />

        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handlePaymentSubmit}
            disabled={state === 'verifying'}
            className="bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {state === 'verifying' ? 'Verifying…' : 'Verify & Download'}
          </button>
          <button
            onClick={() => { setState('idle'); setChallenges([]); setError(null); setProof('') }}
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
      disabled={state === 'error' && false}
      className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors"
    >
      {state === 'error' ? (
        <span className="text-red-400">{error ?? 'Error'}</span>
      ) : (
        label
      )}
    </button>
  )
}
