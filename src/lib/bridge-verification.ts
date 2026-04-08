import { publicClient } from '@/lib/chain'

export interface BridgeFlowSample {
  tx_hash: string
  provider_contracts: string[]
}

export type BridgeVerificationResult =
  | { ok: true; reason: 'matched_receipt_logs' }
  | { ok: false; reason: 'provider_contract_not_seen' | 'rpc_error' }

export async function verifyBridgeFlowSample(
  sample: BridgeFlowSample,
): Promise<BridgeVerificationResult> {
  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: sample.tx_hash as `0x${string}`,
    })

    const providerContracts = new Set(
      sample.provider_contracts.map(address => address.toLowerCase()),
    )

    const matched = receipt.logs.some(log =>
      providerContracts.has(log.address.toLowerCase()),
    )

    return matched
      ? { ok: true, reason: 'matched_receipt_logs' }
      : { ok: false, reason: 'provider_contract_not_seen' }
  } catch {
    return { ok: false, reason: 'rpc_error' }
  }
}
