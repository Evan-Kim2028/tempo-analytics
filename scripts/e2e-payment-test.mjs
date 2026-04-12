#!/usr/bin/env node
/**
 * End-to-end payment test for mppx on Tempo mainnet.
 *
 * 1. POST /api/export → 402 → parse challenges
 * 2. Pick the tempo/pathUSD challenge
 * 3. Submit brokered transferWithMemo via takopi wallet transfer
 * 4. Build mppx Credential, serialize, retry POST with Authorization header
 * 5. Expect 200 + CSV
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createPublicClient, http } from 'viem'
import { Challenge, Credential } from 'mppx'

const require = createRequire(import.meta.url)
const { encode: encodeMemo } = require('../node_modules/mppx/dist/tempo/Attribution.js')

const API        = process.env.API_URL ?? 'http://localhost:3001/api/export'
const PAYER_ADDR = '0x54465c7D62FE23Ace5EBEaE88016731Cb2017cc1'
const WALLET     = 'sui-trading'
const RPC        = 'https://eng:aphex-twin-jeff-mills@rpc.tempo.xyz'
const CHAIN_ID   = 4217

const tempoChain = {
  id: CHAIN_ID,
  name: 'tempo',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const client = createPublicClient({ chain: tempoChain, transport: http() })

// ── Step 1: Get 402 challenges ─────────────────────────────────────────────
console.log('\n=== Step 1: Request export (expect 402) ===')
const res402 = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'fee-tokens' }),
})
console.log(`Status: ${res402.status}`)
if (res402.status !== 402) {
  console.error('Expected 402, got', res402.status, await res402.text())
  process.exit(1)
}

// ── Step 2: Parse challenges, pick tempo charge ────────────────────────────
console.log('\n=== Step 2: Parse challenges ===')
const challenges = Challenge.fromResponseList(res402)
console.log(`Found ${challenges.length} challenge(s):`)
for (const c of challenges) {
  console.log(`  - ${c.method}/${c.intent}: currency=${c.request.currency}, amount=${c.request.amount}, recipient=${c.request.recipient}`)
}

const challenge = challenges.find(c => c.request.currency && c.request.currency !== '')
if (!challenge) {
  console.error('No tempo challenge found')
  process.exit(1)
}
console.log(`\nSelected challenge ID: ${challenge.id}`)
console.log(`Currency: ${challenge.request.currency}`)
console.log(`Amount: ${challenge.request.amount}`)
console.log(`Recipient: ${challenge.request.recipient}`)

function formatUnits(amount, decimals) {
  const raw = BigInt(amount)
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = raw % scale
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

// ── Step 3: Submit brokered transferWithMemo ──────────────────────────────
console.log('\n=== Step 3: Submit transferWithMemo via takopi wallet transfer ===')
const { currency: tokenAddr, amount, recipient } = challenge.request

const memo = encodeMemo({
  serverId: challenge.realm,
  clientId: PAYER_ADDR,
  challengeId: challenge.id,
})
console.log(`Memo: ${memo}`)
let txHash
try {
  const transferOut = execFileSync(
    'takopi',
    [
      '--root',
      '/etc/takopi',
      '--cwd',
      process.cwd(),
      'wallet',
      'transfer',
      WALLET,
      recipient,
      formatUnits(amount, 6),
      '--chain',
      'tempo',
      '--asset-kind',
      'erc20',
      '--asset',
      tokenAddr,
      '--decimals',
      '6',
      '--memo',
      memo,
      '--json',
    ],
    { encoding: 'utf-8' },
  )
  const transfer = JSON.parse(transferOut)
  txHash = transfer.tx_hash
  console.log(`TX hash: ${txHash}`)
} catch (err) {
  console.error('brokered transfer failed:', err.message ?? err)
  process.exit(1)
}

// ── Step 3.5: Wait for tx confirmation ────────────────────────────────────
console.log('\n=== Step 3.5: Waiting for tx confirmation ===')
{
  let receipt = null
  for (let i = 0; i < 30; i++) {
    receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null)
    if (receipt) {
      console.log(`Confirmed in block ${receipt.blockNumber} (attempt ${i + 1})`)
      break
    }
    process.stdout.write('.')
    await new Promise(r => setTimeout(r, 2000))
  }
  if (!receipt) {
    console.error('TX not confirmed after 60s')
    process.exit(1)
  }
}

// ── Step 4: Submit credential ──────────────────────────────────────────────
console.log('\n=== Step 4: Submit credential ===')
const credential = Credential.from({
  challenge,
  payload: { hash: txHash, type: 'hash' },
})
const serialized = Credential.serialize(credential)
console.log(`Authorization: ${serialized.slice(0, 80)}...`)

const res200 = await fetch(API, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': serialized,
  },
  body: JSON.stringify({ query: 'fee-tokens' }),
})

console.log(`\nStatus: ${res200.status}`)
console.log(`Content-Type: ${res200.headers.get('Content-Type')}`)
const receiptHeader = res200.headers.get('Payment-Receipt')
console.log(`Payment-Receipt: ${receiptHeader ? receiptHeader.slice(0, 60) + '...' : 'none'}`)

const responseBody = await res200.text()
console.log(`\nResponse body (first 500 chars):`)
console.log(responseBody.slice(0, 500))

if (res200.ok) {
  console.log('\n✅ END-TO-END TEST PASSED — CSV received')
} else {
  console.error(`\n❌ Export failed with status ${res200.status}`)
  process.exit(1)
}
