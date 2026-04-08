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

export interface PaymentsSummaryStats {
  successful_payments: number
  failed_attempts: number
  success_rate: number
  total_amount: number
  unique_senders: number
  unique_recipients: number
}

export interface PaymentsDailyPoint {
  day: string
  successful_payments: number
  failed_attempts: number
  total_amount: number
  unique_senders: number
  unique_recipients: number
  readable_memos: number
  opaque_memos: number
  empty_memos: number
}

export interface PaymentCounterpartyRow {
  address: string
  payment_count: number
  total_amount: number
}

export interface PaymentsPageData {
  summary: PaymentsSummaryStats
  recent: PaymentRow[]
  daily: PaymentsDailyPoint[]
  topRecipientsByAmount: PaymentCounterpartyRow[]
  topRecipientsByCount: PaymentCounterpartyRow[]
  topSenders: PaymentCounterpartyRow[]
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

interface RawPaymentDailyMetricRow {
  day: string
  successful_payments: string | number
  failed_attempts: string | number
  total_amount?: string | number
  total_amount_raw?: string | number
  readable_memos: string | number
  opaque_memos: string | number
  empty_memos: string | number
}

interface RawPaymentActorCountRow {
  day?: string
  unique_senders: string | number
  unique_recipients: string | number
}

interface RawPaymentSummaryMetricRow {
  successful_payments: string | number
  failed_attempts: string | number
  total_amount?: string | number
  total_amount_raw?: string | number
}

interface RawPaymentCounterpartyRow {
  address: string
  payment_count: string | number
  total_amount?: string | number
  total_amount_raw?: string | number
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

function toNumber(value: string | number | null | undefined) {
  return Number(value ?? 0)
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals))
}

function normalizeAmount(amountRaw: string, decimals: number) {
  return Number(amountRaw ?? 0) / 10 ** decimals
}

