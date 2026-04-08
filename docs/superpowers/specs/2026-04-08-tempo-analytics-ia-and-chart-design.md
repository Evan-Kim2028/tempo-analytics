# Tempo Analytics IA And Chart Design

Date: 2026-04-08

## Summary

Reposition the product as an analytics-first Tempo data experience rather than a generic block explorer with analytics attached.

The landing experience should be the `Analytics` tab. Raw explorer surfaces such as block, transaction, and address pages remain available, but they are utility workflows reached through search and direct drilldown rather than primary navigation.

The first chart set should focus on signals that are already strong in the indexed chain data:

- Tempo transaction adoption
- Tempo feature adoption
- fee-token behavior
- sponsor concentration
- WebAuthn/passkey usage as a secondary signal

## Goals

- Make the product tell a coherent Tempo-specific story from the first page load
- Organize tabs around interpreted analytics domains rather than raw chain primitives
- Prioritize charts that have strong, validated signal in the current Postgres and ClickHouse datasets
- Keep utility explorer flows available without letting them dominate the product structure

## Non-Goals

- Turning the product into a full general-purpose explorer
- Promoting weak or semantically unclear metrics into headline charts
- Building charts around data that is present but too sparse to be informative

## Product Positioning

The product should say:

> This is a Tempo analytics product with explorer utilities attached.

It should not say:

> This is a block explorer with some analytics pages.

That positioning change should drive the navigation, landing page, and chart ordering.

## Navigation

### Top-Level Tabs

- `Analytics`
- `Stablecoins`
- `DEX`
- `NFTs`

### Utility Surfaces

- global search in the header
- direct routes for block, transaction, and address drilldown
- optional lightweight `Explorer` affordance in the header if needed later

### Navigation Rationale

Top-level tabs should be interpreted, domain-oriented analytics surfaces.

Raw chain inspection pages are still important, but they are support tools. Users should reach them when investigating a pattern discovered in analytics, not as the default entrypoint.

## Analytics As The Landing Experience

`Analytics` becomes the default landing page and the narrative home for Tempo-specific behavior.

The page should tell one story in order:

1. Is TempoTransaction materially used on chain?
2. Which Tempo-specific features are actually exercised?
3. How does the fee economy behave?
4. Who sponsors usage, and how concentrated is that activity?
5. Are passkey/WebAuthn accounts visible in real usage?

## Analytics Page Structure

### Section 1: Tempo Transaction Adoption

Purpose:
Establish that TempoTransaction is a meaningful on-chain behavior and quantify its share of activity.

Charts:

- `Tempo Tx Share Over Time`
- `Tempo Feature Adoption Over Time`

### Section 2: Fee Economy

Purpose:
Explain how Tempo’s fee model is actually used and how much of subsidized usage is concentrated in a few actors.

Charts:

- `Fee Token Mix Over Time`
- `Sponsor Concentration Over Time`
- `Top Sponsors`

### Section 3: Account Behavior

Purpose:
Show whether Tempo’s account model appears in real user activity.

Charts:

- `WebAuthn/Passkey Usage Over Time`

Deferred candidates:

- active Tempo accounts
- new vs returning Tempo accounts
- Tempo txs per active account

### Section 4: Ecosystem Detail

Purpose:
Provide deeper domain analysis after the user understands the transaction model.

Tabs:

- `Stablecoins`
- `DEX`
- `NFTs`

These remain separate top-level tabs rather than being folded into `Analytics`.

## Chart Order For V1

The recommended chart order on the `Analytics` page is:

1. `Tempo Tx Share Over Time`
2. `Tempo Feature Adoption Over Time`
3. `Fee Token Mix Over Time`
4. `Sponsor Concentration Over Time`
5. `Top Sponsors`
6. `WebAuthn/Passkey Usage Over Time`

This sequence moves from adoption, to feature usage, to fee behavior, to actor concentration, to account behavior.

## Metric Definitions

### 1. Tempo Tx Share Over Time

Source:
ClickHouse `tidx_4217.txs`

Grain:
daily

Definition:

- numerator: `countIf(type = 118)`
- denominator: `count()`
- metric: `tempo_pct = 100 * numerator / denominator`

Output:

- `day`
- `tempo_txs`
- `total_txs`
- `tempo_pct`

Notes:

- exclude or visually mark partial current day
- map `type = 118` to `Tempo tx`

### 2. Tempo Feature Adoption Over Time

Source:
ClickHouse `tidx_4217.txs`

