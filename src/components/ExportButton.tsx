'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import { useSelectedWalletAccount, useWalletAccountTransactionSigner } from '@solana/react'
import { useConnect, type UiWallet, type UiWalletAccount } from '@wallet-standard/react'
import { createSolanaMppxClient, createTempoMppxClient } from '@/lib/walletPayment'
import { useSession } from '@/providers/SessionProvider'

interface ExportButtonProps {
  queryKey: string
  label?: string
}

type ExportState = 'idle' | 'challenged' | 'signing' | 'verifying' | 'error' | 'success'

interface ParsedChallenge {
  id: string
  realm: string
  method: string
  intent: string
  request: string
  expires?: string
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

function decodeRecipient(requestB64: string): string | undefined {
  try {
    const padded = requestB64.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '='))
    return (JSON.parse(json) as { recipient?: string }).recipient
  } catch {
    return undefined
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

function classifyPaymentError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/5663009/i.test(msg) || /missing signature/i.test(msg)) {
    return 'Transaction could not be signed — the recipient token account may not be initialized. Use the manual payment option below, or try again shortly.'
  }
  if (/not been authorized/i.test(msg) || /not authorized/i.test(msg)) {
    return 'Wallet needs to be reconnected. Disconnect this site in your wallet settings, refresh, and connect again.'
  }
  if (/reject/i.test(msg) || /denied/i.test(msg) || /cancel/i.test(msg)) {
    return 'Transaction rejected in wallet.'
  }
  if (/insufficient/i.test(msg) && /sol/i.test(msg)) {
    return 'Insufficient SOL for transaction fees. You need a small amount of SOL to pay Solana network fees.'
  }
  if (/gas.*(not enough|balance|insufficient)/i.test(msg) || /(not enough|insufficient).*gas/i.test(msg)) {
    return 'Your wallet does not support Tempo gas payments with USDC.e. Try MetaMask, or use the manual payment option below.'
  }
  if (/insufficient/i.test(msg) || /not enough/i.test(msg)) {
    return 'Insufficient balance for this payment.'
  }
  if (/timeout/i.test(msg) || /network/i.test(msg) || /fetch/i.test(msg)) {
    return 'Network error — please try again.'
  }
  if (/simulation failed/i.test(msg) || /transaction failed/i.test(msg)) {
    return 'Transaction simulation failed — use the manual payment option below.'
  }
  if (/Solana error #\d+/i.test(msg)) {
    return 'Solana transaction error — use the manual payment option below.'
  }
  return msg || 'Payment failed'
}

type MppxPayResult =
  | { type: 'success'; blob: Blob }
  | { type: 'server_error'; message: string; credential: string | null }
  | { type: 'error'; message: string }

async function executeMppxPayment(
  client: { fetch: typeof fetch },
  queryKey: string,
): Promise<MppxPayResult> {
  const res = await client.fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: queryKey }),
  })
  if (res.status === 503) {
    return {
      type: 'server_error',
      message: 'Payment accepted but data query failed. Click "Retry download" to try again.',
      credential: res.headers.get('Authorization'),
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    return { type: 'error', message: body?.error ?? `Export failed (${res.status})` }
  }
  return { type: 'success', blob: await res.blob() }
}

function WalletConnectButton({
  wallet,
  onConnected,
}: {
  wallet: UiWallet
  onConnected: (account: UiWalletAccount) => void
}) {
  const [isConnecting, connect] = useConnect(wallet)

  return (
    <button
      disabled={isConnecting}
      onClick={async () => {
        try {
          const accounts = await connect()
          if (accounts[0]) onConnected(accounts[0])
        } catch { /* user cancelled */ }
      }}
      className="w-full text-left px-3 py-2 rounded border border-tempo-border hover:border-tempo-blue text-white text-xs transition-colors"
    >
      {isConnecting ? 'Connecting…' : wallet.name}
    </button>
  )
}

