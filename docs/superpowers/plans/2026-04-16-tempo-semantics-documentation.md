# Tempo Semantics Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve documentation of Tempo-specific analytics semantics without changing runtime behavior, frontend rendering, chart behavior, SQL predicates, or data outputs.

**Architecture:** This is a documentation-only change. Add one repo-level semantics guide, improve existing docs/index references, and add comments or SQL header notes only where they explain existing behavior. Do not introduce new TypeScript modules, imports, constants, query rewrites, UI changes, chart changes, materialized-view logic changes, or runtime behavior changes.

**Tech Stack:** Markdown docs, TypeScript comments, ClickHouse SQL comments, Tempo protocol documentation references.

---

## Non-Invasive Scope Contract

This plan must stay non-invasive.

Allowed:

- Create or edit Markdown documentation.
- Add comments to existing TypeScript files.
- Add SQL comments or `@notes` header lines to existing SQL assets.
- Add a README/doc index link if appropriate.
- Run static searches to verify documentation coverage.

Not allowed:

- Do not touch frontend components.
- Do not touch chart components.
- Do not change rendered copy, chart labels, data keys, colors, or layout.
- Do not add a new runtime helper module.
- Do not replace magic numbers with constants in executable code.
- Do not change SQL predicates.
- Do not change ClickHouse table/view definitions except comments/header metadata.
- Do not run live ClickHouse apply/rebuild commands.
- Do not change tests unless a documentation-only test exists and already covers docs.

The goal is a clean GitHub-origin-main documentation PR, not a behavior change.

## Context

The repo currently encodes Tempo-specific semantics in analytics queries, export queries, UI labels, and ClickHouse assets. This plan only documents the existing semantics.

Important examples:

- `type = 118` means Tempo EIP-2718 transaction type `0x76`.
- `signature_type = 0/1/2` maps to Secp256k1, P256, and WebAuthn/passkey signatures.
- `fee_payer != from` is used to classify sponsored transactions.
- `call_count > 1` is used by analytics for batched transactions.
- Some UI paths may use `call_count > 0`; this plan documents the ambiguity but does not change it.
- `valid_before` and `valid_after` are used to classify time-bounded transactions.
- `fee_token IS NOT NULL` is used to classify explicit fee-token usage.
- Memo families and inscription detection include observed/local heuristics.

External sources to cite:

- Tempo transaction spec: `https://docs.tempo.xyz/protocol/transactions/spec-tempo-transaction`
- Tempo transactions overview: `https://docs.tempo.xyz/protocol/transactions`
- Tempo AccountKeychain docs: `https://docs.tempo.xyz/protocol/transactions/AccountKeychain`
- Tempo fee spec: `https://docs.tempo.xyz/protocol/fees/spec-fee`
- Tempo Rust transaction primitive docs: `https://rustdocs.tempo.xyz/tempo_primitives/transaction/tempo_transaction/index.html`
- Tempo token list: `https://tokenlist.tempo.xyz/list/4217`

## File Structure

- Create `docs/tempo-semantics.md`
  - Main human-readable reference for Tempo protocol-backed semantics and local explorer heuristics.

- Modify `docs/data-assets.md`
  - Optional generated-doc-adjacent reference only if there is a safe existing place for a link. Do not edit generated table rows by hand.

- Modify `README.md`
  - Optional one-line link to `docs/tempo-semantics.md` if README has a suitable docs section.

- Modify `src/lib/tempoAnalytics.ts`
  - Comments only. Explain existing raw SQL predicates. Do not change SQL strings.

- Modify `src/lib/dataService.ts`
  - Comments only. Explain existing exported query semantics. Do not change query descriptions or SQL.

- Modify `sql/clickhouse/views/chain/mv_daily_stats.sql`
  - SQL header comments only. Do not change DDL or SELECT logic.

- Modify `sql/clickhouse/backfills/chain/mv_daily_stats.sql`
  - SQL header comments only. Do not change INSERT logic.

