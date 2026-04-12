#!/usr/bin/env node
/**
 * End-to-end mppx payment test (Solana path):
 * 1. Hit /api/export, get 402 + Solana challenge
 * 2. Submit brokered SPL transfer via takopi wallet transfer
 * 3. Wait for on-chain confirmation
 * 4. Build Authorization: Payment credential and retry export
 * 5. Save the CSV to /tmp
 */

import { execFileSync, execSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const EXPORT_URL  = process.env.API_URL ?? 'http://localhost:3001/api/export'
const QUERY_KEY   = process.argv[2] ?? 'stablecoin-daily'
const WALLET_NAME = process.env.MPP_WALLET ?? 'mpp-test-payer'
const RPC         = 'https://api.mainnet-beta.solana.com'

// ── Step 1: get fresh 402 challenge ─────────────────────────────────────────
console.log('→ Hitting export endpoint to get 402 challenge...')
const initRes = await fetch(EXPORT_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERY_KEY }),
})

if (initRes.status !== 402) {
  console.error('Expected 402, got', initRes.status)
  process.exit(1)
}

const wwwAuth = initRes.headers.get('www-authenticate') ?? ''
console.log('← 402 received')

function parseChallenges(header) {
  const parts = header.split(/,\s*(?=Payment\s)/i)
  return parts.map(part => {
    const fields = {}
    for (const [, key, value] of part.matchAll(/(\w+)="([^"]*)"/g)) {
      fields[key] = value
    }
    return fields
  }).filter(f => f.id && f.method)
}

const challenges = parseChallenges(wwwAuth)
const solanaChallenge = challenges.find(c => c.method === 'solana')
if (!solanaChallenge) { console.error('No Solana challenge found'); process.exit(1) }

const reqJson = JSON.parse(Buffer.from(
  solanaChallenge.request.replace(/-/g, '+').replace(/_/g, '/'),
  'base64'
).toString())

const decimals     = reqJson.methodDetails?.decimals ?? 6
const rawAmount    = Number(reqJson.amount)
const amount       = rawAmount / (10 ** decimals)

console.log('Solana challenge:', {
  id: solanaChallenge.id,
  recipient: reqJson.recipient,
  amount: reqJson.amount,
  currency: reqJson.currency,
  decimals,
  expires: solanaChallenge.expires,
})

// ── Step 2: brokered SPL transfer via takopi wallet transfer ────────────────
console.log(`\n→ Sending ${amount} USDC via takopi wallet transfer (${WALLET_NAME})...`)

let txSig
try {
  const out = execFileSync('takopi', [
    'wallet', 'transfer',
    WALLET_NAME,
    reqJson.recipient,
    String(amount),
    '--chain', 'solana',
    '--asset-kind', 'spl',
    '--asset', reqJson.currency,
    '--decimals', String(decimals),
    '--json',
  ], { encoding: 'utf8' })

  const parsed = JSON.parse(out)
  txSig = parsed.tx_hash ?? parsed.signature ?? parsed.txHash
  if (!txSig) {
    console.error('Could not extract tx signature from takopi output:', out)
    process.exit(1)
  }
} catch (e) {
  console.error('takopi wallet transfer failed:', e.stderr || e.message)
  process.exit(1)
}

console.log('← TX signature:', txSig)

// ── Step 3: wait for on-chain confirmation ──────────────────────────────────
console.log('⏳ Waiting for confirmation...')

const { createSolanaRpc } = await import('@solana/kit')
const rpc = createSolanaRpc(RPC)

// Poll for confirmation
let confirmed = false
for (let i = 0; i < 30; i++) {
  const { value } = await rpc.getSignatureStatuses([txSig]).send()
  const status = value[0]
  if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
    if (status.err) {
      console.error('Transaction failed on-chain:', status.err)
      process.exit(1)
    }
    confirmed = true
    break
  }
  await new Promise(r => setTimeout(r, 2000))
}
if (!confirmed) {
  console.error('Transaction not confirmed within 60s')
  process.exit(1)
}
console.log('✓ Confirmed on-chain')

// ── Step 4: build Authorization credential ───────────────────────────────────
const wire = {
  challenge: {
    id:      solanaChallenge.id,
    realm:   solanaChallenge.realm,
    method:  solanaChallenge.method,
    intent:  solanaChallenge.intent,
    request: solanaChallenge.request,
    ...(solanaChallenge.expires && { expires: solanaChallenge.expires }),
  },
  payload: { signature: txSig, type: 'signature' },
}

const credentialB64 = Buffer.from(JSON.stringify(wire)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
const authHeader = `Payment ${credentialB64}`

console.log('\n→ Retrying export with Authorization: Payment credential...')

// ── Step 5: retry export ─────────────────────────────────────────────────────
const exportRes = await fetch(EXPORT_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': authHeader,
  },
  body: JSON.stringify({ query: QUERY_KEY }),
})

console.log('← Response status:', exportRes.status)

if (exportRes.ok) {
  const outPath = `/tmp/${QUERY_KEY}-export.csv`
  await pipeline(Readable.fromWeb(exportRes.body), createWriteStream(outPath))
  console.log(`\n✓ CSV downloaded to ${outPath}`)
  const preview = execSync(`head -5 ${outPath}`, { encoding: 'utf8' })
  console.log('\nPreview:\n' + preview)
} else {
  const body = await exportRes.text()
  console.error('Export failed:', exportRes.status, body.slice(0, 500))
}