function normalizeAggregateAmount(value: { total_amount?: string | number; total_amount_raw?: string | number }) {
  if (value.total_amount_raw !== undefined) {
    const decimals = PAYMENT_METHODS[0]?.decimals ?? 0
    return roundTo(Number(value.total_amount_raw ?? 0) / 10 ** decimals)
  }

  return roundTo(toNumber(value.total_amount))
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
      AND startsWith(lower(txs.input), '${method.call_selector}')
      AND lower(txs.to) = '${method.token}'
      AND (receipts.status = 0 OR receipts.status = '0')
  `).join('\nUNION ALL\n')
}

function buildRawPaymentsSourceQuery(days: number, statuses: PaymentStatus[] = ['success', 'failed']) {
  const sources: string[] = []

  if (statuses.includes('success')) {
    sources.push(...PAYMENT_METHODS.map(method => `
      SELECT
        toDate(block_timestamp) AS day,
        concat('0x', lower(substring(topic1, 27, 40))) AS sender,
        concat('0x', lower(substring(topic2, 27, 40))) AS recipient,
        toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / ${10 ** method.decimals} AS amount,
        'success' AS status
      FROM logs
      WHERE block_timestamp >= now() - INTERVAL ${days} DAY
        AND selector = '${method.event_selector}'
        AND lower(address) = '${method.token}'
    `))
  }

  if (statuses.includes('failed')) {
    sources.push(...PAYMENT_METHODS.map(method => `
      SELECT
        toDate(txs.block_timestamp) AS day,
        lower(txs.from) AS sender,
        lower(concat('0x', substr(txs.input, 35, 40))) AS recipient,
        0.0 AS amount,
        'failed' AS status
      FROM txs
      LEFT JOIN receipts ON receipts.tx_hash = txs.hash
      WHERE txs.block_timestamp >= now() - INTERVAL ${days} DAY
        AND startsWith(lower(txs.input), '${method.call_selector}')
        AND lower(txs.to) = '${method.token}'
        AND (receipts.status = 0 OR receipts.status = '0')
    `))
  }

  return sources.join('\nUNION ALL\n')
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

async function getPaymentActorsByDay(days: number) {
  const cacheKey = `payments:daily-actors:${days}`
  const cached = await getCached<Map<string, { unique_senders: number; unique_recipients: number }> | [string, { unique_senders: number; unique_recipients: number }][]>(cacheKey)
  if (cached !== null) {
    return cached instanceof Map ? cached : new Map(cached)
  }

  const rows = await queryClickHouse<RawPaymentActorCountRow>(`
    SELECT
      day,
      uniqExact(sender) AS unique_senders,
      uniqExact(recipient) AS unique_recipients
    FROM (${buildRawPaymentsSourceQuery(days)})
    GROUP BY day
    ORDER BY day ASC
  `)

  const mapped = new Map(rows.map(row => [
    sliceDay(String(row.day)),
    {
      unique_senders: toNumber(row.unique_senders),
      unique_recipients: toNumber(row.unique_recipients),
    },
  ]))

  await setCached(cacheKey, Array.from(mapped.entries()), CACHE_TTL_SECONDS)
  return mapped
}

async function getPaymentActorSummary(days: number) {
  const cacheKey = `payments:actor-summary:${days}`
  const cached = await getCached<{ unique_senders: number; unique_recipients: number }>(cacheKey)
  if (cached !== null) return cached

  const rows = await queryClickHouse<RawPaymentActorCountRow>(`
    SELECT
      uniqExact(sender) AS unique_senders,
      uniqExact(recipient) AS unique_recipients
    FROM (${buildRawPaymentsSourceQuery(days)})
  `)

  const summary = {
    unique_senders: toNumber(rows[0]?.unique_senders),
    unique_recipients: toNumber(rows[0]?.unique_recipients),
  }

  await setCached(cacheKey, summary, CACHE_TTL_SECONDS)
  return summary
}

async function getTopCounterparties(
  kind: 'recipient' | 'sender',
  orderBy: 'amount' | 'count',
  limit = 10,
  days = 30,
): Promise<PaymentCounterpartyRow[]> {
  const cacheKey = `payments:${kind}:${orderBy}:${limit}:${days}`
  const cached = await getCached<PaymentCounterpartyRow[]>(cacheKey)
  if (cached !== null) return cached

  const field = kind === 'recipient' ? 'recipient' : 'sender'
  const orderClause = orderBy === 'amount'
    ? 'total_amount DESC, payment_count DESC, address ASC'
    : 'payment_count DESC, total_amount DESC, address ASC'

  const rows = await queryClickHouse<RawPaymentCounterpartyRow>(`
    SELECT
      ${field} AS address,
      count() AS payment_count,
      round(sum(amount), 2) AS total_amount
    FROM (${buildRawPaymentsSourceQuery(days, ['success'])})
    GROUP BY address
    ORDER BY ${orderClause}
    LIMIT ${limit}
  `)

  const mapped = rows.map(row => ({
    address: String(row.address).toLowerCase(),
    payment_count: toNumber(row.payment_count),
    total_amount: normalizeAggregateAmount(row),
  }))

  await setCached(cacheKey, mapped, CACHE_TTL_SECONDS)
  return mapped
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

export async function getPaymentsDaily(days = 30): Promise<PaymentsDailyPoint[]> {
  const cacheKey = `payments:daily:${days}`
  const cached = await getCached<PaymentsDailyPoint[]>(cacheKey)
  if (cached !== null) return cached

  const [metricRows, actorsByDay] = await Promise.all([
    queryClickHouse<RawPaymentDailyMetricRow>(`
      SELECT
        day,
        sum(successful_payments) AS successful_payments,
        sum(failed_attempts) AS failed_attempts,
        sum(total_amount) AS total_amount,
        sum(readable_memos) AS readable_memos,
        sum(opaque_memos) AS opaque_memos,
        sum(empty_memos) AS empty_memos
      FROM mv_memo_payments_daily
      WHERE day >= today() - ${days}
      GROUP BY day
      ORDER BY day ASC
    `),
    getPaymentActorsByDay(days),
  ])

  const mapped = metricRows.map(row => {
    const day = sliceDay(row.day)
    const actors = actorsByDay.get(day)

    return {
      day,
      successful_payments: toNumber(row.successful_payments),
      failed_attempts: toNumber(row.failed_attempts),
      total_amount: normalizeAggregateAmount(row),
      unique_senders: actors?.unique_senders ?? 0,
      unique_recipients: actors?.unique_recipients ?? 0,
      readable_memos: toNumber(row.readable_memos),
      opaque_memos: toNumber(row.opaque_memos),
      empty_memos: toNumber(row.empty_memos),
    }
  })

  await setCached(cacheKey, mapped, CACHE_TTL_SECONDS)
  return mapped
}

export async function getPaymentsSummary(days = 30): Promise<PaymentsSummaryStats> {
  const cacheKey = `payments:summary:${days}`
  const cached = await getCached<PaymentsSummaryStats>(cacheKey)
  if (cached !== null) return cached

  const [metricRows, actors] = await Promise.all([
    queryClickHouse<RawPaymentSummaryMetricRow>(`
      SELECT
        sum(successful_payments) AS successful_payments,
        sum(failed_attempts) AS failed_attempts,
        sum(total_amount) AS total_amount
      FROM mv_memo_payments_daily
      WHERE day >= today() - ${days}
    `),
    getPaymentActorSummary(days),
  ])

  const metrics = metricRows[0]
  const successful_payments = toNumber(metrics?.successful_payments)
  const failed_attempts = toNumber(metrics?.failed_attempts)
  const attempts = successful_payments + failed_attempts

  const summary: PaymentsSummaryStats = {
    successful_payments,
    failed_attempts,
    success_rate: attempts === 0 ? 0 : roundTo((successful_payments * 100) / attempts),
    total_amount: metrics ? normalizeAggregateAmount(metrics) : 0,
    unique_senders: actors.unique_senders,
    unique_recipients: actors.unique_recipients,
  }

  await setCached(cacheKey, summary, CACHE_TTL_SECONDS)
  return summary
}

export async function getPaymentsPageData(): Promise<PaymentsPageData> {
  const summary = await getPaymentsSummary()
  const daily = await getPaymentsDaily()
  const recent = await getRecentPayments()
  const topRecipientsByAmount = await getTopCounterparties('recipient', 'amount')
  const topRecipientsByCount = await getTopCounterparties('recipient', 'count')
  const topSenders = await getTopCounterparties('sender', 'count')

  return {
    summary,
    daily,
    recent,
    topRecipientsByAmount,
    topRecipientsByCount,
    topSenders,
  }
}
