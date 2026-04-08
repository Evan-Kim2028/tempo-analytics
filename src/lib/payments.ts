const ZERO_MEMO = '0x' + '00'.repeat(32)

export type PaymentStatus = 'success' | 'failed'
export type MemoKind = 'readable' | 'opaque' | 'empty'

export interface SupportedPaymentMethod {
  token: string
  token_label: string
  call_selector: string
  event_selector: string
  decimals: number
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
