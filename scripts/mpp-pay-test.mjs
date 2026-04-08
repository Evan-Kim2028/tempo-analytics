/**
 * End-to-end mppx payment test:
 * 1. Hit /api/export, get 402 + Solana challenge
 * 2. Build unsigned USDC SPL transfer to the recipient
 * 3. Sign + broadcast via ows
 * 4. Build Authorization: Payment credential and retry export
 * 5. Save the CSV to /tmp
 */

import { execSync } from 'child_process'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const EXPORT_URL  = 'http://localhost:3000/api/export'
const QUERY_KEY   = process.argv[2] ?? 'stablecoin-daily'
const PAYER       = '8uiLgmgdXfsmYpiDeLGYg8xkWiNKZhBt79EKeWrqJ2QG'
const PAYER_ATA   = '4hG4CJZXpTZKGAjtQxE4eUs6TvYyaWRVSe1UDRuAuJTp'
const WALLET_NAME = 'mpp-test-payer'
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

// Parse challenges — split on ", Payment" boundary
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

// Decode the payment request
const reqJson = JSON.parse(Buffer.from(
  solanaChallenge.request.replace(/-/g, '+').replace(/_/g, '/'),
  'base64'
).toString())

console.log('Solana challenge:', {
  id: solanaChallenge.id,
  recipient: reqJson.recipient,
  amount: reqJson.amount,
  currency: reqJson.currency,
  expires: solanaChallenge.expires,
})

const RECIPIENT     = reqJson.recipient  // 7ovH...
const AMOUNT        = BigInt(reqJson.amount)  // 100000 (0.10 USDC)
const USDC_MINT     = reqJson.currency

// ── Step 2: build unsigned SPL transfer transaction ──────────────────────────
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const { Connection, PublicKey, Transaction } =
  require('/home/evan/takopi-adventures/projects/tempo-analytics/node_modules/@solana/web3.js')
const {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('/home/evan/takopi-adventures/projects/tempo-analytics/node_modules/@solana/spl-token')

const connection = new Connection(RPC, 'confirmed')

const payerPk     = new PublicKey(PAYER)
const recipientPk = new PublicKey(RECIPIENT)
const mintPk      = new PublicKey(USDC_MINT)

const payerAta     = new PublicKey(PAYER_ATA)
const recipientAta = getAssociatedTokenAddressSync(mintPk, recipientPk)

console.log(`Recipient ATA: ${recipientAta.toBase58()}`)

// Check if recipient ATA exists; if not, include creation in the tx
const recipientAtaInfo = await connection.getAccountInfo(recipientAta)
const needsAtaCreate = !recipientAtaInfo
if (needsAtaCreate) {
  console.log('Recipient USDC ATA does not exist — will create it in same tx (costs ~0.002 SOL)')
}

// Get recent blockhash (kept in outer scope for confirmTransaction)
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
console.log('Blockhash:', blockhash)

const tx = new Transaction({
  recentBlockhash: blockhash,
  feePayer: payerPk,
})

if (needsAtaCreate) {
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payerPk,       // payer of rent
      recipientAta,  // ATA to create
      recipientPk,   // owner
      mintPk,        // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )
  )
}

tx.add(
  createTransferInstruction(
    payerAta,
    recipientAta,
    payerPk,
    AMOUNT,
    [],
    TOKEN_PROGRAM_ID,
  )
)

// Serialize the message (unsigned) as hex for ows
const messageHex = Buffer.from(tx.serializeMessage()).toString('hex')
console.log(`\n→ Signing + broadcasting via ows (${AMOUNT} units = $0.10 USDC)...`)

// ── Step 3: sign with ows, then assemble + broadcast manually ────────────────
let sigHex
try {
  sigHex = execSync(
    `ows sign tx --chain solana --wallet "${WALLET_NAME}" --tx "${messageHex}"`,
    { encoding: 'utf8' }
  ).trim()
} catch (e) {
  console.error('ows signing failed:', e.stderr || e.message)
  process.exit(1)
}

console.log('← Signed (64-byte sig):', sigHex.slice(0, 16) + '…')

// Assemble full signed transaction: [sig_count u16 compact][sig 64 bytes][message]
const messageBytes = Buffer.from(messageHex, 'hex')
const sigBytes = Buffer.from(sigHex, 'hex')
const signedTx = Buffer.concat([Buffer.from([0x01]), sigBytes, messageBytes])
const signedBase64 = signedTx.toString('base64')

console.log('← Broadcasting via JSON-RPC...')

const broadcastRes = await fetch(RPC, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'sendTransaction',
    params: [signedBase64, { encoding: 'base64', skipPreflight: true, maxRetries: 3 }],
  }),
})
const broadcastJson = await broadcastRes.json()
if (broadcastJson.error) {
  console.error('Broadcast failed:', JSON.stringify(broadcastJson.error))
  process.exit(1)
}

const txSig = broadcastJson.result
console.log('← Transaction broadcast! Signature:', txSig)

// Wait for confirmation before presenting proof
console.log('⏳ Waiting for confirmation...')
const confirm = await connection.confirmTransaction(
  { signature: txSig, blockhash, lastValidBlockHeight },
  'confirmed'
)
if (confirm.value.err) {
  console.error('Transaction failed on-chain:', confirm.value.err)
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
  payload: { signature: txSig, type: 'hash' },
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
  const outPath = '/tmp/stablecoin-daily-export.csv'
  await pipeline(Readable.fromWeb(exportRes.body), createWriteStream(outPath))
  console.log(`\n✓ CSV downloaded to ${outPath}`)

  // Print first few lines
  const preview = execSync(`head -5 ${outPath}`, { encoding: 'utf8' })
  console.log('\nPreview:\n' + preview)
} else {
  const body = await exportRes.text()
  console.error('Export failed:', exportRes.status, body.slice(0, 500))
}
