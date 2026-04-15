# Wallet Auto-Sign Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "paste your tx hash" UX in ExportButton with a one-click wallet auto-sign flow for both Solana (USDC) and Tempo (USDC.e).

**Architecture:** Three pieces — a `WalletProviders` component wraps the app with the Solana adapter context; a new `walletPayment.ts` lib handles building, signing, and broadcasting transactions for each chain; `ExportButton` gains a `signing` state and wires the two together, keeping manual paste as a fallback toggle.

**Tech Stack:** `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, `@solana/wallet-adapter-base` (new); `@solana/web3.js` + `@solana/spl-token` + `viem` (already installed).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/providers/WalletProviders.tsx` | Solana ConnectionProvider + WalletProvider |
| Modify | `src/app/layout.tsx` | Wrap children with WalletProviders |
| Create | `src/lib/walletPayment.ts` | `payWithSolana` + `payWithTempo` |
| Create | `__tests__/lib/walletPayment.test.ts` | Unit tests for both payment functions |
| Modify | `src/components/ExportButton.tsx` | Wallet connect UI + auto-sign flow |

---

## Task 1: Install Solana wallet adapter packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the three adapter packages**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics
npm install @solana/wallet-adapter-react @solana/wallet-adapter-wallets @solana/wallet-adapter-base
```

Expected: packages added to `node_modules`, `package-lock.json` updated, no peer dep errors.

- [ ] **Step 2: Verify imports resolve**

```bash
node -e "require('@solana/wallet-adapter-react'); require('@solana/wallet-adapter-wallets'); require('@solana/wallet-adapter-base'); console.log('ok')"
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add solana wallet adapter packages"
```

---

## Task 2: Create WalletProviders and wire into layout

**Files:**
- Create: `src/providers/WalletProviders.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create `src/providers/WalletProviders.tsx`**

```tsx
'use client'

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { useMemo } from 'react'

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  )

  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )
}
```

- [ ] **Step 2: Wrap layout children with WalletProviders**

Edit `src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'
import { SearchBar } from '@/components/SearchBar'
import { PrimaryNav } from '@/components/nav/PrimaryNav'
import { WalletProviders } from '@/providers/WalletProviders'

export const metadata: Metadata = {
  title: 'Tempo Explorer',
  description: 'Analytics-focused explorer for the Tempo blockchain',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tempo-dark text-gray-200">
        <WalletProviders>
          <nav className="border-b border-tempo-border px-6 py-4 flex items-center gap-6">
            <a href="/" className="text-white font-semibold text-lg tracking-tight shrink-0">
              tempo<span className="text-tempo-blue">explorer</span>
            </a>
            <PrimaryNav />
            <SearchBar />
          </nav>
          <main className="px-6 py-8 max-w-6xl mx-auto">
            {children}
          </main>
        </WalletProviders>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/providers/WalletProviders.tsx src/app/layout.tsx
git commit -m "feat: add Solana wallet adapter providers to app layout"
```

---

## Task 3: Implement `payWithSolana`

**Files:**
- Create: `src/lib/walletPayment.ts`
- Create: `__tests__/lib/walletPayment.test.ts`

- [ ] **Step 1: Write the failing test for `payWithSolana`**

Create `__tests__/lib/walletPayment.test.ts`:

```typescript
import { payWithSolana, payWithTempo } from '@/lib/walletPayment'

// ── payWithSolana ────────────────────────────────────────────────────────────

const MOCK_SIG = '5SMrQ8P8L9LLQx4wF2Lk44sf9RPzq1tadzjSFvcgc3ad'
const MOCK_BLOCKHASH = 'EkSnNWid2cvwEVnVx9oBqawnkpMVZyamoLMkGQQbeUFz'

function makeMockConnection(ataExists = true) {
  return {
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: MOCK_BLOCKHASH,
      lastValidBlockHeight: 999,
    }),
    getAccountInfo: jest.fn().mockResolvedValue(ataExists ? { data: Buffer.alloc(0) } : null),
    sendRawTransaction: jest.fn().mockResolvedValue(MOCK_SIG),
    confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
  }
}

function makeMockWallet(publicKeyStr = 'GJPrFGhMHQTsqeFnXnrJGCnpPaT3Lrqb5bRTABhqrNT') {
  const { PublicKey } = require('@solana/web3.js')
  return {
    publicKey: new PublicKey(publicKeyStr),
    signTransaction: jest.fn().mockImplementation(async (tx: unknown) => ({
      ...(tx as object),
      serialize: () => Buffer.from('signedtx'),
    })),
  }
}

test('payWithSolana broadcasts transfer and returns signature', async () => {
  const conn = makeMockConnection(true)
  const wallet = makeMockWallet()

  const sig = await payWithSolana(
    {
      recipient: '7ovHoWpT3HYPTdNo75cvh3MnAVFcdhDWiJEZ62PwQmy3',
      amount: '100000',
      currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
    wallet as never,
    conn as never,
  )

  expect(sig).toBe(MOCK_SIG)
  expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
  expect(conn.sendRawTransaction).toHaveBeenCalledTimes(1)
  expect(conn.confirmTransaction).toHaveBeenCalledTimes(1)
})

test('payWithSolana throws if wallet not connected', async () => {
  const conn = makeMockConnection()
  await expect(
    payWithSolana(
      { recipient: '7ovHoWpT3HYPTdNo75cvh3MnAVFcdhDWiJEZ62PwQmy3', amount: '100000', currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { publicKey: null, signTransaction: undefined } as never,
      conn as never,
    )
  ).rejects.toThrow('Wallet not connected')
})

test('payWithSolana creates recipient ATA when absent', async () => {
  const conn = makeMockConnection(false) // ATA absent
  const wallet = makeMockWallet()

  await payWithSolana(
    { recipient: '7ovHoWpT3HYPTdNo75cvh3MnAVFcdhDWiJEZ62PwQmy3', amount: '100000', currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    wallet as never,
    conn as never,
  )

  // signTransaction was called — tx was built (can't easily inspect instructions in unit test)
  expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test — expect failure (module not found)**

```bash
npx jest __tests__/lib/walletPayment.test.ts 2>&1 | tail -15
```

Expected: FAIL with `Cannot find module '@/lib/walletPayment'`.

- [ ] **Step 3: Create `src/lib/walletPayment.ts` with `payWithSolana`**

```typescript
import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import type { WalletContextState } from '@solana/wallet-adapter-react'

