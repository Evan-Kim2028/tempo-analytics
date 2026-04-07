// explorer/__tests__/lib/tokens.decode.test.ts
// Tests for the uint256 decoding formula used in ClickHouse and JS

// The ClickHouse formula: reinterpretAsUInt64(reverse(unhex(substring(data, 51, 16))))
// JS equivalent for verification:
function decodeUint256Lo(hexData: string): bigint {
  // hexData = '0x' + 64 hex chars (32-byte big-endian uint256)
  // We take the last 16 hex chars (8 bytes = UInt64) — safe for amounts < $18.4T
  const lo = hexData.slice(-16) // last 16 hex chars
  return BigInt('0x' + lo)
}

describe('decodeUint256Lo', () => {
  test('decodes zero', () => {
    expect(decodeUint256Lo('0x' + '0'.repeat(64))).toBe(0n)
  })

  test('decodes 1 USDC (1_000_000 raw = 0x...0F4240)', () => {
    const data = '0x' + '0'.repeat(58) + '0f4240'  // 1_000_000 in last 6 hex = 3 bytes
    expect(decodeUint256Lo(data)).toBe(1_000_000n)
  })

  test('decodes 0.031381 USDC.e (31_381 = 0x7a95)', () => {
    const data = '0x' + '0'.repeat(60) + '7a95'
    expect(decodeUint256Lo(data)).toBe(31_381n)
  })

  test('decodes 1000 raw (0x3e8)', () => {
    const data = '0x' + '0'.repeat(61) + '3e8'
    expect(decodeUint256Lo(data)).toBe(1_000n)
  })

  test('consistent with known pathUSD data field', () => {
    // From live chain: 0x0000...0000000000007a95 → 31381 raw → $0.031381
    const real = '0x0000000000000000000000000000000000000000000000000000000000007a95'
    expect(decodeUint256Lo(real)).toBe(0x7a95n) // 31381
  })
})
