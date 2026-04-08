import { decodeCalldata } from '@/lib/whatsabi'

// Mock viem to avoid TextEncoder issues in jest
jest.mock('viem', () => ({
  decodeFunctionData: jest.fn(() => ({ functionName: 'mockFn', args: [] })),
  createPublicClient: jest.fn(() => ({
    getBytecode: jest.fn(),
  })),
  http: jest.fn(),
  defineChain: jest.fn((c: unknown) => c),
}))

// Mock publicClient from chain.ts
jest.mock('@/lib/chain', () => ({
  publicClient: {
    getBytecode: jest.fn().mockRejectedValue(new Error('network error')),
  },
  tempoChain: {},
}))

const TRANSFER_INPUT =
  '0xa9059cbb' +
  '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12' +
  '0000000000000000000000000000000000000000000000000000000005F5E100'

test('decodes known selector from registry without RPC', async () => {
  // fetch should NOT be called for known selectors
  global.fetch = jest.fn().mockRejectedValue(new Error('should not call fetch'))
  const result = await decodeCalldata(
    '0x20c0000000000000000000000000000000000000',
    TRANSFER_INPUT,
  )
  expect(result?.functionName).toBe('transfer(address,uint256)')
  expect(fetch).not.toHaveBeenCalled()
})

test('returns protocol label for 0x0000 address without RPC', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('should not call fetch'))
  const result = await decodeCalldata(
    '0x0000000000000000000000000000000000000000',
    '0xc0000000' + '0'.repeat(64),
  )
  expect(result?.functionName).toBe('[Tempo] protocol block record')
  expect(fetch).not.toHaveBeenCalled()
})

test('returns inscription label for JSON input', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('should not call fetch'))
  const jsonHex = '0x' + Buffer.from('{"p":"tip-20","op":"mint","tick":"TEMP","amt":"420"}').toString('hex')
  const result = await decodeCalldata(
    '0x0000000000000000000000000000000000000000',
    jsonHex,
  )
  expect(result?.functionName).toBe('[TIP-20] mint TEMP × 420')
  expect(fetch).not.toHaveBeenCalled()
})

test('returns null for empty input', async () => {
  const result = await decodeCalldata('0x1234000000000000000000000000000000000000', '0x')
  expect(result).toBeNull()
})

test('returns null on RPC failure without throwing', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
  const result = await decodeCalldata(
    '0x1234000000000000000000000000000000000000',
    '0xdeadbeef' + '0'.repeat(64),
  )
  expect(result).toBeNull()
})
