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
  getRecentPayments,
} from '@/lib/payments'

const mockQuery = queryClickHouse as jest.Mock
const mockGetCached = getCached as jest.Mock
const mockSetCached = setCached as jest.Mock

beforeEach(() => {
  mockQuery.mockReset()
  mockGetCached.mockReset()
  mockSetCached.mockReset()
  mockGetCached.mockResolvedValue(null)
  mockSetCached.mockResolvedValue(undefined)
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

test('reads recent payments from cache before querying clickhouse', async () => {
  mockGetCached.mockResolvedValueOnce([
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
