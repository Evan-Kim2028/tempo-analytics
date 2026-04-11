#!/usr/bin/env node
/**
 * End-to-end payment test for mppx on Tempo testnet.
 *
 * 1. POST /api/export → 402 → parse challenges
 * 2. Pick the pathUSD challenge
 * 3. Construct memo (Attribution.encode), send transferWithMemo via cast
 * 4. Build mppx Credential, serialize, retry POST with Authorization header
 * 5. Expect 200 + CSV (or meaningful error)
 */

import { execSync } from 'node:child_process'
import { Challenge, Credential } from 'mppx'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { encode: encodeMemo } = require('../node_modules/mppx/dist/tempo/Attribution.js')

const API = 'http://localhost:3099/api/export'
const PAYER_KEY = '0xb5de564df607136f0413b36e1bcb653e613fcc22a32d9543c15fb384b3f81dc8'
const PAYER_ADDR = '0x130B568Ce6498083D8E28601E41739690898965c'
const RPC = 'https://rpc.moderato.tempo.xyz'
const FOUNDRY_PATH = '/srv/takopi/authd/.foundry/bin'

// Step 1: Get 402 challenges
console.log('\n=== Step 1: Request export (expect 402) ===')
const res402 = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'fee-tokens' }),
})
console.log(`Status: ${res402.status}`)
if (res402.status !== 402) {
  console.error('Expected 402, got', res402.status)
  process.exit(1)
}

// Step 2: Parse challenges, pick pathUSD
console.log('\n=== Step 2: Parse challenges ===')
const challenges = Challenge.fromResponseList(res402)
console.log(`Found ${challenges.length} challenge(s):`)
for (const c of challenges) {
  console.log(`  - ${c.method}/${c.intent}: currency=${c.request.currency}, amount=${c.request.amount}, recipient=${c.request.recipient}`)
}

const pathUsdChallenge = challenges.find(c => c.request.currency && c.request.currency !== '')
if (!pathUsdChallenge) {
  console.error('No pathUSD challenge found')
  process.exit(1)
}
console.log(`\nSelected challenge ID: ${pathUsdChallenge.id}`)
console.log(`Currency: ${pathUsdChallenge.request.currency}`)

// Step 3: Construct memo and send transferWithMemo
console.log('\n=== Step 3: Send pathUSD transferWithMemo ===')
const { currency, amount, recipient } = pathUsdChallenge.request

const memo = encodeMemo({
  serverId: pathUsdChallenge.realm,
  clientId: PAYER_ADDR,
  challengeId: pathUsdChallenge.id,
})
console.log(`Memo: ${memo}`)
console.log(`Sending ${amount} base units of ${currency} to ${recipient}`)

const castCmd = [
  `${FOUNDRY_PATH}/cast`, 'send',
  currency,
  '"transferWithMemo(address,uint256,bytes32)"',
  recipient,
  amount,
  memo,
  '--private-key', PAYER_KEY,
  '--rpc-url', RPC,
  '--json',
].join(' ')

let txHash
try {
  const castOut = execSync(castCmd, { encoding: 'utf-8', env: { ...process.env, PATH: process.env.PATH + ':' + FOUNDRY_PATH } })
  const receipt = JSON.parse(castOut)
  txHash = receipt.transactionHash
  console.log(`TX hash: ${txHash}`)
  console.log(`Status: ${receipt.status}`)
  if (receipt.status !== '0x1') {
    console.error('Transaction reverted!')
    process.exit(1)
  }
} catch (err) {
  console.error('cast send failed:', err.stderr || err.message)
  process.exit(1)
}

// Step 4: Build credential and retry
console.log('\n=== Step 4: Submit credential ===')
const credential = Credential.from({
  challenge: pathUsdChallenge,
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
