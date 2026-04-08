# Payments Tab Design Spec

**Date:** 2026-04-08  
**Scope:** New top-level `Payments` analytics surface for Tempo Analytics

---

## Goal

Add a new `Payments` tab that makes memo-bearing payment activity a first-class product surface in Tempo Analytics, with an operator-friendly landing experience that still preserves meaningful trend and concentration analytics.

This tab must be suitable for the currently running Cloudflare-served app, not just local development. That means it needs to fit the existing navigation, page layout, server-rendered data flow, and validation standards already used by the rest of the analytics surfaces.

---

## Product Decisions

### Label and placement

- Top-level nav label: `Payments`
- Add it to the existing primary navigation in `src/components/nav/PrimaryNav.tsx`
- The page lives at `/payments`

### Dataset scope

v1 covers **all memo-bearing transfers we can decode across Tempo**, not just pathUSD.

This includes:
- successful memo-bearing transfers
- failed direct memo-transfer attempts when they can be recovered from indexed inputs and receipt state

This does **not** mean “all transfers on the chain.” The tab is explicitly about payment-shaped, memo-bearing flows.

### Primary UX

The page uses a **split view**:
- analytics summary and framing at the top
- a prominent, full-width recent payments table very near the top
- trend and concentration sections underneath

This is intentionally not a charts-only analytics page and not a raw explorer page. It should feel like an operator dashboard with immediate row-level visibility.

### Data strategy

v1 uses a **hybrid** model:
- a lightweight ClickHouse daily-rollup layer for summary cards and time-series charts
- raw indexed queries for row-level detail, memo-family analysis, and concentration views

This is the fastest path to a real tab without prematurely building a full payments warehouse.

---

## Page Structure

Create a new server-rendered page at `src/app/payments/page.tsx` with the following section order:

1. Header
   - Title: `Payments`
   - Subtitle explaining that the tab covers memo-bearing payment activity across Tempo
   - Small freshness badge matching existing analytics pages

2. Summary cards
   - successful payments
   - failed attempts
   - success rate
   - total payment amount
   - unique senders
   - unique recipients

3. Recent payments table
   - this is the dominant first “working” surface
   - full-width
   - visible before the secondary chart sections

4. Daily payments trend
   - successful vs failed counts over time

5. Daily payment amount trend
   - amount moved per day

6. Concentration section
   - top recipients by amount
   - top recipients by count
   - top senders

7. Memo-pattern section
   - readable vs opaque vs empty
   - top readable memo families
   - duplicate memo reuse count

---

## Table Behavior

The recent payments table should include:
- timestamp
- tx hash
- sender
- recipient
- token
- amount
- status
- decoded memo when printable
- raw memo when not printable
- derived memo family when recognized

### Row treatment

- Successful and failed rows live in the **same table**
- Failed rows must be clearly marked
- Failed rows should contribute to failure metrics and counts
- Failed rows should **not** inflate “amount moved” metrics where doing so would be misleading

### Memo rendering

- printable memos: show decoded text directly
- opaque memos: show an “opaque” treatment with raw value still accessible inline
- empty memos: represented explicitly, not conflated with decoding failure

---

## Data Model

## Raw data layer

Add a payments-specific data module at `src/lib/payments.ts`.

This module is responsible for:
- fetching successful memo-bearing transfer rows from indexed `logs`
- fetching failed direct memo-transfer attempts from `txs` plus receipt/status context
- normalizing successful and failed rows into one shared row shape
- decoding memo values
- deriving memo families
- shaping recent-table rows
- computing sender/recipient concentration slices

The raw layer is the source of truth for:
- recent payments table
- top recipients by amount
- top recipients by count
- top senders
- memo-family composition details
- readable vs opaque vs empty counts

## Daily rollup layer

Add one lightweight ClickHouse rollup layer for daily chart/card inputs.

This layer should answer:
- successful payments per day
- failed attempts per day
- amount moved per day
- unique senders per day
- unique recipients per day
- readable vs opaque vs empty memo counts per day

This rollup is intentionally narrow. It is not a full event warehouse and should not try to precompute every table slice in v1.

### Why this split

The daily charts and summary cards are stable, repeated, and well suited to rollups.  
The recent table and memo-family exploration are still likely to evolve, so they should stay on raw indexed queries in v1.

---

## File Layout

### App

- Create: `src/app/payments/page.tsx`
- Create: `src/app/payments/loading.tsx`

### Data

- Create: `src/lib/payments.ts`

### Components

- Create: `src/components/payments/PaymentsSummary.tsx`
- Create: `src/components/payments/RecentPaymentsTable.tsx`
- Create: `src/components/payments/PaymentsNarrative.tsx`

### Charts

- Create: `src/components/charts/PaymentsCountChart.tsx`
- Create: `src/components/charts/PaymentsAmountChart.tsx`
- Create: `src/components/charts/PaymentsMemoPatternChart.tsx`

### Navigation / integration

- Modify: `src/components/nav/PrimaryNav.tsx`

### SQL / ClickHouse

- Add lightweight payments daily rollup SQL under the existing repo-owned ClickHouse structure
- The exact final filenames should follow the current domain-based SQL organization already used in `sql/clickhouse/views/...` and `sql/clickhouse/backfills/...`

### Tests

- Create: `__tests__/lib/payments.test.ts`
- Create: `__tests__/components/PaymentsSummary.test.tsx`
- Create: `__tests__/components/RecentPaymentsTable.test.tsx`
- Create: `__tests__/components/PaymentsNarrative.test.tsx`
- Create: `__tests__/app/payments.page.test.tsx` or equivalent page-level composition coverage

---

## UI and Theming Requirements

The page must stay visually consistent with the current app shell:
- use the current `Tempo Explorer` nav and page chrome
- match existing card, table, and chart styling patterns
- do not introduce a new theme system just for payments

The page must also avoid repeating the “tabs lose styling” regression currently being noticed elsewhere in the app. If nav/theme behavior is unstable, the Payments implementation should reuse existing patterns rather than inventing a custom tab or pill system.

---

## Loading and Failure Behavior

Add `src/app/payments/loading.tsx` so the page never shows a blank screen while data loads.

### Partial failure rules

- If one section fails, the rest of the page should still render
- Summary cards and recent payments table are the highest-priority sections
- Secondary analytics sections may degrade gracefully with inline empty/error messaging

### Empty states

- If there is no memo-bearing activity in the selected range, the page still renders with explicit empty-state messaging
- Do not silently collapse the table or chart sections

---

## Validation Requirements

Before this feature is considered ready:
- unit tests must cover memo decoding and memo-family classification
- component tests must cover table rendering and empty/error states
- the page must build cleanly with `npm run build`
- the Payments tab must be reachable from the main nav in the running app
- the page must be checked through the Cloudflare-served link, not just via localhost

---

## Out of Scope

The following are explicitly out of scope for v1:
- a universal memo explorer for every arbitrary contract
- deep merchant profiling beyond sender/recipient aggregation
- invoice semantics or order reconstruction beyond what memo strings directly encode
- a full normalized payments warehouse before validating the product surface

---

## Acceptance Criteria

A v1 implementation is acceptable when:
- users can open `Payments` from the main nav
- users can immediately see high-level payment health and volume
- users can inspect recent successful and failed memo-bearing payments from the same page
- users can distinguish readable memo usage from opaque activity
- daily charts are backed by a stable rollup path
- row-level detail is still explorable without leaving the page
- the tab works in the Cloudflare-served app
