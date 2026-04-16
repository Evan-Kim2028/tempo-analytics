# Tempo Semantics

This document records Tempo-specific protocol fields and local analytics heuristics used by this explorer. It explains existing analytics behavior; it does not define new product behavior.

## Protocol-Backed Values

### Tempo Transaction Type

Tempo transactions use EIP-2718 transaction type `0x76`. The explorer and TIDX/ClickHouse expose that envelope as decimal `118`, so analytics queries classify Tempo transaction envelopes with `type = 118`.

Sources:
- https://docs.tempo.xyz/protocol/transactions/spec-tempo-transaction
- https://rustdocs.tempo.xyz/tempo_primitives/transaction/tempo_transaction/index.html

### Signature Types

Tempo signature types are treated as:

| Value | Label |
| --- | --- |
| `0` | Secp256k1 / standard EVM |
| `1` | P256 |
| `2` | WebAuthn / passkey |

Source:
- https://docs.tempo.xyz/protocol/transactions/AccountKeychain

### Fee Sponsorship

The explorer treats a transaction as sponsored when `fee_payer` is populated and differs from `from`. In practice, this means another account paid gas for the sender.

Source:
- https://docs.tempo.xyz/protocol/fees/spec-fee

### Fee Token

`fee_token` is the indexed token used to pay gas when it is explicitly populated. Analytics that group by fee token generally exclude null values unless otherwise stated.

Sources:
- https://docs.tempo.xyz/protocol/fees/spec-fee
- https://tokenlist.tempo.xyz/list/4217

### Validity Windows

`valid_before` and `valid_after` represent Tempo transaction validity bounds. The explorer counts a transaction as time-bounded when both fields are present.

Source:
- https://docs.tempo.xyz/protocol/transactions/spec-tempo-transaction

## Explorer Analytics Definitions

### Tempo Tx Share

Tempo transaction share over time is defined with `type = 118`. Total transactions are all indexed transactions in the same time bucket.

### Tempo Wallet Adoption

Feature adoption is measured across Tempo transaction envelopes.

| Metric | Current predicate |
| --- | --- |
| Sponsored | `type = 118 AND fee_payer IS NOT NULL AND fee_payer != from` |
| Batched | `type = 118 AND call_count > 1` |
| Time bounded | `type = 118 AND valid_before IS NOT NULL AND valid_after IS NOT NULL` |
| Fee token set | `type = 118 AND fee_token IS NOT NULL` |

### WebAuthn/Passkey Usage

WebAuthn/passkey usage is represented as Tempo transactions where `signature_type = 2`.

## Local Heuristics

### Batch Detection Ambiguity

Most analytics use `call_count > 1` to represent multi-call Tempo envelopes. Some display paths may use `call_count > 0`; treat that as a display convention unless it is separately reconciled.

### Inscriptions

`inscription_txs` is an explorer heuristic for transactions whose input begins with `0x7b`, the ASCII byte for `{`. This identifies JSON-looking calldata and is not a Tempo protocol category.

### Memo Families

Payment memo families such as `ef1e:*`, `mpps:*`, `SOC-*`, `daily-*`, and `Full*` are observed application patterns in memo-bearing stablecoin transfers. They are not Tempo protocol categories unless separately documented by the application owner.
