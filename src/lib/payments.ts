import { getCached, setCached } from '@/lib/cache'
import { queryClickHouse } from '@/lib/clickhouse'

const ZERO_MEMO = '0x' + '00'.repeat(32)
const CACHE_TTL_SECONDS = 900

export type PaymentStatus = 'success' | 'failed'
export type MemoKind = 'readable' | 'opaque' | 'empty'

export interface SupportedPaymentMethod {
  token: string
  token_label: string
  call_selector: string
  event_selector: string
  decimals: number
}

export interface PaymentRow {
  timestamp: string
  day: string
  tx_hash: string
  sender: string
  recipient: string
  token: string
  token_label: string
  amount: number
  status: PaymentStatus
  memo_hex: string
  memo_text: string | null
  memo_kind: MemoKind
  memo_family: string | null
}

interface RawPaymentRow {
  block_timestamp: string
  tx_hash: string
  sender: string
  recipient: string
  token: string
  amount_raw: string
  memo_hex: string
}

export const PAYMENT_METHODS = [
  {
    token: '0x20c0000000000000000000000000000000000000',
    token_label: 'pathUSD',
    call_selector: '0x95777d59',
    event_selector: '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0',
    decimals: 6,
  },
] satisfies SupportedPaymentMethod[]

function isPrintableAscii(value: Buffer) {
  return [...value].every(byte => byte === 0 || (byte >= 32 && byte <= 126))
}

export function decodeMemoHex(memoHex: string): {
  memo_hex: string
  memo_text: string | null
  memo_kind: MemoKind
} {
  const normalized = memoHex?.toLowerCase().startsWith('0x') ? memoHex.toLowerCase() : ZERO_MEMO
  if (normalized === ZERO_MEMO) {
    return { memo_hex: ZERO_MEMO, memo_text: null, memo_kind: 'empty' }
  }

  const hexBody = normalized.slice(2)
  if (!/^[0-9a-f]*$/i.test(hexBody)) {
    return { memo_hex: normalized, memo_text: null, memo_kind: 'opaque' }
  }

  const bytes = Buffer.from(hexBody.padEnd(64, '0').slice(0, 64), 'hex')
  if (!isPrintableAscii(bytes)) {
    return { memo_hex: normalized, memo_text: null, memo_kind: 'opaque' }
  }

  const text = bytes.toString('utf8').replace(/\0+$/g, '')
  if (!text) {
    return { memo_hex: normalized, memo_text: null, memo_kind: 'empty' }
  }

  return { memo_hex: normalized, memo_text: text, memo_kind: 'readable' }
}

export function classifyMemoFamily(memoText: string | null): string | null {
  if (!memoText) return null
  if (/^SOC-/i.test(memoText)) return 'SOC-*'
  if (/^daily-/i.test(memoText)) return 'daily-*'
  if (/^Full/i.test(memoText)) return 'Full*'
  return null
}

function sliceDay(timestamp: string) {
  return String(timestamp).slice(0, 10)
}

function normalizeAmount(amountRaw: string, decimals: number) {
  return Number(amountRaw ?? 0) / 10 ** decimals
}

function topicToAddress(value: string) {
  const normalized = String(value).toLowerCase()
  return `0x${normalized.slice(-40)}`
}

function buildSuccessfulPaymentsQuery(days: number) {
  return PAYMENT_METHODS.map(method => `
    SELECT
      block_timestamp,
      tx_hash,
      topic1 AS sender,
      topic2 AS recipient,
      '${method.token}' AS token,
      toString(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) AS amount_raw,
      lower(topic3) AS memo_hex
    FROM logs
    WHERE block_timestamp >= now() - INTERVAL ${days} DAY
      AND selector = '${method.event_selector}'
      AND lower(address) = '${method.token}'
  `).join('\nUNION ALL\n')
}

function buildFailedPaymentsQuery(days: number) {
  return PAYMENT_METHODS.map(method => `
    SELECT
      txs.block_timestamp,
      txs.hash AS tx_hash,
      lower(txs.from) AS sender,
      lower(concat('0x', substr(txs.input, 35, 40))) AS recipient,
      '${method.token}' AS token,
      toString(reinterpretAsUInt256(reverse(unhex(substr(txs.input, 75, 64))))) AS amount_raw,
      lower(concat('0x', substr(txs.input, 139, 64))) AS memo_hex
    FROM txs
    LEFT JOIN receipts ON receipts.tx_hash = txs.hash
    WHERE txs.block_timestamp >= now() - INTERVAL ${days} DAY
      AND txs.selector = '${method.call_selector}'
      AND lower(txs.to) = '${method.token}'
      AND (receipts.status = 0 OR receipts.status = '0')
  `).join('\nUNION ALL\n')
}

function normalizePaymentRow(row: RawPaymentRow, status: PaymentStatus): PaymentRow {
  const method = PAYMENT_METHODS.find(candidate => candidate.token === row.token.toLowerCase())
  if (!method) {
    throw new Error(`Unsupported payment token: ${row.token}`)
  }

  const memo = decodeMemoHex(row.memo_hex)
  return {
    timestamp: row.block_timestamp,
    day: sliceDay(row.block_timestamp),
    tx_hash: row.tx_hash.toLowerCase(),
    sender: topicToAddress(row.sender),
    recipient: topicToAddress(row.recipient),
    token: method.token,
    token_label: method.token_label,
    amount: normalizeAmount(row.amount_raw, method.decimals),
    status,
    memo_hex: memo.memo_hex,
    memo_text: memo.memo_text,
    memo_kind: memo.memo_kind,
    memo_family: classifyMemoFamily(memo.memo_text),
  }
}

async function fetchSuccessfulPaymentRows(days: number): Promise<RawPaymentRow[]> {
  return queryClickHouse<RawPaymentRow>(`
    ${buildSuccessfulPaymentsQuery(days)}
    ORDER BY block_timestamp DESC
  `)
}

async function fetchFailedPaymentRows(days: number): Promise<RawPaymentRow[]> {
  return queryClickHouse<RawPaymentRow>(`
    ${buildFailedPaymentsQuery(days)}
    ORDER BY block_timestamp DESC
  `)
}

export async function getRecentPayments(limit = 50, days = 30): Promise<PaymentRow[]> {
  const cacheKey = `payments:recent:${limit}:${days}`
  const cached = await getCached<PaymentRow[]>(cacheKey)
  if (cached !== null) return cached

  const [successfulRows, failedRows] = await Promise.all([
    fetchSuccessfulPaymentRows(days),
    fetchFailedPaymentRows(days),
  ])

  const rows = [
    ...successfulRows.map(row => normalizePaymentRow(row, 'success')),
    ...failedRows.map(row => normalizePaymentRow(row, 'failed')),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)

  await setCached(cacheKey, rows, CACHE_TTL_SECONDS)
  return rows
}
