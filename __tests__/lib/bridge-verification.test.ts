import { verifyBridgeFlowSample } from '@/lib/bridge-verification'

jest.mock('@/lib/chain', () => ({
  publicClient: {
    getTransactionReceipt: jest.fn(),
  },
}))

const { publicClient } = jest.requireMock('@/lib/chain') as {
  publicClient: {
    getTransactionReceipt: jest.Mock
  }
}

describe('verifyBridgeFlowSample', () => {
  beforeEach(() => {
    publicClient.getTransactionReceipt.mockReset()
  })

  test('returns matched_receipt_logs when a receipt log matches a provider contract', async () => {
    publicClient.getTransactionReceipt.mockResolvedValue({
      logs: [{ address: '0xabc0000000000000000000000000000000000000' }],
    })

    const result = await verifyBridgeFlowSample({
      tx_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      provider_contracts: ['0xabc0000000000000000000000000000000000000'],
    })

    expect(publicClient.getTransactionReceipt).toHaveBeenCalledWith({
      hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    })
    expect(result).toEqual({ ok: true, reason: 'matched_receipt_logs' })
  })

  test('matches provider contracts case-insensitively', async () => {
    publicClient.getTransactionReceipt.mockResolvedValue({
      logs: [{ address: '0xabc0000000000000000000000000000000000000' }],
    })

    const result = await verifyBridgeFlowSample({
      tx_hash: '0x4444444444444444444444444444444444444444444444444444444444444444',
      provider_contracts: ['0xAbC0000000000000000000000000000000000000'],
    })

    expect(result).toEqual({ ok: true, reason: 'matched_receipt_logs' })
  })

  test('returns provider_contract_not_seen when receipt exists but no provider contract is present', async () => {
    publicClient.getTransactionReceipt.mockResolvedValue({
      logs: [{ address: '0xdef0000000000000000000000000000000000000' }],
    })

    const result = await verifyBridgeFlowSample({
      tx_hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      provider_contracts: ['0xabc0000000000000000000000000000000000000'],
    })

    expect(result).toEqual({ ok: false, reason: 'provider_contract_not_seen' })
  })

  test('returns rpc_error when the RPC call throws', async () => {
    publicClient.getTransactionReceipt.mockRejectedValue(new Error('boom'))

    const result = await verifyBridgeFlowSample({
      tx_hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      provider_contracts: ['0xabc0000000000000000000000000000000000000'],
    })

    expect(result).toEqual({ ok: false, reason: 'rpc_error' })
  })
})
