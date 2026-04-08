jest.mock('@/lib/clickhouse', () => ({ queryClickHouse: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn(),
  setCached: jest.fn(),
}))

import { queryClickHouse } from '@/lib/clickhouse'
import { getCached, setCached } from '@/lib/cache'
import {
  classifyMemoFamily,
  decodeMemoHex,
  PAYMENT_METHODS,
  getPaymentsDaily,
  getPaymentsPageData,
  getPaymentsSummary,
  getRecentPayments,
} from '@/lib/payments'

const mockQuery = queryClickHouse as jest.Mock
const mockGetCached = getCached as jest.Mock
const mockSetCached = setCached as jest.Mock
const cacheStore = new Map<string, unknown>()

beforeEach(() => {
  mockQuery.mockReset()
  mockGetCached.mockReset()
  mockSetCached.mockReset()
  cacheStore.clear()
  mockGetCached.mockImplementation(async (key: string) =>
    cacheStore.has(key) ? cacheStore.get(key) : null,
  )
  mockSetCached.mockImplementation(async (key: string, value: unknown) => {
    cacheStore.set(key, value)
  })
})

test('exports the confirmed pathUSD payment rail', () => {
  expect(PAYMENT_METHODS).toContainEqual({
    token: '0x20c0000000000000000000000000000000000000',
    token_label: 'pathUSD',
    call_selector: '0x95777d59',
    event_selector: '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0',
    decimals: 6,
  })
})

test('decodes printable bytes32 memo values', () => {
  expect(decodeMemoHex('0x534f432d30307a66393162640000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
    memo_text: 'SOC-00zf91bd',
    memo_kind: 'readable',
  })
})

test('keeps non-printable memo values opaque', () => {
  expect(decodeMemoHex('0xff00aa0000000000000000000000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
    memo_text: null,
    memo_kind: 'opaque',
  })
})

test('treats zero bytes as an empty memo', () => {
  expect(decodeMemoHex('0x0000000000000000000000000000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0x0000000000000000000000000000000000000000000000000000000000000000',
    memo_text: null,
    memo_kind: 'empty',
  })
})

test('treats malformed hex input as opaque', () => {
  expect(decodeMemoHex('0x414243zz')).toEqual({
    memo_hex: '0x414243zz',
    memo_text: null,
    memo_kind: 'opaque',
  })
  expect(decodeMemoHex('0xgg')).toEqual({
    memo_hex: '0xgg',
    memo_text: null,
    memo_kind: 'opaque',
  })
})

test('normalizes non-0x input to an empty memo', () => {
  expect(decodeMemoHex('abcdef')).toEqual({
    memo_hex: '0x0000000000000000000000000000000000000000000000000000000000000000',
    memo_text: null,
    memo_kind: 'empty',
  })
})

test('preserves spaces in printable memo text', () => {
  expect(decodeMemoHex('0x536f63204d656d6f000000000000000000000000000000000000000000000000')).toEqual({
    memo_hex: '0x536f63204d656d6f000000000000000000000000000000000000000000000000',
    memo_text: 'Soc Memo',
    memo_kind: 'readable',
  })
})

test('classifies readable memo families', () => {
  expect(classifyMemoFamily('SOC-00zf91bd')).toBe('SOC-*')
  expect(classifyMemoFamily('daily-2026-04-08')).toBe('daily-*')
  expect(classifyMemoFamily('FullSettlement')).toBe('Full*')
  expect(classifyMemoFamily('')).toBeNull()
  expect(classifyMemoFamily(null)).toBeNull()
})

test('merges successful memo events and failed direct calls into one recent-payments list', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:00:00',
        tx_hash: '0xsuccess',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '1250000',
        memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:05:00',
        tx_hash: '0xfailed',
        sender: '0x3333333333333333333333333333333333333333',
        recipient: '0x4444444444444444444444444444444444444444',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '990000',
        memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
      },
    ])

  await expect(getRecentPayments(10)).resolves.toEqual([
    expect.objectContaining({
      tx_hash: '0xfailed',
      status: 'failed',
      amount: 0.99,
      memo_kind: 'opaque',
      memo_family: null,
    }),
    expect.objectContaining({
      tx_hash: '0xsuccess',
      status: 'success',
      amount: 1.25,
      memo_text: 'SOC-00zf91bd',
      memo_family: 'SOC-*',
    }),
  ])
})

