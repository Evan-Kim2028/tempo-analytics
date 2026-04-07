import type { DecodedCalldata } from '@/lib/whatsabi'

const SIG_TYPES: Record<number, string> = {
  0: 'Secp256k1 (standard EVM)',
  1: 'P256 (hardware key)',
  2: 'WebAuthn (passkey)',
}

interface TxDetailProps {
  tx: Record<string, string | number | null>
  receipt: Record<string, string | number | null> | null
  decoded?: DecodedCalldata | null
}

function Field({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3 border-b border-tempo-border last:border-0">
      <dt className="text-tempo-muted text-sm">{label}</dt>
      <dd className={`col-span-2 text-sm text-white break-all ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-tempo-muted">—</span>}
      </dd>
    </div>
  )
}

export function TxDetail({ tx, receipt, decoded }: TxDetailProps) {
  const sigType = tx.signature_type != null ? (SIG_TYPES[Number(tx.signature_type)] ?? `Type ${tx.signature_type}`) : null
  const isSponsored = tx.fee_payer && tx.fee_payer !== tx.from
  const hasBatchCalls = Number(tx.call_count ?? 0) > 0

  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
      <dl>
        <Field label="Hash" value={tx.hash as string} />
        <Field label="Block" value={
          <a href={`/block/${tx.block_num}`} className="text-tempo-blue hover:underline">
            {String(tx.block_num)}
          </a>
        } />
        <Field label="Timestamp" value={tx.block_timestamp as string} />
        <Field label="From" value={
          <a href={`/address/${tx.from}`} className="text-tempo-blue hover:underline">
            {tx.from as string}
          </a>
        } />
        <Field label="To" value={
          tx.to ? <a href={`/address/${tx.to}`} className="text-tempo-blue hover:underline">{tx.to as string}</a> : <span className="text-yellow-400">Contract Creation</span>
        } />
        <Field label="Value" value={`${tx.value ?? '0'} wei`} />
        <Field label="Status" value={
          receipt ? (
            Number(receipt.status) === 1
              ? <span className="text-green-400">Success</span>
              : <span className="text-red-400">Failed</span>
          ) : null
        } mono={false} />
        <Field label="Signature Type" value={sigType} mono={false} />
        <Field label="Fee Token" value={tx.fee_token as string | null} />
        <Field label="Fee Payer" value={
          isSponsored
            ? <>{tx.fee_payer as string} <span className="text-yellow-400 ml-2 text-xs">(sponsored)</span></>
            : tx.fee_payer as string
        } />
        {hasBatchCalls && (
          <Field label="Batch Calls" value={`${tx.call_count} calls`} mono={false} />
        )}
        {tx.valid_before && <Field label="Valid Before" value={tx.valid_before as string} />}
        {tx.valid_after && <Field label="Valid After" value={tx.valid_after as string} />}
        {decoded && (
          <Field
            label="Function"
            value={
              <span>
                {decoded.functionName}
                {decoded.args && decoded.args.length > 0 && (
                  <span className="text-tempo-muted ml-2 text-xs">
                    ({decoded.args.slice(0, 3).join(', ')}{decoded.args.length > 3 ? ', …' : ''})
                  </span>
                )}
              </span>
            }
            mono={false}
          />
        )}
        <Field label="Nonce Key" value={tx.nonce_key as string | null} />
        <Field label="Nonce" value={tx.nonce != null ? String(tx.nonce) : null} />
        {receipt && <Field label="Gas Used" value={String(receipt.gas_used)} />}
      </dl>
    </div>
  )
}