---

## Task 1: Verify Sources And Write Semantics Notes

**Files:**
- Create: `docs/tempo-semantics.md`

- [ ] **Step 1: Verify external source URLs**

Open these URLs and confirm they are reachable:

```text
https://docs.tempo.xyz/protocol/transactions/spec-tempo-transaction
https://docs.tempo.xyz/protocol/transactions
https://docs.tempo.xyz/protocol/transactions/AccountKeychain
https://docs.tempo.xyz/protocol/fees/spec-fee
https://rustdocs.tempo.xyz/tempo_primitives/transaction/tempo_transaction/index.html
https://tokenlist.tempo.xyz/list/4217
```

Expected: enough documentation is available to support the statements in `docs/tempo-semantics.md`.

- [ ] **Step 2: Create `docs/tempo-semantics.md`**

Create this exact structure, adding only source-backed clarifications discovered in Step 1:

```markdown
# Tempo Semantics

This document records Tempo-specific protocol fields and local analytics heuristics used by this explorer. It is intended to explain existing analytics behavior; it does not define new product behavior.

## Protocol-Backed Values

### Tempo Transaction Type

Tempo transactions use EIP-2718 transaction type `0x76`. TIDX/ClickHouse expose this as decimal `118`, so analytics queries classify Tempo transaction envelopes with `type = 118`.

Sources:
- https://docs.tempo.xyz/protocol/transactions/spec-tempo-transaction
- https://rustdocs.tempo.xyz/tempo_primitives/transaction/tempo_transaction/index.html

### Signature Types

The explorer treats Tempo signature types as:

| Value | Label |
| --- | --- |
| `0` | Secp256k1 / standard EVM |
| `1` | P256 |
| `2` | WebAuthn / passkey |

Source:
- https://docs.tempo.xyz/protocol/transactions/AccountKeychain

### Fee Sponsorship

The explorer treats a transaction as sponsored when `fee_payer` is populated and differs from `from`. This means another account paid gas for the sender.

Source:
- https://docs.tempo.xyz/protocol/fees/spec-fee

### Fee Token

`fee_token` is the indexed token used to pay gas when explicitly populated. Analytics that group by fee token generally exclude null values unless otherwise stated.

Sources:
- https://docs.tempo.xyz/protocol/fees/spec-fee
- https://tokenlist.tempo.xyz/list/4217

### Validity Windows

`valid_before` and `valid_after` represent Tempo transaction validity bounds. The analytics page counts a transaction as time-bounded when both fields are present.

Source:
- https://docs.tempo.xyz/protocol/transactions/spec-tempo-transaction

## Explorer Analytics Definitions

### Tempo Tx Share Over Time

Tempo transactions are rows where `type = 118`. Total transactions are all indexed transactions in the same time bucket.

### Tempo Wallet Adoption

Feature adoption is measured across Tempo transaction envelopes.

| Metric | Current Predicate |
| --- | --- |
| Sponsored | `type = 118 AND fee_payer IS NOT NULL AND fee_payer != from` |
| Batched | `type = 118 AND call_count > 1` |
| Time bounded | `type = 118 AND valid_before IS NOT NULL AND valid_after IS NOT NULL` |
| Fee token set | `type = 118 AND fee_token IS NOT NULL` |

### WebAuthn/Passkey Usage

WebAuthn/passkey transactions are Tempo transactions where `signature_type = 2`.

## Local Heuristics

### Batch Detection Ambiguity

Most analytics use `call_count > 1` to represent multi-call Tempo envelopes. Some display paths may use `call_count > 0`; that should be treated as a display convention unless separately reconciled.

### Inscriptions

`inscription_txs` is an explorer heuristic for transactions whose input begins with `0x7b`, the ASCII byte for `{`. This identifies JSON-looking calldata and is not a Tempo protocol category.

### Memo Families

Payment memo families such as `ef1e:*`, `mpps:*`, `SOC-*`, `daily-*`, and `Full*` are observed application patterns in memo-bearing stablecoin transfers. They are not Tempo protocol categories unless separately documented by the application owner.
```

- [ ] **Step 3: Static markdown check**

Run:

```bash
rg -n "TBD|TODO|fill in|implement later" docs/tempo-semantics.md
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/tempo-semantics.md
git commit -m "docs: add Tempo semantics reference"
```

---

## Task 2: Add Non-Runtime Comments To Tempo Analytics

**Files:**
- Modify: `src/lib/tempoAnalytics.ts`

- [ ] **Step 1: Add a comment above `getTempoTxShareByDay`**

Add this comment only. Do not change the query.

```ts
// Tempo tx share uses the protocol transaction type exposed by TIDX/ClickHouse:
// decimal 118 is Tempo EIP-2718 type 0x76. See docs/tempo-semantics.md.
```

- [ ] **Step 2: Add a comment above `getTempoFeatureAdoptionByDay`**

Add this comment only. Do not change the query.

```ts
// Feature adoption predicates are documented in docs/tempo-semantics.md.
// These are analytics definitions over existing indexed fields, not new protocol rules.
```

- [ ] **Step 3: Add a comment above `getWebauthnUsageByDay`**

Add this comment only. Do not change the query.

```ts
// WebAuthn/passkey usage is currently represented as Tempo txs with signature_type = 2.
// See docs/tempo-semantics.md for the signature type mapping.
```

- [ ] **Step 4: Static non-invasive check**

Run:

```bash
git diff -- src/lib/tempoAnalytics.ts
```

Expected: diff contains comments only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tempoAnalytics.ts
git commit -m "docs: explain Tempo analytics predicates"
```

---

## Task 3: Add Non-Runtime Comments To Data Export Catalog

**Files:**
- Modify: `src/lib/dataService.ts`

- [ ] **Step 1: Add a comment above `QUERY_CATALOG`**

Add this comment only. Do not change query descriptions or SQL.

```ts
// Exported query semantics that rely on Tempo-specific indexed fields are
// documented in docs/tempo-semantics.md. Keep these SQL strings behavior-stable
// unless a separate product/data migration explicitly changes the exported data.
```

- [ ] **Step 2: Static non-invasive check**

Run:

```bash
git diff -- src/lib/dataService.ts
```

Expected: diff contains comments only.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dataService.ts
git commit -m "docs: reference Tempo export semantics"
```

---

## Task 4: Add SQL Header Notes Without Changing SQL Logic

**Files:**
- Modify: `sql/clickhouse/views/chain/mv_daily_stats.sql`
- Modify: `sql/clickhouse/backfills/chain/mv_daily_stats.sql`

- [ ] **Step 1: Add `@notes` to the view header**

Add these comment lines after the existing header fields and before the terminating `--` line:

```sql
-- @notes:        batch_txs currently uses call_count > 1 to represent multi-call Tempo envelopes.
-- @notes:        sponsored_txs currently uses fee_payer != from as the explorer sponsorship predicate.
-- @notes:        user_txs/protocol_txs/inscription_txs are explorer heuristics, not Tempo protocol categories.
-- @notes:        inscription_txs identifies calldata starting with 0x7b (ASCII "{").
```

Do not change the SQL body.

- [ ] **Step 2: Add matching `@notes` to the backfill header**

Add these comment lines after the existing header fields and before the terminating `--` line:

```sql
-- @notes:        Keep predicates aligned with sql/clickhouse/views/chain/mv_daily_stats.sql.
-- @notes:        This backfill preserves existing explorer heuristics and does not define protocol categories.
```

Do not change the SQL body.

- [ ] **Step 3: Static non-invasive check**

Run:

```bash
git diff -- sql/clickhouse/views/chain/mv_daily_stats.sql sql/clickhouse/backfills/chain/mv_daily_stats.sql
```

Expected: diff contains comments only.

- [ ] **Step 4: Commit**

```bash
git add sql/clickhouse/views/chain/mv_daily_stats.sql sql/clickhouse/backfills/chain/mv_daily_stats.sql
git commit -m "docs: annotate daily stats heuristics"
```

---

## Task 5: Add Documentation Index Link

**Files:**
- Modify: `README.md`
- Optional Modify: `docs/data-assets.md`

- [ ] **Step 1: Add README link if there is a suitable docs section**

Add one sentence only:

```markdown
For Tempo-specific field and analytics definitions, see `docs/tempo-semantics.md`.
```

If README has no suitable documentation section, do not force a new section. Record that in the task summary.

- [ ] **Step 2: Avoid editing generated docs tables**

Do not edit the generated table inside `docs/data-assets.md`. Only add a link above the generated block if there is an obvious prose section where it belongs.

- [ ] **Step 3: Static non-invasive check**

Run:

```bash
git diff -- README.md docs/data-assets.md
```

Expected: diff contains prose documentation only.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/data-assets.md
git commit -m "docs: link Tempo semantics reference"
```

If only one file changed, add only that file.

---

## Task 6: Final Documentation-Only Review

**Files:**
- Review only unless comments/docs are missing.

- [ ] **Step 1: Confirm no frontend/chart files changed**

Run:

```bash
git diff --name-only origin/main...HEAD | rg "src/components|src/app|charts"
```

Expected: no matches, except if a documentation-only file path unexpectedly matches. Any match must be reviewed and explained before continuing.

- [ ] **Step 2: Confirm no executable SQL logic changed**

Run:

```bash
git diff -- sql/clickhouse/views/chain/mv_daily_stats.sql sql/clickhouse/backfills/chain/mv_daily_stats.sql
```

Expected: SQL changes are comments/header notes only.

- [ ] **Step 3: Confirm no TypeScript runtime code changed**

Run:

```bash
git diff -- src/lib/tempoAnalytics.ts src/lib/dataService.ts
```

Expected: TypeScript changes are comments only.

- [ ] **Step 4: Confirm remaining Tempo-specific literals are documented**

Run:

```bash
rg -n "\b118\b|type\s*=\s*118|signature_type\s*=\s*2|call_count > 0|call_count > 1|fee_payer !=|fee_token IS NOT NULL|valid_before|valid_after" src sql docs
```

Expected: important semantics are described in `docs/tempo-semantics.md` or nearby comments/header notes.

- [ ] **Step 5: Final summary**

Prepare a summary:

```markdown
Documentation-only changes:
- Added docs/tempo-semantics.md.
- Added comments for Tempo analytics predicates.
- Added comments for exported data semantics.
- Added SQL header notes for daily stats heuristics.
- Added documentation link where appropriate.

No runtime behavior changed:
- No frontend components changed.
- No chart components changed.
- No SQL predicates changed.
- No query strings changed.
```

Do not create a final commit unless Step 4 finds missing documentation and a docs/comment-only fix is needed.

---

## Subagent Execution Strategy

Use fresh subagents per task:

- Task 1: Documentation writer with web source verification.
- Task 2: Analytics comments worker.
- Task 3: Data export comments worker.
- Task 4: SQL header comments worker.
- Task 5: Documentation index worker.
- Task 6: Final reviewer.

Tasks 2, 3, 4, and 5 can run after Task 1 and do not need to wait for each other if write scopes stay disjoint. Task 6 must run last.

Each subagent must state whether its diff is documentation/comment-only. If a subagent believes executable code needs to change, it must stop and report the recommendation instead of making the change.

## Completion Criteria

- `docs/tempo-semantics.md` exists and cites source URLs.
- Existing Tempo-specific analytics definitions are documented without changing behavior.
- No frontend, chart, or UI files are changed.
- No SQL predicates are changed.
- No query strings are changed.
- Final review confirms the PR is documentation-only.