test('normalizes successful row topic addresses to canonical 20-byte addresses', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:00:00',
        tx_hash: '0xsuccess',
        sender: '0x0000000000000000000000001111111111111111111111111111111111111111',
        recipient: '0x0000000000000000000000002222222222222222222222222222222222222222',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '1250000',
        memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([])

  await expect(getRecentPayments(10)).resolves.toEqual([
    expect.objectContaining({
      sender: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      status: 'success',
      memo_text: 'SOC-00zf91bd',
    }),
  ])
})

test('uses distinct cache keys and writes per limit and days inputs', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:00:00',
        tx_hash: '0xlimit10',
        sender: '0x0000000000000000000000001111111111111111111111111111111111111111',
        recipient: '0x0000000000000000000000002222222222222222222222222222222222222222',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '1250000',
        memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:05:00',
        tx_hash: '0xlimit25',
        sender: '0x0000000000000000000000003333333333333333333333333333333333333333',
        recipient: '0x0000000000000000000000004444444444444444444444444444444444444444',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '990000',
        memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([])

  await expect(getRecentPayments(10, 30)).resolves.toEqual([
    expect.objectContaining({
      tx_hash: '0xlimit10',
      sender: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
    }),
  ])

  await expect(getRecentPayments(25, 7)).resolves.toEqual([
    expect.objectContaining({
      tx_hash: '0xlimit25',
      sender: '0x3333333333333333333333333333333333333333',
      recipient: '0x4444444444444444444444444444444444444444',
    }),
  ])

  expect(mockGetCached).toHaveBeenNthCalledWith(1, 'payments:recent:10:30')
  expect(mockGetCached).toHaveBeenNthCalledWith(2, 'payments:recent:25:7')
  expect(mockSetCached).toHaveBeenNthCalledWith(1, 'payments:recent:10:30', expect.any(Array), 900)
  expect(mockSetCached).toHaveBeenNthCalledWith(2, 'payments:recent:25:7', expect.any(Array), 900)
})

test('reads recent payments from cache before querying clickhouse', async () => {
  cacheStore.set('payments:recent:25:30', [
    {
      timestamp: '2026-04-08 12:00:00',
      day: '2026-04-08',
      tx_hash: '0xcached',
      sender: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      token: '0x20c0000000000000000000000000000000000000',
      token_label: 'pathUSD',
      amount: 2.5,
      status: 'success',
      memo_hex: '0x534f432d63616368656400000000000000000000000000000000000000000000',
      memo_text: 'SOC-cached',
      memo_kind: 'readable',
      memo_family: 'SOC-*',
    },
  ])

  await expect(getRecentPayments(25)).resolves.toEqual([
    {
      timestamp: '2026-04-08 12:00:00',
      day: '2026-04-08',
      tx_hash: '0xcached',
      sender: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      token: '0x20c0000000000000000000000000000000000000',
      token_label: 'pathUSD',
      amount: 2.5,
      status: 'success',
      memo_hex: '0x534f432d63616368656400000000000000000000000000000000000000000000',
      memo_text: 'SOC-cached',
      memo_kind: 'readable',
      memo_family: 'SOC-*',
    },
  ])
  expect(mockQuery).not.toHaveBeenCalled()
})

test('filters failed payment calls by tx input selector prefix', async () => {
  mockQuery
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])

  await getRecentPayments(10, 14)

  expect(String(mockQuery.mock.calls[1]?.[0])).toContain("startsWith(lower(txs.input), '0x95777d59')")
  expect(String(mockQuery.mock.calls[1]?.[0])).not.toContain('txs.selector')
})

test('getPaymentsDaily(30) maps daily rollups plus exact actor counts', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        day: '2026-04-07',
        successful_payments: '2',
        failed_attempts: '1',
        total_amount_raw: '3000000',
        readable_memos: '1',
        opaque_memos: '1',
        empty_memos: '1',
      },
      {
        day: '2026-04-08',
        successful_payments: '1',
        failed_attempts: '0',
        total_amount_raw: '1250000',
        readable_memos: '1',
        opaque_memos: '0',
        empty_memos: '0',
      },
    ])
    .mockResolvedValueOnce([
      {
        day: '2026-04-07',
        unique_senders: '3',
        unique_recipients: '2',
      },
      {
        day: '2026-04-08',
        unique_senders: '1',
        unique_recipients: '1',
      },
    ])

  await expect(getPaymentsDaily(30)).resolves.toEqual([
    {
      day: '2026-04-07',
      successful_payments: 2,
      failed_attempts: 1,
      total_amount: 3,
      unique_senders: 3,
      unique_recipients: 2,
      readable_memos: 1,
      opaque_memos: 1,
      empty_memos: 1,
    },
    {
      day: '2026-04-08',
      successful_payments: 1,
      failed_attempts: 0,
      total_amount: 1.25,
      unique_senders: 1,
      unique_recipients: 1,
      readable_memos: 1,
      opaque_memos: 0,
      empty_memos: 0,
    },
  ])
})

