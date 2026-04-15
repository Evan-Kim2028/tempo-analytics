import { publicClient } from '@/lib/chain'

type HexString = `0x${string}`

export interface BridgeFlowSample {
  tx_hash: HexString
  provider_contracts: HexString[]
}

export type BridgeVerificationResult =
  | { ok: true; reason: 'matched_receipt_logs' }
  | { ok: false; reason: 'provider_contract_not_seen' | 'rpc_error' }

export async function verifyBridgeFlowSample(
  sample: BridgeFlowSample,
): Promise<BridgeVerificationResult> {
  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>

  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: sample.tx_hash,
    })
  } catch {
    return { ok: false, reason: 'rpc_error' }
  }

  const providerContracts = new Set(
    sample.provider_contracts.map(address => address.toLowerCase()),
  )

  const matched = receipt.logs.some(log =>
    providerContracts.has(log.address.toLowerCase()),
  )

  return matched
    ? { ok: true, reason: 'matched_receipt_logs' }
    : { ok: false, reason: 'provider_contract_not_seen' }
}
