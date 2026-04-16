# Tempo as a Micropayment Chain: On-Chain Evidence

> **Date:** 2026-04-15
> **Data window:** Last 30 days of mainnet activity (spot queries; 90-day window noted where used)
> **Source:** ClickHouse analytics over `tidx_4217` (receipts, logs, txs)
> **Scope:** 17 whitelisted TIP-20 stablecoins (pathUSD, USDC.e, EURC.e, and others); excludes zero-address mints
> **Reproducible:** All metrics in this doc have corresponding SQL in the [Appendix](#appendix-reproducible-queries)

---

## Executive Summary

84% of all payment transactions on Tempo move less than $0.10. The chain is already functioning as a micropayment rail at scale — roughly 130,000 sub-dime transactions per month — and the economics reveal something important for the chain's long-term health: **micropayments are the chain's most gas-revenue-efficient transaction type, by a wide margin**.

Because `transferWithMemo` costs the same fixed gas regardless of how much value is transferred, high-frequency small payments generate far more gas revenue per dollar of economic activity than infrequent large ones. At $0.01 per payment, $100 of micropayment volume produces **~$15 in gas fees** (10,000 txs × $0.00152). The same $100 as a single transfer produces **$0.0015** — a 10,000× difference in chain revenue for the same economic volume.

A deep investigation of the memo field, sender funding patterns, and protocol markers reveals something more specific: **Tempo's micropayment activity is almost entirely driven by one platform operating a wallet factory of 13,616+ addresses**, using the chain as a high-frequency settlement bus. The dollar amounts are signals, not value transfers. The memo is the product.

There is no evidence of HTTP 402 / Machine Payable Protocol usage yet. The `mppshafu` format is the closest thing — a compact payment-proof format that could power pay-per-request APIs, but only 30 payments exist in 90 days.

---

## 1. Payment Tier Breakdown (Last 30 Days)

All figures: 17 whitelisted stablecoins, excluding zero-address mints. See [Q1](#q1-payment-tier-breakdown) for the full query.

| Tier | Tx Count | % of Txs | Total USD Moved | % of USD | Avg Payment | Avg Gas Cost | Unique Senders | Unique Recipients |
|------|----------|-----------|-----------------|----------|-------------|--------------|----------------|-------------------|
| **Under $0.01** | 92,699 | **54%** | $259 | 0.07% | $0.00322 | $0.00127 | 1,840 | 202 |
| **$0.01–$0.10** | 50,352 | **30%** | $1,342 | 0.37% | $0.02952 | $0.00196 | 2,218 | 5,534 |
| $0.10–$1.00 | 18,198 | 10.6% | $6,015 | 1.6% | $0.381 | $0.00150 | 1,939 | 632 |
| $1–$10 | 3,840 | 2.2% | $10,623 | 2.9% | $2.89 | $0.00326 | 1,055 | 823 |
| $10–$100 | 758 | 0.4% | $20,000 | 5.5% | $26.37 | $0.00292 | 373 | 156 |
| $100+ | 459 | 0.3% | $329,562 | **89.7%** | $717 | $0.00292 | 140 | 62 |

**84% of transactions are under $0.10 but carry only 0.44% of value.** 459 transactions over $100 moved 90% of everything. The value distribution and the gas revenue distribution point in completely opposite directions — see §2.1 for why that's good for the chain.

### 1.1 Sub-tier Breakdown Within Micropayments (Last 30 Days)

The under-$0.10 bucket breaks down further. See [Q2](#q2-micropayment-sub-tier-breakdown) for the query. (Counts differ slightly from §1 due to different query methods — §1 uses a logs-based join with receipts for gas data; §1.1 uses logs only.)

| Sub-tier | Tx Count | % of Micropayments | Total USD Moved | Avg Payment |
|----------|----------|--------------------|-----------------|-------------|
| **Under $0.01** | 81,679 | **64%** | $259 | $0.00317 |
| **$0.01–$0.05** | 37,454 | **29%** | $822 | $0.02195 |
| **$0.05–$0.10** | 8,485 | **7%** | $522 | $0.06152 |
| **Total <$0.10** | **127,618** | 100% | $1,603 | $0.01257 |

The under-$0.01 tier is almost entirely ef1e sub-cent signals ($0.001–$0.005 fixed amounts). The $0.01–$0.05 tier is still mostly ef1e but includes some SOC-* reconciliation payments. The $0.05–$0.10 tier is the most organic — consumer micro-tips, travel micro-settlements, and B2B reconciliation references.

---

## 2. Gas Cost vs. Payment Value

A `transferWithMemo` costs approximately **51,287 gas at ~20 gwei ≈ $0.00152 USD** per transaction (stablecoin-denominated). Gas price has been flat across the 30-day window. See [Q3](#q3-gas-cost-vs-payment-value) for the per-tier breakdown.

| Tier | Avg Payment | Avg Gas | Gas as % of Payment | Txs where gas > payment |
|------|-------------|---------|---------------------|--------------------------|
| Under $0.01 | $0.00322 | $0.00127 | **39%** | 37,985 (41%) |
| $0.01–$0.10 | $0.02952 | $0.00196 | 6.6% | 318 (0.6%) |
| $0.10–$1.00 | $0.381 | $0.00150 | 0.4% | 0 |
| $1+ | $2.89+ | ~$0.003 | <0.1% | 0 |

**Aggregate economics for all micropayments (<$0.10) over 30 days:**

| Metric | Value |
|--------|-------|
| Total transactions | ~130,000 |
| Total value moved | ~$1,600 |
| Total gas fees paid | ~$217 |
| Effective fee rate | **~13%** |

For comparison: Visa charges 1.5–3%. An Ethereum L1 equivalent transfer would cost roughly $3–7 at typical gas prices. Tempo is orders of magnitude cheaper per transaction in absolute terms, but at sub-cent payment sizes, gas as a percentage of value is still high. The math improves dramatically with batch transactions (currently at 0.24% adoption) or lower gas prices.

### 2.1 Micropayments Are the Chain's Most Gas-Revenue-Efficient Transaction Type

Because `transferWithMemo` costs the same fixed gas regardless of transfer amount, the chain earns gas revenue proportional to *transaction count*, not *dollar value*. This makes micropayments — high transaction count, low value — the most efficient gas revenue source per dollar of economic activity on the chain.

**Gas revenue per $1 of value transferred, by tier** (derived from §1 tier table; see [Q4](#q4-gas-revenue-efficiency-by-tier)):

| Tier | Total Value | Total Gas | Gas per $1 of Value |
|------|-------------|-----------|---------------------|
| **Under $0.01** | $259 | ~$118 | **$0.455 (45.5%)** |
| **$0.01–$0.10** | $1,342 | ~$99 | **$0.074 (7.4%)** |
| $0.10–$1.00 | $6,015 | ~$27 | $0.0045 (0.45%) |
| $1–$10 | $10,623 | ~$13 | $0.0012 (0.12%) |
| $10–$100 | $20,000 | ~$2.21 | $0.00011 (0.01%) |
| $100+ | $329,562 | ~$1.34 | **$0.0000041 (0.0004%)** |

> **How the "Total Gas" column is derived:** each row multiplies the tier's tx count by its avg gas/tx from the §1 table. These are approximations; the exact figures require a full JOIN query (see Q4).

The chain earns **~110,000× more gas revenue** per dollar flowing through the sub-cent tier than per dollar flowing through the $100+ tier — because sub-cent payments average $0.003 each, meaning $1 of value represents ~333 transactions.

Using $0.01 as a more conservative micropayment baseline (a round, realistic payment size):

```
$100 of volume ÷ $0.01 per payment = 10,000 transactions
10,000 transactions × $0.00152 gas   = $15.20 in gas fees
```

The same $100 as a single large transfer: 1 transaction × $0.00152 = **$0.0015** in gas — a **10,000× difference**.

Both micro and large payments call the same `transferWithMemo` function — same contract, same storage writes, same ~51,287 gas units. The difference isn't what the chain does; it's how many times it does it.

**Comparing just the two payment categories (see [Q5](#q5-gas-by-payment-category)):**

| Category | Tx Count | Avg Gas/Tx | Total Gas |
|----------|----------|------------|-----------|
| **Micropayments (<$0.10)** | 138,654 | $0.00152 | **$210** |
| **Large payments (≥$0.10)** | 23,309 | $0.00186 | $43 |

The ~22% gap in average gas/tx is not structural — it reflects gas price variation across different time periods, not different execution cost. The chain doesn't charge more for larger transfers.

**The growth implication:** growing micropayment volume is the highest-leverage path to gas revenue growth on Tempo. If the ef1e platform doubled its transaction frequency, chain gas revenue from payments would roughly double. If a single large institution moved $1M through one transfer, chain gas revenue would increase by about $1.50.

### 2.2 Gas Token Preference by Payment Tier (Last 30 Days)

Which stablecoin do senders use to pay gas fees? See [Q6](#q6-gas-token-preference).

| Payment Type | USDC.e | pathUSD |
|--------------|--------|---------|
| **Micropayments (<$0.10)** | **63.7%** (85,332 txs) | 36.3% (48,693 txs) |
| **Large payments (≥$0.10)** | 18.2% (4,324 txs) | **81.8%** (19,444 txs) |

This is a striking reversal. Micropayment senders — almost entirely ef1e bot wallets — strongly prefer **USDC.e for gas**. Large payment senders strongly prefer **pathUSD**. The reason is structural: the master distributor loads wallets with USDC.e, so those wallets use USDC.e for both the payment and the gas fee. Large payment senders are organic wallets that acquired pathUSD through the Protocol DEX or received it directly — they pay fees in the chain's native stablecoin.

---

## 3. The Master Distributor — One Platform, 13,616 Wallets

The most important structural finding: **the micropayment senders are not independent users**. They are wallets funded by a single distributor address. See [Q7](#q7-master-distributor-analysis).

**`0xf70da97812cb96acdf810712aa562db8dfa3dbef`** — the apparent platform treasury:

| Metric | Value |
|--------|-------|
| Unique wallets funded (90d) | **13,616** |
| Total USDC.e distributed | **$3.17M** |
| Total transfers out | 115,559 |
| Active since | 2026-02-02 |
| Does it do `transferWithMemo`? | **No — never** |

This address only sends normal ERC-20 transfers (plain `Transfer` events). It never makes memo payments itself. Its entire purpose is pre-loading user wallets with USDC.e before those wallets make ef1e micropayments. Of the ef1e payment senders active in the last 30 days, **1,135 of them were funded by this address** — the vast majority.

Two secondary distributors:
- **`0x1086b62b`** — funded 73 wallets, $11,601 distributed, active from Feb 2026
- **`0x33b90101`** — funded 154 wallets, $4,618 distributed, 8,840 transfers (high-frequency small top-ups)

**This is one company or platform** operating a wallet factory. They pre-fund thousands of wallets, each wallet makes automated ef1e micropayments, and the settlement flows to a single aggregator recipient. None of the 13,616 wallets spontaneously appeared — they were all created and loaded by the same source.

---

## 4. Complete Memo Taxonomy

The `topic3` field of `transferWithMemo` events is the richest data source on Tempo. Eleven distinct formats are visible. See [Q8](#q8-memo-format-taxonomy) for classification query.

---

### 4.1 ef1e — Account Settlement Signals (97% of all payments)

```
Format: ef1ed712 [10-byte account ID] [20-byte recipient reference]
Example: ef1ed712014ebd1b9bc9 + 0200000000000000000000e8b4d8da713b7b
```

**126,735 micropayments, $1,588 moved, 1,082 unique account IDs.**

The 10-byte account ID selects a sub-account within the platform. The trailing 20 bytes appear to be a secondary recipient or routing reference. Amount values form a fixed vocabulary: `$0.001`, `$0.002`, `$0.003`, `$0.005`, `$0.008`, `$0.015`, `$0.025` — each value likely encodes a transaction type or reward tier rather than actual dollar value. All wallets are funded by `f70da97`.

The top account (`ef1e014ebd`) sent 15,975 payments totaling $54 — all to **one recipient address** from **244 different sender wallets**. This is many-to-one consolidation: a platform collecting micro-confirmations from its user fleet into a single aggregator.

**No MPP / 402 protocol usage.** The ef1e format is a bespoke binary encoding, not a standard protocol.

---

### 4.2 mppshafu — Payment Proof Format (closest to HTTP 402)

```
Format: 6d70707368616675 [24 random bytes]
Decoded: "mppshafu" + 192-bit cryptographic payload
```

**30 payments in 90 days, all $0 or $1 amounts.**

`mppshafu` decodes to 8 ASCII bytes. The trailing 24 bytes are cryptographically random and unique per payment — almost certainly a hash, HMAC, or compact signature over the payment details (amount, recipient, timestamp).

This format is the closest thing on Tempo to a **pay-per-request receipt**: the payer sends $1, receives a 24-byte proof, and includes that proof as a bearer token in their next request. The server validates the proof against the on-chain payment before serving the response. This is exactly the HTTP 402 Machine Payable Protocol pattern — but with only 30 usages over 90 days, it's a developer experiment, not a live product.

**If this format were to scale, it would be the most technically interesting thing on the chain.**

---

### 4.3 SOC-* — Reconciliation References

```
Format: ASCII text, e.g. "SOC-01lx254i", "SOC-00qsizre"
Encoding: "SOC-" + base36 timestamp
```

**4,252 payments / $3.58 total, 30 days.** Each memo is unique and time-sortable. A payment processor generating canonical reconciliation IDs — the base36 timestamp makes them naturally ordered without needing a central counter.

---

### 4.4 INV / TXN / PAY / ORD / REF — Invoice and B2B Payments

```
Format: ASCII, e.g. "INV-202601-8917", "TXN-202608-9392", "PAY-202607-8830"
Encoding: {type}-{YYYYMM}-{sequential ID}
```

| Type | Count (90d) | Unique Senders | Unique Recipients | Avg Amount |
|------|-------------|----------------|-------------------|------------|
| INV (invoice) | 73 | 58 | 58 | $0.267 |
| TXN (transaction) | 69 | 56 | 56 | $0.254 |
| REF (reference) | 65 | 56 | 56 | $0.252 |
| PAY (payment) | 65 | 51 | 51 | $0.268 |
| ORD (order) | 60 | 54 | 54 | $0.275 |

Nearly 1:1 sender-to-payment ratio — these are mostly one-off payments between different parties, not automation. The YYYYMM prefix encodes the billing period; the sequential ID is a canonical document reference that both parties track off-chain. Sub-dollar amounts likely serve as proofs of delivery or settlement receipts for larger off-chain invoices.

---

### 4.5 gateway_{CHAIN}_{timestamp} — Cross-Chain Bridge Receipts

```
Examples: "gateway_BASE_1774089427811"
          "gateway_ETH_1774091436243"
          "gateway_AVAX_1774091499418"
          "gateway_ARB_1774091499418"
```

A bridge operator encoding the **source chain and Unix millisecond timestamp** directly in the payment memo. When funds arrive on Tempo from Base/ETH/Avalanche/Arbitrum, the on-chain receipt contains everything needed to reconstruct full cross-chain provenance — no off-chain database required.

Chains seen: BASE, ETH, AVAX, ARB — at least 4 EVM chains actively bridging to Tempo and using this receipt format.

---

### 4.6 TMPO — Structured Binary Protocol

```
Raw: 0x0101544d504f00000000000003e8000000000000000000000000000000000000
Decoded: 01 01 "TMPO" [6 zero bytes] 03e8 [18 zero bytes]
         ^  ^   ^^^^                  ^^^^
    ver=1 type=1 TMPO-magic        value=1000 (micro-units)
```

**41 payments, always $0.50, same sender pair.** The `0x03e8` = 1000 likely encodes an amount in micro-units (1000 × 0.0005 = $0.50). The `0101` prefix suggests a versioned, typed binary format — version 1, message type 1. The sender occasionally pays itself, suggesting wallet consolidation or internal accounting.

---

### 4.7 Reputation and Compliance Assertions

```
"reputation:successful_trade:95"
"validated:kyc_verified"
```

5 payments each, $0 value. A payment where the memo is a **claim about the sender's identity or trustworthiness** — publishing a verifiable statement on-chain. The recipient validates it before proceeding with a larger transaction. A primitive on-chain reputation system: no smart contract needed, just the immutable log.

---

### 4.8 Consumer Apps and Human Payments

```
"papercut.lol"    — 13 payments, $1–3, multiple unique senders
"gm"              — 50 payments, $0.01–0.05
"TRAVEL"          — 61 payments, exactly $0.01 each, 1 sender → 1 recipient
"Sid (Palisades)" — 3 payments
"Hey bro"         — 2 payments
"107.64pathUSD"   — 1 payment (human typed the amount in the memo)
"Hello, world!"   — 2 payments
```

**`papercut.lol`** is a live consumer tipping app — multiple different senders paying $1–3 to different recipients. A working micro-tipping product.

**`TRAVEL`** — one address sends exactly $0.01 to the same recipient, 61 times. Automated travel expense micro-settlement or loyalty points redemption where each $0.01 represents one unit.

---

## 5. Sender Connectivity — It's All One Network

The micropayment senders are **not independent organic users**. They form a clear hub-and-spoke funding graph. See [Q9](#q9-sender-funding-graph).

```
f70da97812cb  ──────────────────→  13,616 wallets  →→→  ef1e micropayments
(master distributor, $3.17M)           (user fleet)        (to 1 aggregator)

1086b62bdbec  ──────→  73 wallets
(secondary, $11.6K)

33b901018174  ──────→  154 wallets  (high-freq small top-ups)
(tertiary, $4.6K, 8,840 transfers)
```

The distributor `f70da97` has never sent a `transferWithMemo` itself — it only moves raw USDC.e to pre-load user wallets. The actual memo payments happen from those wallets, using the ef1e format, accumulating into a single aggregator address.

This is a **hub-and-spoke settlement network** where:
1. Platform loads wallets with $250–$1,200 each in USDC.e
2. Those wallets make automated ef1e micropayments to a central collector
3. The amounts ($0.001–$0.025) and account IDs encode settlement data
4. The aggregator reconciles everything off-chain

The INV/TXN/PAY/ORD/REF payments are separate — those come from unconnected wallets that appear organically, suggesting a different B2B integration with human-initiated payments.

### 5.1 Sponsorship and the Agent Use Case

Tempo supports fee sponsorship (`fee_payer != from`): a relayer address pays the gas on behalf of the sender. About 13–24% of micropayments use this already. See [Q10](#q10-sponsorship-rate).

The ef1e bot fleet **does not use sponsorship** — each wallet holds its own USDC.e for gas (consistent with the 63.7% USDC.e gas preference in §2.2). This is rational for a well-funded bot fleet: pre-loading wallets avoids relay latency and complexity.

**Observational note:** However, agents and automated systems operating at scale on behalf of *users* are the ideal sponsorship use case. An AI agent executing thousands of micro-settlements doesn't want the user to hold gas in every address the agent controls. A single sponsored relayer — funded once by the platform, shared across all agent wallets — amortizes the gas management cost across every micro-settlement the agent makes. The infrastructure cost of running a relayer drops to a negligible fraction of agent payment volume at scale. This applies equally to human-facing apps (where users onboard without pre-loading gas) and to autonomous agents (which shouldn't need per-wallet gas deposits). Neither humans nor agents benefit from managing gas across hundreds of addresses; sponsorship eliminates that friction for both.

---

## 6. MPP / HTTP 402 — What's Here and What's Missing

### What "Machine Payable Protocol" means

HTTP 402 Payment Required is a long-dormant status code. The Machine Payable Protocol (MPP) revives it: a server responds `402` with a payment address and amount, the client pays, includes a proof in the next request, and the server serves the content. No subscription, no account — just atomic pay-per-request.

### Evidence on Tempo

| Format | Count | Verdict |
|--------|-------|---------|
| `mppshafu` + 24-byte proof | 30 payments (90d) | **Closest match** — compact receipt format, likely a pay-per-request proof system |
| `reputation:successful_trade:95` | 5 payments | Proto-402: pay to assert a claim before interacting |
| `validated:kyc_verified` | 5 payments | Same — payment as identity proof |
| `gateway_{CHAIN}_{ts}` | ~30 payments | Pay-to-prove-provenance, not pay-to-access |
| ef1e format | 126,735 payments | Internal settlement — no MPP characteristics |

### What's missing

A true 402/MPP flow would show:
- **Many unique senders → one API endpoint address** — not seen (ef1e is many senders → one aggregator, but bespoke)
- **Variable amounts matching resource pricing** — not seen (all ef1e amounts are from a fixed vocabulary)
- **Request-scoped proofs in memo** — `mppshafu` has this, but 30 payments in 90 days is developer testing

**Conclusion:** HTTP 402 / MPP is not here yet. The infrastructure to build it exists perfectly — `transferWithMemo` + proof in `topic3` + ~51,287 gas per call. Someone needs to build the client SDK and the first API product.

---

## 7. Key Numbers

| Metric | Value |
|--------|-------|
| Gas per `transferWithMemo` | ~51,287 gas / ~$0.00152 |
| % of payments under $0.10 | **84%** |
| % of value in sub-$0.10 payments | **0.44%** |
| Sub-cent payments where gas > payment | **41%** |
| Effective fee rate on all micropayments | **~13%** |
| Gas on $100 of $0.01 micropayments | **~$15** (10,000 txs × $0.00152) |
| Gas on $100 as a single large transfer | **~$0.0015** (1 tx) |
| Revenue efficiency: micro vs single transfer | **~10,000× at $0.01/payment** |
| Avg gas/tx: micropayments vs large payments | $0.00152 vs $0.00186 (same function) |
| Gas token: micropayment senders | **63.7% USDC.e**, 36.3% pathUSD |
| Gas token: large payment senders | 81.8% pathUSD, **18.2% USDC.e** |
| Sub-cent txs (<$0.01) | **81,679** (64% of all micropayments) |
| Sub-nickel txs ($0.01–$0.05) | **37,454** (29%) |
| Sub-dime txs ($0.05–$0.10) | **8,485** (7%) |
| Master distributor wallets funded (90d) | **13,616** |
| Master distributor USDC.e distributed | **$3.17M** |
| ef1e account IDs active (30d) | 1,082 |
| mppshafu payments (90d) | 30 |
| Active memo formats identified | 11 |
| Batch tx adoption | 0.24% |
| Sponsorship rate in micropayments | 13–24% |

---

## 8. Open Questions

**On the ef1e platform:**
1. Who operates `f70da97812cb`? With $3.17M distributed in 90 days to 13,616 wallets, this is a significant operation — likely a centralized exchange, payment processor, or Tempo's own product.
2. What do the 7 amount values ($0.001–$0.025) encode? Are they reward tiers, settlement types, confidence scores? The fixed vocabulary suggests a purpose-built signaling system.
3. Why does the ef1e system not use sponsorship? A single sponsored relayer would reduce operational complexity significantly given the scale of the wallet fleet.

**On protocol development:**
4. Is anyone building an MPP client/server on Tempo? The `mppshafu` format suggests someone has a design for it — 30 payments in 90 days is early experimentation.
5. What is the TMPO binary format spec? The `0101TMPO...03e8` structure looks like Tempo's own internal payment encoding.
6. Who built the `reputation:successful_trade:95` / `validated:kyc_verified` system? A primitive on-chain reputation system with only 10 payments but potentially the seed of something larger.

**On economics:**
7. At what gas price does sub-cent payment become economically rational for consumer use? At current ~20 gwei the gas rate exceeds payment value for 41% of sub-cent txs. At 2 gwei that problem largely disappears.
8. Could the ef1e platform switch to batch transactions and reduce per-payment gas ~20×? This would drop their effective gas cost from ~$0.00152 to ~$0.00008 per settlement signal — well below any reasonable payment value.

---


## Appendix: Reproducible Queries

All queries run against `tidx_4217` on ClickHouse. Verified working as of 2026-04-15.

The stablecoin address list (17 verified TIP-20 tokens) used in all queries:

```sql
-- Paste this IN (...) list wherever <STABLECOINS> appears below
'0x20c0000000000000000000000000000000000000',  -- pathUSD
'0x20c000000000000000000000b9537d11c60e8b50',  -- USDC.e
'0x20c0000000000000000000001621e21f71cf12fb',  -- EURC.e
'0x20c00000000000000000000014f22ca97301eb73',
'0x20c0000000000000000000003554d28269e0f3c2',
'0x20c0000000000000000000000520792dcccccccc',
'0x20c0000000000000000000008ee4fcff88888888',
'0x20c0000000000000000000005c0bac7cef389a11',
'0x20c0000000000000000000007f7ba549dd0251b9',
'0x20c000000000000000000000aeed2ec36a54d0e5',
'0x20c0000000000000000000009a4a4b17e0dc6651',
'0x20c000000000000000000000383a23bacb546ab9',
'0x20c000000000000000000000ab02d39df30bd17e',
'0x20c000000000000000000000048c8f36df1c9a4a',
'0x20c0000000000000000000002f52d5cc21a3207b',
'0x20c000000000000000000000bd95bfb69fbe6ce3',
'0x20c000000000000000000000ae247a1130450f09'

-- Selectors
-- transferWithMemo event (topic0):   0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0
-- transferWithMemo function (input): 0x95777d59
-- ERC-20 Transfer event (topic0):    0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
```

Address encoding note: `topic1`/`topic2` in logs are 32-byte ABI-padded (`0x` + 24 zero chars + 40-char address = 66 chars total). Extract the address with `lower(concat('0x', substr(topicN, 27)))`.

---

### Q1: Payment Tier Breakdown

Produces the §1 tier table. Gas cost column requires the Q3 JOIN; this query covers tx counts, value, and sender/recipient counts from logs only.

```sql
SELECT
  multiIf(
    amount_usd < 0.01,  'A: Under $0.01',
    amount_usd < 0.10,  'B: $0.01-$0.10',
    amount_usd < 1.00,  'C: $0.10-$1.00',
    amount_usd < 10.0,  'D: $1-$10',
    amount_usd < 100.0, 'E: $10-$100',
                        'F: $100+'
  ) AS tier,
  count()                   AS tx_count,
  round(sum(amount_usd), 2) AS total_usd,
  round(avg(amount_usd), 5) AS avg_usd,
  uniqExact(lower(topic1))  AS unique_senders,
  uniqExact(lower(topic2))  AS unique_recipients
FROM (
  SELECT
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6 AS amount_usd,
    topic1,
    topic2
  FROM tidx_4217.logs
  WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(address) IN (<STABLECOINS>)
    AND block_timestamp >= now() - INTERVAL 30 DAY
)
GROUP BY tier
ORDER BY tier;
```

---

### Q2: Micropayment Sub-tier Breakdown

Produces the §1.1 table.

```sql
SELECT
  multiIf(
    amount_usd < 0.01,  'A: Under $0.01',
    amount_usd < 0.05,  'B: $0.01-$0.05',
    amount_usd < 0.10,  'C: $0.05-$0.10',
                        'D: $0.10+'
  ) AS tier,
  count()                   AS tx_count,
  round(sum(amount_usd), 2) AS total_usd,
  round(avg(amount_usd), 5) AS avg_usd
FROM (
  SELECT
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6 AS amount_usd
  FROM tidx_4217.logs
  WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(address) IN (<STABLECOINS>)
    AND block_timestamp >= now() - INTERVAL 30 DAY
)
GROUP BY tier
ORDER BY tier;
```

---

### Q3: Gas Cost vs Payment Value (per tier)

Joins logs to receipts via `tx_hash`. `effective_gas_price` is in the receipts table as a hex string; stablecoin gas is denominated in pathUSD (1:1 USD), so no ETH conversion is needed.

```sql
SELECT
  multiIf(
    amount_usd < 0.01,  'A: Under $0.01',
    amount_usd < 0.10,  'B: $0.01-$0.10',
    amount_usd < 1.00,  'C: $0.10-$1.00',
                        'D: $1+'
  ) AS tier,
  round(avg(amount_usd), 5)                                   AS avg_payment,
  round(avg(gas_usd), 6)                                      AS avg_gas,
  round(avg(gas_usd) / nullIf(avg(amount_usd), 0) * 100, 1)  AS gas_pct_of_payment,
  countIf(gas_usd > amount_usd)                               AS txs_gas_gt_payment,
  count()                                                     AS total_txs
FROM (
  SELECT
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6          AS amount_usd,
    toFloat64(receipts.gas_used) * toFloat64OrZero(receipts.effective_gas_price) / 1e18 AS gas_usd
  FROM tidx_4217.logs
  INNER JOIN tidx_4217.receipts ON receipts.tx_hash = logs.tx_hash
  WHERE logs.selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(logs.address) IN (<STABLECOINS>)
    AND receipts.status = 1
    AND logs.block_timestamp >= now() - INTERVAL 30 DAY
)
GROUP BY tier
ORDER BY tier;
```

---

### Q4: Gas Revenue Efficiency by Tier

Produces the §2.1 "gas per $1 of value" table. Exact figures via full logs → receipts JOIN.

```sql
SELECT
  multiIf(
    amount_usd < 0.01,  'A: Under $0.01',
    amount_usd < 0.10,  'B: $0.01-$0.10',
    amount_usd < 1.00,  'C: $0.10-$1.00',
    amount_usd < 10.0,  'D: $1-$10',
    amount_usd < 100.0, 'E: $10-$100',
                        'F: $100+'
  ) AS tier,
  round(sum(amount_usd), 2)                             AS total_value,
  round(sum(gas_usd), 4)                                AS total_gas,
  round(sum(gas_usd) / nullIf(sum(amount_usd), 0), 6)  AS gas_per_dollar_of_value
FROM (
  SELECT
    toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6          AS amount_usd,
    toFloat64(receipts.gas_used) * toFloat64OrZero(receipts.effective_gas_price) / 1e18 AS gas_usd
  FROM tidx_4217.logs
  INNER JOIN tidx_4217.receipts ON receipts.tx_hash = logs.tx_hash
  WHERE logs.selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
    AND lower(logs.address) IN (<STABLECOINS>)
    AND receipts.status = 1
    AND logs.block_timestamp >= now() - INTERVAL 30 DAY
)
GROUP BY tier
ORDER BY tier;
```

---

### Q5: Gas by Payment Category

Compares micropayments vs large payments using the `txs` table. Amount is ABI-encoded in `input` at offset 75 (bytes 37–68 of the calldata = param 2).

```sql
SELECT
  category,
  count()                 AS tx_count,
  round(sum(gas_usd), 4)  AS total_gas_usd,
  round(avg(gas_usd), 6)  AS avg_gas_usd
FROM (
  SELECT
    toFloat64(receipts.gas_used) * toFloat64OrZero(receipts.effective_gas_price) / 1e18 AS gas_usd,
    multiIf(
      toFloat64(reinterpretAsUInt256(reverse(unhex(substr(lower(txs.input), 75, 64))))) / 1e6 < 0.10,
      'micropayment_lt_0.10',
      'payment_gte_0.10'
    ) AS category
  FROM tidx_4217.txs
  INNER JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
  WHERE startsWith(lower(txs.input), '0x95777d59')
    AND lower(txs.to) IN (<STABLECOINS>)
    AND receipts.status = 1
    AND txs.block_timestamp >= now() - INTERVAL 30 DAY
)
GROUP BY category
ORDER BY category;
```

---

### Q6: Gas Token Preference

`fee_token` is stored on `tidx_4217.txs`. NULL fee_token means pathUSD (the default).

```sql
SELECT
  payment_type,
  multiIf(
    lower(fee_token) = '0x20c0000000000000000000000000000000000000', 'pathUSD',
    lower(fee_token) = '0x20c000000000000000000000b9537d11c60e8b50', 'USDC.e',
    lower(fee_token) = '0x20c0000000000000000000001621e21f71cf12fb', 'EURC.e',
    coalesce(lower(fee_token), 'pathUSD')
  ) AS fee_token_name,
  count()                                                                   AS tx_count,
  round(count() / sum(count()) OVER (PARTITION BY payment_type) * 100, 1)  AS pct
FROM (
  SELECT
    fee_token,
    multiIf(
      toFloat64(reinterpretAsUInt256(reverse(unhex(substr(lower(input), 75, 64))))) / 1e6 < 0.10,
      'micropayment',
      'large_payment'
    ) AS payment_type
  FROM tidx_4217.txs
  WHERE startsWith(lower(input), '0x95777d59')
    AND lower(to) IN (<STABLECOINS>)
    AND block_timestamp >= now() - INTERVAL 30 DAY
)
GROUP BY payment_type, fee_token_name
ORDER BY payment_type, tx_count DESC;
```

---

### Q7: Master Distributor Analysis

Finds top ERC-20 Transfer senders (funders) into the ef1e micropayment sender wallets. Topics are 32-byte ABI-padded; `substr(topicN, 27)` extracts the 20-byte address portion.

```sql
SELECT
  lower(concat('0x', substr(topic1, 27))) AS distributor,
  uniqExact(lower(concat('0x', substr(topic2, 27)))) AS wallets_funded,
  round(sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6), 2) AS total_usd,
  count() AS transfer_count
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND lower(address) = '0x20c000000000000000000000b9537d11c60e8b50'  -- USDC.e
  AND block_timestamp >= now() - INTERVAL 90 DAY
  AND lower(concat('0x', substr(topic2, 27))) IN (
    -- ef1e micropayment senders active in last 30 days
    SELECT DISTINCT lower(concat('0x', substr(topic1, 27)))
    FROM tidx_4217.logs
    WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
      AND lower(address) IN (<STABLECOINS>)
      AND startsWith(lower(coalesce(topic3, '')), '0xef1ed712')
      AND block_timestamp >= now() - INTERVAL 30 DAY
  )
GROUP BY distributor
ORDER BY wallets_funded DESC
LIMIT 10;
```

---

### Q8: Memo Format Taxonomy

Classifies all `transferWithMemo` events by memo format. `topic3` is the 32-byte memo field; NULL topic3 is treated as empty via `coalesce`.

```sql
SELECT
  multiIf(
    topic3 = '0x0000000000000000000000000000000000000000000000000000000000000000',
      'empty',
    startsWith(lower(coalesce(topic3, '')), '0xef1ed712'),
      'ef1e (account settlement)',
    startsWith(lower(coalesce(topic3, '')), '0x6d70707368616675'),
      'mppshafu (payment proof)',
    startsWith(lower(coalesce(topic3, '')), '0x534f432d'),
      'SOC-* (reconciliation)',
    startsWith(lower(coalesce(topic3, '')), '0x494e562d'),
      'INV-* (invoice)',
    startsWith(lower(coalesce(topic3, '')), '0x54584e2d'),
      'TXN-* (transaction ref)',
    startsWith(lower(coalesce(topic3, '')), '0x5041592d'),
      'PAY-* (payment ref)',
    startsWith(lower(coalesce(topic3, '')), '0x4f52442d'),
      'ORD-* (order ref)',
    startsWith(lower(coalesce(topic3, '')), '0x5245462d'),
      'REF-* (reference)',
    startsWith(lower(coalesce(topic3, '')), '0x67617465776179'),
      'gateway_{CHAIN}_{ts}',
    startsWith(lower(coalesce(topic3, '')), '0x0101544d504f'),
      'TMPO binary protocol',
    match(substr(lower(coalesce(topic3, '')), 3), '^(00|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9a-e]){32}$'),
      'printable ASCII (human text)',
    'opaque binary (other)'
  ) AS memo_format,
  count()                                                                                    AS tx_count,
  round(count() * 100.0 / sum(count()) OVER (), 2)                                          AS pct,
  round(sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6), 2) AS total_usd
FROM tidx_4217.logs
WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
  AND lower(address) IN (<STABLECOINS>)
  AND block_timestamp >= now() - INTERVAL 30 DAY
GROUP BY memo_format
ORDER BY tx_count DESC;
```

---

### Q9: Sender Funding Graph

Identifies which addresses funded the ef1e micropayment sender wallets across all stablecoins (not just USDC.e).

```sql
SELECT
  lower(concat('0x', substr(topic1, 27))) AS funder,
  uniqExact(lower(concat('0x', substr(topic2, 27)))) AS ef1e_wallets_funded,
  round(sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substr(data, 3, 64))))) / 1e6), 2) AS total_usd_sent
FROM tidx_4217.logs
WHERE selector = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND lower(address) IN (<STABLECOINS>)
  AND block_timestamp >= now() - INTERVAL 90 DAY
  AND lower(concat('0x', substr(topic2, 27))) IN (
    SELECT DISTINCT lower(concat('0x', substr(topic1, 27)))
    FROM tidx_4217.logs
    WHERE selector = '0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0'
      AND lower(address) IN (<STABLECOINS>)
      AND startsWith(lower(coalesce(topic3, '')), '0xef1ed712')
      AND block_timestamp >= now() - INTERVAL 30 DAY
  )
GROUP BY funder
ORDER BY ef1e_wallets_funded DESC
LIMIT 10;
```

---

### Q10: Sponsorship Rate

Measures what fraction of `transferWithMemo` transactions have a gas sponsor (`fee_payer != from`).

```sql
SELECT
  countIf(lower(fee_payer) != lower(txs.from) AND fee_payer IS NOT NULL) AS sponsored,
  count()                                                                  AS total,
  round(sponsored * 100.0 / total, 1)                                     AS sponsored_pct
FROM tidx_4217.txs
INNER JOIN tidx_4217.receipts ON receipts.tx_hash = txs.hash
WHERE startsWith(lower(txs.input), '0x95777d59')
  AND lower(txs.to) IN (<STABLECOINS>)
  AND receipts.status = 1
  AND txs.block_timestamp >= now() - INTERVAL 30 DAY;
```

---

*Analysis by Evan Kim / Takopi, April 2026.*
