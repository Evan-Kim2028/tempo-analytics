# Bridge Flow Analytics Design

## Goal

Add a provider-first analytics layer for verified bridge activity on Tempo. The first version focuses on verified providers only, with provider-level daily metrics and asset rollups under each provider.

The initial verified providers are:

- Stargate
- USDT0
- Frax

The analytics should answer:

- How much value flowed onto Tempo by provider each day?
- How much value flowed off Tempo by provider each day?
- Which assets drove those flows?
- How many user transactions and unique users were involved?

## Non-Goals

- Heuristic discovery of all bridge-like contracts on Tempo
- Full crosschain attribution on external source chains
- Publishing ambiguous flows in headline metrics
- Shipping a transaction explorer in the first release

## Scope Decisions

- Verified providers only
- Provider-first analytics, with asset rollups
- Headline metrics use strict user flows only
- Secondary diagnostics include all bridge-touched flows
- Daily aggregates ship first
- Ambiguous rows are retained for review, but excluded from headline metrics

## Core Approach

Use a curated provider-rule engine.

Each verified provider gets:

- A manually maintained registry of verified Tempo contracts
- Contract roles for those addresses
- Provider-specific event and transfer classification rules
- Validation rules and known-good sample transactions

ClickHouse logs and token transfer activity provide the primary analytics input. TIDX/Postgres transaction metadata and receipts enrich those rows and help validate user attribution. RPC calls act as a secondary verification layer, not the primary analytics source.

## Architecture

The system is split into four layers:

1. Provider registry
2. Contract registry
3. Classified bridge flow facts
4. Daily rollups and diagnostics

The pipeline scans Tempo-side activity only. It does not attempt to prove the source-chain side of a bridge transfer. Instead, it classifies Tempo-side inflow and outflow using verified contract maps and provider-specific rules.

## Data Model

### `bridge_providers`

One row per verified provider.

Suggested fields:

- `provider`
- `display_name`
- `status`
- `notes`

### `bridge_contracts`

One row per verified Tempo contract that belongs to a provider.

Suggested fields:

- `provider`
- `contract_address`
- `role`
- `asset_symbol`
- `confidence`
- `notes`

Example roles:

- `router`
- `pool`
- `vault`
- `escrow`
- `token`
- `adapter`
- `endpoint`
- `messenger`

### `bridge_flow_facts`

One normalized row per classified Tempo-side bridge flow unit.

Suggested fields:

- `block_timestamp`
- `day`
- `tx_hash`
- `provider`
- `asset`
- `user_address`
- `flow_direction`
- `amount_raw`
- `amount_normalized`
- `classification`
- `confidence`
- `classification_reason`

Expected values:

- `flow_direction`: `inflow`, `outflow`
- `classification`: `strict_user_flow`, `internal_rebalance`, `unknown`

### `bridge_daily_rollups`

Aggregated rows for headline metrics and secondary diagnostics.

Suggested fields:

- `day`
- `provider`
- `asset`
- `gross_inflow`
- `gross_outflow`
- `net_flow`
- `tx_count`
- `unique_users`
- `internal_rebalance_volume`
- `unknown_volume`
- `validation_failed`

## Classification Model

### Headline Flows

Headline analytics are based only on rows classified as `strict_user_flow`.

These rows represent:

- User deposit or receipt patterns that indicate value entering Tempo
- User withdraw or burn patterns that indicate value leaving Tempo

### Diagnostic Flows

Diagnostic analytics include:

- `internal_rebalance`
- `unknown`

These rows are kept for auditability and coverage analysis, but are not included in headline inflow and outflow totals.

## Provider Strategy

### Stargate

Track verified Stargate Tempo contracts and classify user flows using:

- Provider contract touches
- Stablecoin transfer patterns
- Provider-specific events where available

The expected assets for the first pass are `USDC.e` and `EURC.e`.

### USDT0

Track verified USDT0 Tempo contracts and classify flows using:

- Verified token and adapter contracts
- Mint and burn patterns where applicable
- Provider-specific transfer and event patterns

The initial asset is `USDT0`.

### Frax

Track verified Frax Tempo contracts and classify flows using:

- Verified token and bridge adapter contracts
- Mint and burn patterns where applicable
- Provider-specific transfer and event patterns

The initial asset is `frxUSD`.

## Verification Layer

Add a separate verification layer so published metrics can be audited.

### Rule-Level Validation

For each provider:

- Maintain a small fixture set of known transaction hashes
- Label each known tx as `inflow`, `outflow`, `internal_rebalance`, or `unknown`
- Run those fixtures in automated tests against the classifier

This protects against silent rule regressions.

### Runtime Data Validation

Use RPC as a secondary auditor for recent or sampled rows.

Validation examples:

- Verify token metadata and decimals directly from contracts
- Verify bridge contract roles when callable
- Compare indexed receipts and logs against `eth_getTransactionReceipt` for sampled transactions
- Reconcile classified flow totals against token supply deltas when that is meaningful for a provider and asset

### Validation Policy

- ClickHouse and TIDX remain the analytics source of truth
- RPC acts as the verification source
- If validation fails above a configured threshold, mark the provider or provider-day as `validation_failed`
- Invalidated rows remain queryable, but should not be used for trusted headline metrics

## Outputs

### `daily_provider_flows`

One row per `day + provider`.

Fields:

- `gross_inflow`
- `gross_outflow`
- `net_flow`
- `tx_count`
- `unique_users`

### `daily_provider_asset_flows`

One row per `day + provider + asset`.

Fields:

- `gross_inflow`
- `gross_outflow`
- `net_flow`
- `tx_count`
- `unique_users`

### `provider_diagnostics`

One row per `day + provider`, with audit and coverage metrics.

Fields:

- `internal_rebalance_volume`
- `unknown_volume`
- `validation_failed`
- `coverage_notes`

## Failure Handling

- If a provider contract map is incomplete, exclude that provider from headline metrics
- If a row is ambiguous, retain it as `unknown` and exclude it from headline metrics
- If validation fails for a provider-day, mark that provider-day invalid rather than publishing a misleading number
- If RPC verification is unavailable, keep analytics generation separate from verification state so the pipeline degrades visibly, not silently

## Testing Strategy

Required tests:

- Provider-specific classification fixtures
- Daily aggregation correctness
- Validation threshold behavior
- Known real transaction regressions
- Registry completeness checks for each supported provider

## Rollout Strategy

Phase 1:

- Stargate
- USDT0
- Frax
- Daily provider aggregates
- Daily provider asset rollups
- Diagnostic unknown and internal buckets
- RPC-backed validation flags

Phase 2:

- Transaction-level explorer
- Additional verified providers
- Expanded validation and coverage tooling

## Open Assumptions Locked In For V1

- Only Tempo-side activity is measured
- Verified providers only
- Provider-first metrics are the primary product surface
- Asset rollups are secondary views
- Daily aggregates are sufficient for the first release
- Ambiguous rows are retained, but excluded from headline totals