export interface SolanaPaymentRequest {
  recipient: string
  amount: string
  currency: string // USDC mint address
}

export interface TempoPaymentRequest {
  recipient: string
  amount: string
  currency: string // USDC.e contract address
}

type PartialWallet = Pick<WalletContextState, 'publicKey' | 'signTransaction'>

export async function payWithSolana(
  request: SolanaPaymentRequest,
  wallet: PartialWallet,
  connection: Connection,
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected')
  }

  const payerPk     = wallet.publicKey
  const recipientPk = new PublicKey(request.recipient)
  const mintPk      = new PublicKey(request.currency)
  const amount      = BigInt(request.amount)

  const payerAta     = getAssociatedTokenAddressSync(mintPk, payerPk)
  const recipientAta = getAssociatedTokenAddressSync(mintPk, recipientPk)

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payerPk })

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta)
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payerPk, recipientAta, recipientPk, mintPk,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    )
  }

  tx.add(
    createTransferInstruction(payerAta, recipientAta, payerPk, amount, [], TOKEN_PROGRAM_ID)
  )

  const signed = await wallet.signTransaction(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

// payWithTempo — implemented in Task 4
export async function payWithTempo(_request: TempoPaymentRequest): Promise<string> {
  throw new Error('Not implemented')
}
```

- [ ] **Step 4: Run tests — expect payWithSolana tests to pass, payWithTempo test to be absent**

```bash
npx jest __tests__/lib/walletPayment.test.ts 2>&1 | tail -15
```

Expected: `payWithSolana` tests PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/walletPayment.ts __tests__/lib/walletPayment.test.ts
git commit -m "feat: implement payWithSolana for mppx auto-sign"
```

---

## Task 4: Implement `payWithTempo`

**Files:**
- Modify: `src/lib/walletPayment.ts`
- Modify: `__tests__/lib/walletPayment.test.ts`

- [ ] **Step 1: Add failing tests for `payWithTempo` to the test file**

Append to `__tests__/lib/walletPayment.test.ts`:

```typescript
// ── payWithTempo ─────────────────────────────────────────────────────────────

const MOCK_TX_HASH = '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1'

function mockEthereum(hash = MOCK_TX_HASH) {
  return {
    request: jest.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve(['0xDeadBeef00000000000000000000000000000001'])
      if (method === 'eth_sendTransaction') return Promise.resolve(hash)
      return Promise.reject(new Error(`Unknown method: ${method}`))
    }),
  }
}

test('payWithTempo requests accounts then sends ERC-20 transfer', async () => {
  const eth = mockEthereum()
  Object.defineProperty(global, 'window', {
    value: { ethereum: eth },
    writable: true,
  })

  const hash = await payWithTempo({
    recipient: '0xc8BDAEDEcB05001B5EC22D273393792274f59281',
    amount: '100000',
    currency: '0x20C000000000000000000000b9537d11c60E8b50',
  })

  expect(hash).toBe(MOCK_TX_HASH)
  expect(eth.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  const sendCall = eth.request.mock.calls.find(
    (c: [{ method: string }]) => c[0].method === 'eth_sendTransaction'
  )
  expect(sendCall).toBeDefined()
  const txParams = sendCall[0].params[0]
  expect(txParams.to).toBe('0x20C000000000000000000000b9537d11c60E8b50')
  // data starts with transfer selector 0xa9059cbb
  expect(txParams.data.startsWith('0xa9059cbb')).toBe(true)
})

test('payWithTempo throws if no EVM wallet detected', async () => {
  Object.defineProperty(global, 'window', { value: {}, writable: true })
  await expect(
    payWithTempo({
      recipient: '0xc8BDAEDEcB05001B5EC22D273393792274f59281',
      amount: '100000',
      currency: '0x20C000000000000000000000b9537d11c60E8b50',
    })
  ).rejects.toThrow('No EVM wallet detected')
})
```

- [ ] **Step 2: Run tests — expect payWithTempo tests to fail**

```bash
npx jest __tests__/lib/walletPayment.test.ts 2>&1 | tail -15
```

Expected: 2 new FAIL with `Not implemented`.

- [ ] **Step 3: Replace the stub `payWithTempo` with full implementation**

Replace the `payWithTempo` stub in `src/lib/walletPayment.ts`:

```typescript
interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export async function payWithTempo(request: TempoPaymentRequest): Promise<string> {
  const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum
  if (!ethereum) throw new Error('No EVM wallet detected. Install MetaMask or Rabby.')

  const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const from = accounts[0]

  // ABI-encode ERC-20 transfer(address to, uint256 amount)
  // selector: keccak256("transfer(address,uint256)")[0:4] = 0xa9059cbb
  const paddedTo     = request.recipient.toLowerCase().replace('0x', '').padStart(64, '0')
  const paddedAmount = BigInt(request.amount).toString(16).padStart(64, '0')
  const data = `0xa9059cbb${paddedTo}${paddedAmount}`

  const hash = await ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: request.currency, data }],
  }) as string

  return hash
}
```

- [ ] **Step 4: Run all walletPayment tests — all 5 should pass**

```bash
npx jest __tests__/lib/walletPayment.test.ts 2>&1 | tail -15
```

Expected: 5 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/walletPayment.ts __tests__/lib/walletPayment.test.ts
git commit -m "feat: implement payWithTempo for mppx auto-sign via window.ethereum"
```

---

## Task 5: Update ExportButton with wallet auto-sign UI

**Files:**
- Modify: `src/components/ExportButton.tsx`

This is a full rewrite of the component. The mppx challenge flow, credential builder, and CSV download logic are preserved unchanged; the challenged state UI is replaced with the wallet auto-sign flow plus a fallback toggle.

- [ ] **Step 1: Write the new ExportButton**

Replace the full contents of `src/components/ExportButton.tsx` with:

```tsx
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
  const installedSolanaWallets = wallets.filter(w => w.readyState === 'Installed')

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
                      select(w.adapter.name)
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
```

- [ ] **Step 2: Run the build to check types**

```bash
npm run build 2>&1 | grep -E "error|Error|warning" | grep -v "DeprecationWarning" | head -20
```

Expected: no TypeScript errors. (Warnings about `readyState` string comparison are ok — it's a string enum.)

- [ ] **Step 3: Run existing tests to confirm nothing regressed**

```bash
npm test 2>&1 | tail -20
```

Expected: all previously passing tests still pass. (ExportButton has no existing test file, so no new failures.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ExportButton.tsx
git commit -m "feat: wallet auto-sign for mppx export — Solana adapter + window.ethereum"
```

---

## Task 6: Build, restart, and smoke test

**Files:** none modified

- [ ] **Step 1: Full production build**

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics
npm run build 2>&1 | tail -20
```

Expected: `✓ Generating static pages (14/14)`, no errors.

- [ ] **Step 2: Restart standalone server**

```bash
kill $(ps aux | grep 'next-server' | grep -v grep | awk '{print $2}') 2>/dev/null; sleep 1
npm run start:standalone > /tmp/server-restart.log 2>&1 &
sleep 3 && cat /tmp/server-restart.log
```

Expected: `✓ Ready in ...ms`

- [ ] **Step 3: Verify 402 challenge still fires correctly**

```bash
curl -s -i -X POST http://localhost:3000/api/export \
  -H 'Content-Type: application/json' \
  -d '{"query":"stablecoin-daily"}' | head -5
```

Expected: `HTTP/1.1 402 Payment Required`

- [ ] **Step 4: Verify headless payment still works**

```bash
node scripts/mpp-pay-test.mjs stablecoin-daily 2>&1
```

Expected: `✓ CSV downloaded to /tmp/stablecoin-daily-export.csv` with data preview.

- [ ] **Step 5: Commit**

```bash
git add -p  # review any stray changes
git commit -m "chore: verify wallet auto-sign build and server restart"
```

---

## Notes for the Implementer

**`readyState` values** — `@solana/wallet-adapter-base` exports a `WalletReadyState` enum: `Installed`, `Loadable`, `NotDetected`, `Unsupported`. In the component we compare `w.readyState === 'Installed'` (string) — TypeScript may warn; cast to `string` or import and use the enum.

**Tempo chain ID** — Tempo Mainnet is chain 4217. MetaMask/Rabby must be on this network for the transaction to succeed. The UX note in the component ("chain ID 4217") is the only hint; add a chain-switch prompt if this proves confusing in practice.

**`autoConnect`** — The `WalletProvider` is configured with `autoConnect`. On page load it tries to reconnect the last used wallet. If this causes issues (e.g., unwanted popups), set to `false`.

**Solana `signTransaction` deprecation** — Some adapters mark `signTransaction` as optional in newer versions. The null check in `payWithSolana` covers this — if `signTransaction` is undefined, it throws `'Wallet not connected'`.