function SolanaConnectedPay({
  account,
  queryKey,
  onResult,
  onSigning,
  onDisconnect,
  disabled,
}: {
  account: UiWalletAccount
  queryKey: string
  onResult: (result: MppxPayResult) => void
  onSigning: () => void
  onDisconnect: () => void
  disabled: boolean
}) {
  const chain = account.chains.find(c => c === 'solana:mainnet-beta' || c === 'solana:mainnet') ?? 'solana:mainnet-beta'
  const signer = useWalletAccountTransactionSigner(account, chain as 'solana:mainnet-beta')
  const mppxClient = useMemo(() => createSolanaMppxClient(signer), [signer])

  async function handlePay() {
    if (disabled) return
    onSigning()
    try {
      onResult(await executeMppxPayment(mppxClient, queryKey))
    } catch (e) {
      onResult({ type: 'error', message: classifyPaymentError(e) })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-tempo-muted text-xs">
          Connected: <span className="font-mono text-white">{formatAddress(account.address, 'solana')}</span>
        </p>
        <button
          onClick={onDisconnect}
          className="text-tempo-muted hover:text-red-400 text-xs transition-colors"
        >
          Switch
        </button>
      </div>
      <button
        onClick={handlePay}
        disabled={disabled}
        className="w-full bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Pay $0.01 USDC
      </button>
    </>
  )
}

export function ExportButton({ queryKey, label = 'Export CSV' }: ExportButtonProps) {
  const [selectedAccount, setSelectedAccount, filteredWallets] = useSelectedWalletAccount()

  const session = useSession()

  const [state, setState] = useState<ExportState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [challenges, setChallenges] = useState<ParsedChallenge[]>([])
  const [activeMethod, setActiveMethod] = useState<string>('solana')
  const [showManual, setShowManual] = useState(false)
  const [manualProof, setManualProof] = useState('')
  const [lastCredential, setLastCredential] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const payingRef = useRef(false)
  const tempoClient = useMemo(() => createTempoMppxClient(), [])

  const resetFlow = useCallback(() => {
    setState('idle')
    setChallenges([])
    setError(null)
    setShowManual(false)
    setManualProof('')
    setLastCredential(null)
    payingRef.current = false
  }, [])

  const cancelSigning = useCallback(() => {
    setState('challenged')
    setError(null)
    payingRef.current = false
  }, [])

  function handleMppxResult(result: MppxPayResult) {
    if (result.type === 'success') {
      downloadBlob(result.blob)
    } else if (result.type === 'server_error') {
      setState('challenged')
      setError(result.message)
      if (result.credential) setLastCredential(result.credential)
      payingRef.current = false
    } else {
      setState('challenged')
      setError(result.message)
      payingRef.current = false
    }
  }

  async function handleExport() {
    if (fetching) return
    setFetching(true)
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
      const body = await res.json().catch(() => null)
      setState('error')
      setError(body?.error ?? `Export failed (${res.status})`)
    } catch {
      setState('error')
      setError('Network error — please try again')
    } finally {
      setFetching(false)
    }
  }

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tempo-${queryKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setState('success')
    setChallenges([])
    setManualProof('')
    setLastCredential(null)
    payingRef.current = false
  }

  async function downloadWithCredential(credential: string) {
    setState('verifying')
    setError(null)
    setLastCredential(credential)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: credential },
        body: JSON.stringify({ query: queryKey }),
      })
      if (res.status === 402) {
        setState('challenged')
        setError('Payment verification failed — check your transaction and try again')
        payingRef.current = false
        return
      }
      if (res.status === 503) {
        setState('challenged')
        setError('Payment accepted but data query failed. Click "Retry download" to try again.')
        payingRef.current = false
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setState('error')
        setError(body?.error ?? `Export failed (${res.status})`)
        payingRef.current = false
        return
      }
      downloadBlob(await res.blob())
    } catch {
      setState('error')
      setError('Network error — please try again')
      payingRef.current = false
    }
  }

  async function handleTempoPay() {
    if (payingRef.current) return
    payingRef.current = true
    setState('signing')
    setError(null)

    try {
      handleMppxResult(await executeMppxPayment(tempoClient, queryKey))
    } catch (e) {
      handleMppxResult({ type: 'error', message: classifyPaymentError(e) })
    }
  }

  async function handleSessionExport() {
    if (payingRef.current) return
    payingRef.current = true
    setState('verifying')
    setError(null)

    try {
      const deductRes = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'use', sessionId: session.sessionId }),
      })
      if (!deductRes.ok) {
        setError('Session credit failed — try paying directly')
        setState('challenged')
        payingRef.current = false
        return
      }
      const exportRes = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': session.sessionId! },
        body: JSON.stringify({ query: queryKey }),
      })
      if (!exportRes.ok) {
        setError('Export failed')
        setState('error')
        payingRef.current = false
        return
      }
      downloadBlob(await exportRes.blob())
    } catch {
      setState('error')
      setError('Network error — please try again')
      payingRef.current = false
    }
  }

  async function handleManualSubmit() {
    if (payingRef.current) return
    const challenge = challenges.find(c => c.method === activeMethod)
    if (!challenge) return
    const trimmed = manualProof.trim()
    if (!trimmed) { setError('Paste your transaction hash or signature'); return }
    if (activeMethod === 'tempo' && !/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      setError('Enter a valid Tempo transaction hash (0x followed by 64 hex characters)')
      return
    }
    if (activeMethod === 'solana' && !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trimmed)) {
      setError('Enter a valid Solana transaction signature (base58, ~88 characters)')
      return
    }
    payingRef.current = true
    const payload = activeMethod === 'tempo'
      ? { hash: trimmed, type: 'hash' }
      : { signature: trimmed, type: 'signature' }
    const credential = buildCredential(challenge, payload)
    await downloadWithCredential(credential)
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (state === 'success') {
    return (
      <button
        onClick={resetFlow}
        className="text-sm text-green-400 border border-green-800 rounded px-3 py-1.5 transition-colors hover:text-white hover:border-tempo-blue"
      >
        Downloaded ✓
      </button>
    )
  }

  // ── Idle / error state ────────────────────────────────────────────────────
  if (state === 'idle' || state === 'error') {
    if (session.credits > 0) {
      return (
        <button
          onClick={handleSessionExport}
          disabled={fetching}
          className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors"
        >
          {label} ({session.credits} credits)
        </button>
      )
    }
    return (
      <button
        onClick={handleExport}
        disabled={fetching}
        className="text-sm text-tempo-muted hover:text-white border border-tempo-border hover:border-tempo-blue rounded px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {fetching ? (
          <span className="flex items-center gap-1.5"><span className="animate-spin">⟳</span> Loading…</span>
        ) : state === 'error' ? (
          <span className="text-red-400">{error ?? 'Error'}</span>
        ) : label}
      </button>
    )
  }

  // ── Signing / verifying spinners ──────────────────────────────────────────
  if (state === 'signing' || state === 'verifying') {
    return (
      <div className="text-sm text-tempo-muted flex items-center gap-2">
        <span className="animate-spin">⟳</span>
        {state === 'signing' ? 'Waiting for wallet…' : 'Verifying payment…'}
        <button
          onClick={cancelSigning}
          className="text-red-400 hover:text-red-300 text-xs underline underline-offset-2 ml-2"
        >
          Cancel
        </button>
      </div>
    )
  }

  // ── Challenged state ──────────────────────────────────────────────────────
  const challenge = challenges.find(c => c.method === activeMethod)
  const recipient = challenge ? decodeRecipient(challenge.request) : undefined

  const methodLabel: Record<string, string> = {
    tempo: 'Tempo (USDC.e)',
    solana: 'Solana (USDC)',
  }

  const isSolanaConnected = !!selectedAccount

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-4 text-sm max-w-sm">
      <p className="text-white font-medium mb-3">Pay $0.01 to Export</p>

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

      {activeMethod === 'solana' && (
        <div className="space-y-3">
          {isSolanaConnected ? (
            <SolanaConnectedPay
              account={selectedAccount}
              queryKey={queryKey}
              onResult={handleMppxResult}
              onSigning={() => { payingRef.current = true; setState('signing') }}
              onDisconnect={() => setSelectedAccount(undefined)}
              disabled={payingRef.current}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-tempo-muted text-xs mb-2">Connect a Solana wallet to pay:</p>
              {filteredWallets.length > 0 ? (
                filteredWallets.map(w => (
                  <WalletConnectButton
                    key={w.name}
                    wallet={w}
                    onConnected={(account) => setSelectedAccount(account)}
                  />
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

      {activeMethod === 'tempo' && (
        <div className="space-y-3">
          <p className="text-tempo-muted text-xs">
            Pay via MetaMask or any Tempo-compatible EVM wallet. Requires USDC.e on Tempo Mainnet.
          </p>
          <button
            onClick={handleTempoPay}
            disabled={payingRef.current}
            className="w-full bg-tempo-blue text-white px-4 py-2 rounded text-sm hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Pay $0.01 USDC.e
          </button>
        </div>
      )}

      {lastCredential && (
        <button
          onClick={() => downloadWithCredential(lastCredential)}
          className="w-full bg-green-700 text-white px-4 py-2 rounded text-sm hover:bg-green-600 transition-colors mt-3"
        >
          Retry download (already paid)
        </button>
      )}

      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

      <button
        onClick={() => setShowManual(v => !v)}
        className="text-tempo-muted hover:text-white text-xs mt-4 underline underline-offset-2"
      >
        {showManual ? 'Hide manual entry' : 'Pay manually instead'}
      </button>

      {showManual && (
        <div className="mt-3 space-y-2">
          <p className="text-tempo-muted text-xs">
            Send <strong className="text-white">$0.01 {activeMethod === 'tempo' ? 'USDC.e' : 'USDC'}</strong> to:{' '}
            <span className="font-mono text-tempo-blue break-all">{recipient ?? '—'}</span>
          </p>
          <input
            type="text"
            placeholder={activeMethod === 'tempo' ? 'Transaction hash (0x…)' : 'Transaction signature (base58)'}
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
        onClick={resetFlow}
        className="text-tempo-muted hover:text-white text-xs mt-2 block"
      >
        Cancel
      </button>
    </div>
  )
}