test('reuses the tx input selector prefix for exact actor counts', async () => {
  mockQuery
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])

  await getPaymentsDaily(14)

  expect(String(mockQuery.mock.calls[1]?.[0])).toContain("startsWith(lower(txs.input), '0x95777d59')")
  expect(String(mockQuery.mock.calls[1]?.[0])).not.toContain('txs.selector')
})

test('getPaymentsSummary(30) computes payment totals and exact actor counts', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        successful_payments: '5',
        failed_attempts: '2',
        total_amount_raw: '4500000',
      },
    ])
    .mockResolvedValueOnce([
      {
        unique_senders: '4',
        unique_recipients: '3',
      },
    ])

  await expect(getPaymentsSummary(30)).resolves.toEqual({
    successful_payments: 5,
    failed_attempts: 2,
    success_rate: 71.43,
    total_amount: 4.5,
    unique_senders: 4,
    unique_recipients: 3,
  })
})

test('getPaymentsPageData() assembles summary, daily, recent, and counterparty leaderboards', async () => {
  mockQuery
    .mockResolvedValueOnce([
      {
        successful_payments: '4',
        failed_attempts: '1',
        total_amount_raw: '3750000',
      },
    ])
    .mockResolvedValueOnce([
      {
        unique_senders: '3',
        unique_recipients: '2',
      },
    ])
    .mockResolvedValueOnce([
      {
        day: '2026-04-08',
        successful_payments: '4',
        failed_attempts: '1',
        total_amount_raw: '3750000',
        readable_memos: '2',
        opaque_memos: '2',
        empty_memos: '1',
      },
    ])
    .mockResolvedValueOnce([
      {
        day: '2026-04-08',
        unique_senders: '3',
        unique_recipients: '2',
      },
    ])
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:00:00',
        tx_hash: '0xsuccess',
        sender: '0x0000000000000000000000001111111111111111111111111111111111111111',
        recipient: '0x0000000000000000000000002222222222222222222222222222222222222222',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '2500000',
        memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([
      {
        block_timestamp: '2026-04-08 12:05:00',
        tx_hash: '0xfailed',
        sender: '0x3333333333333333333333333333333333333333',
        recipient: '0x4444444444444444444444444444444444444444',
        token: '0x20c0000000000000000000000000000000000000',
        amount_raw: '990000',
        memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
      },
    ])
    .mockResolvedValueOnce([
      {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        payment_count: '3',
        total_amount_raw: '3200000',
      },
    ])
    .mockResolvedValueOnce([
      {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        payment_count: '2',
        total_amount_raw: '1800000',
      },
    ])
    .mockResolvedValueOnce([
      {
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        payment_count: '4',
        total_amount_raw: '3750000',
      },
    ])

  await expect(getPaymentsPageData()).resolves.toEqual({
    summary: {
      successful_payments: 4,
      failed_attempts: 1,
      success_rate: 80,
      total_amount: 3.75,
      unique_senders: 3,
      unique_recipients: 2,
    },
    daily: [
      {
        day: '2026-04-08',
        successful_payments: 4,
        failed_attempts: 1,
        total_amount: 3.75,
        unique_senders: 3,
        unique_recipients: 2,
        readable_memos: 2,
        opaque_memos: 2,
        empty_memos: 1,
      },
    ],
    recent: [
      expect.objectContaining({
        tx_hash: '0xfailed',
        status: 'failed',
      }),
      expect.objectContaining({
        tx_hash: '0xsuccess',
        status: 'success',
      }),
    ],
    topRecipientsByAmount: [
      {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        payment_count: 3,
        total_amount: 3.2,
      },
    ],
    topRecipientsByCount: [
      {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        payment_count: 2,
        total_amount: 1.8,
      },
    ],
    topSenders: [
      {
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        payment_count: 4,
        total_amount: 3.75,
      },
    ],
  })
})