Population:
`type = 118`

Grain:
daily

Daily denominator:
`total_tempo = countIf(type = 118)`

Series:

- `sponsored_pct = 100 * countIf(type = 118 and fee_payer != "from") / total_tempo`
- `batched_pct = 100 * countIf(type = 118 and call_count > 1) / total_tempo`
- `time_bounded_pct = 100 * countIf(type = 118 and (valid_before is not null or valid_after is not null)) / total_tempo`
- `fee_token_pct = 100 * countIf(type = 118 and fee_token is not null) / total_tempo`

Output:

- `day`
- `total_tempo`
- feature counts
- feature percentages

Notes:

- shared denominator keeps comparison consistent
- this is the clearest “what makes Tempo txs different?” chart family

### 3. Fee Token Mix Over Time

Source:
Postgres or ClickHouse `txs`

Population:
`type = 118 and fee_token is not null`

Grain:
daily

Definition:
group daily counts by `fee_token` and compute share within the fee-token-bearing Tempo subset

Output:

- `day`
- `fee_token`
- `txs`
- `pct_of_fee_token_set_txs`

Notes:

- denominator should be Tempo txs with `fee_token` set, not all Tempo txs
- pair this with the `fee_token_pct` series from chart 2
- map known token addresses to friendly labels

### 4. Sponsor Concentration Over Time

Source:
Postgres `txs`

Population:
`type = 118 and fee_payer != "from"`

Grain:
daily

Method:

1. count sponsored txs per `day, fee_payer`
2. rank sponsors within each day by tx count
3. compute:
   - `top1_pct`
   - `top5_pct`
   - optional `sponsor_count`

Output:

- `day`
- `sponsored_txs`
- `top1_pct`
- `top5_pct`
- `sponsor_count`

Notes:

- hide or gray out low-volume days where concentration is too noisy
- a threshold like `sponsored_txs < 100` is acceptable for v1

### 5. Top Sponsors

Source:
Postgres `txs`

Population:
`type = 118 and fee_payer != "from"`

Definition:
group by `fee_payer`

Output:

- `sponsor`
- `sponsored_txs`
- `unique_users_sponsored`
- `first_seen`
- `last_seen`

Notes:

- use this as a supporting chart or table, not as a replacement for concentration analysis

### 6. WebAuthn/Passkey Usage Over Time

Source:
Postgres or ClickHouse `txs`

Population:
`type = 118 and signature_type = 2`

Grain:
daily

Definition:
daily count or share of WebAuthn/passkey Tempo txs

Output:

- `day`
- `webauthn_txs`
- optional `webauthn_pct_of_tempo`

Notes:

- label as `WebAuthn/passkey`
- do not label as `biometric`
- treat as a secondary chart, not a hero chart

## Evidence From Current Data

The current indexed data shows strong enough signal to justify the proposed top charts.

Validated observations from the live local stack:

- Tempo txs are materially present in the dataset and persist in recent activity
- feature adoption has real shape over time
- fee-token choice is strongly concentrated in USDC.e and pathUSD
- sponsor activity is highly concentrated and analytically interesting
- WebAuthn/passkey usage exists, but is much smaller than secp256k1 usage

Validated summary rates from the last 30 days:

- batched: `1.89%`
- sponsored: `4.42%`
- time-bounded: `81.62%`
- explicit `fee_token`: `27.23%`
- WebAuthn/passkey among Tempo txs: about `1.11%`

## Deferred Or Excluded Charts

### Exclude From V1

- standalone `P256` chart
- batch size as a hero chart
- fee spend by token

### Rationale

- `P256` is too sparse to justify a dedicated chart
- batching exists but is not yet a dominant behavior
- fee spend by token needs semantic validation of indexed fee-price units before it can be promoted safely

## Design Principles

- analytics first, explorer second
- one coherent story on the landing page
- strongest signal first
- count-based metrics before semantically uncertain value metrics
- interpreted domains in top-level navigation
- raw chain inspection as utility support

## Recommendation

Proceed with an analytics-first IA where `Analytics` is the landing page, blocks are demoted into utility flows, and the first implementation focuses on the top four evidence-backed charts:

1. `Tempo Tx Share Over Time`
2. `Tempo Feature Adoption Over Time`
3. `Fee Token Mix Over Time`
4. `Sponsor Concentration Over Time`

Add `Top Sponsors` and `WebAuthn/Passkey Usage Over Time` as supporting charts in the same `Analytics` narrative once the primary layout is in place.
