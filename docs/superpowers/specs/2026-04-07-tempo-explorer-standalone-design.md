# Tempo Explorer Standalone Repo Design

Date: 2026-04-07

## Summary

Split the current explorer app out of `/home/evan/tidx/explorer` into a clean standalone repository named `tempo-explorer`.

The standalone repo will own:

- the Next.js application
- explorer-specific query logic and data-access code
- ClickHouse SQL assets, especially materialized view definitions and backfills
- helper scripts for applying and validating explorer-owned analytics assets
- setup and architecture documentation for replication

The standalone repo will not own:

- the `TIDX` indexer codebase
- PostgreSQL lifecycle
- ClickHouse lifecycle
- `nginx`
- `redis`

The immediate target is a fast MVP that runs as a single Next.js app on port `3000` and is shared through a Cloudflare tunnel. `TIDX`, PostgreSQL, and ClickHouse are treated as external dependencies configured through environment variables.

## Goals

- Make `Tempo Explorer` a standalone, understandable product repo.
- Make the explorer reproducible for other developers who want to run or fork it.
- Make analytics logic inspectable by checking SQL assets and helper scripts into the repo.
- Make materialized view creation and backfill logic first-class, not hidden operational knowledge.
- Remove infrastructure complexity that is not needed for the MVP path.
- Preserve a clear path to fixing the current frontend styling issue after the split.

## Non-Goals

- Moving `TIDX` itself into this repo
- Owning database provisioning in the explorer repo
- Production hardening for public internet traffic
- Keeping `nginx` or `redis` in the default MVP architecture
- Preserving git history from the current monorepo layout

## Product Boundary

The repo should represent "an analytics-focused explorer application that consumes indexed Tempo data."

It should be possible for a new developer to answer the following questions by reading this repo alone:

- What does the explorer do?
- What services does it depend on?
- How does it query Tempo data?
- What materialized views does it require?
- How do I apply those views?
- How do I run the app locally and expose it through a Cloudflare tunnel?
- How do I modify the analytics layer for my own use case?

## Recommended Architecture

### Runtime

- One Next.js app
- Default local port: `3000`
- Cloudflare tunnel points directly to the app
- External dependencies:
  - `TIDX`
  - PostgreSQL
  - ClickHouse

### Explicitly Removed From The Default Path

- `nginx`
- `redis`

These may return later as optional optimizations, but they are not part of the default standalone MVP.

## Repository Layout

Recommended structure:

```text
tempo-explorer/
  src/
  public/
  sql/
    clickhouse/
      views/
      backfills/
      queries/
  scripts/
  docs/
  .env.example
  README.md
  package.json
```

### Directory Roles

- `src/`
  - Next.js pages, components, and shared data-access code
- `sql/clickhouse/views/`
  - canonical `CREATE TABLE` and `CREATE MATERIALIZED VIEW` definitions
- `sql/clickhouse/backfills/`
  - explicit historical load statements separated from schema definitions
- `sql/clickhouse/queries/`
  - reusable or documented query assets that explain analytics behavior
- `scripts/`
  - thin operational wrappers that apply views, run backfills, and validate explorer prerequisites
- `docs/`
  - architecture notes, setup guidance, and mappings from product surfaces to SQL assets
- `.env.example`
  - only app-facing configuration

## SQL And Materialized View Lifecycle

The ClickHouse layer is a first-class part of the product and must be visible in the repo as code and as process.

### Required Principles

- Raw SQL must be committed and readable.
- View creation logic must be committed and runnable.
- Backfills must be explicit and separated from definitions.
- Validation must be runnable from the explorer repo.
- The docs must explain which explorer pages depend on which view assets.

### Recommended Execution Model

Use thin repo-local scripts to run SQL assets in a deterministic order:

1. create required tables and materialized views
2. run any required backfills
3. run validation checks

This keeps the source of truth in versioned SQL while still giving operators a simple entrypoint.

## Replicability Model

The repo should support two usage modes.

### 1. Consumer Mode

A user points the explorer at an existing `TIDX` + ClickHouse deployment and runs the app quickly.

### 2. Full Replica Mode

A user runs their own `TIDX`, points it at Tempo, applies the SQL assets from this repo, and gets the same explorer behavior with room to customize the data model and UI.

### Required Documentation

The repo should document:

- required external services
- required environment variables
- the setup sequence
- how to apply SQL assets
- how to validate explorer prerequisites
- how to start the app
- how to expose it via Cloudflare tunnel

## Environment Contract

The standalone repo should document and use a small set of environment variables, including:

- `TIDX_URL`
- `CLICKHOUSE_URL`
- `NEXT_PUBLIC_CHAIN_ID`
- payment-related app variables that the explorer directly consumes

The repo should not require environment variables for services that are no longer part of the MVP path.

## Migration Sequence

Implementation should happen in this order:

1. Create a clean standalone repo from the current explorer app.
2. Move explorer-owned SQL assets and helper scripts into first-class repo locations.
3. Add setup and replication documentation.
4. Verify the standalone app builds and boots against external services.
5. Fix the frontend styling issue inside the standalone repo.
6. Re-test the MVP flow through a Cloudflare tunnel.

## Frontend Fix Follow-Up

The current styling issue should be fixed after the split, not before it.

Current evidence indicates:

- the tunnel is reachable
- the app returns HTML and a compiled CSS asset
- custom theme tokens are present
- generated Tailwind utility classes are not present in the served CSS

The next implementation step for the styling issue is to ensure the standalone app activates the Tailwind PostCSS pipeline during build, then rebuild and verify with a real tunnel render.

## Verification Requirements

Before calling the split successful, verify:

- `npm run build` succeeds in the standalone repo
- the app starts against external dependency URLs
- SQL apply and validation scripts run from the standalone repo
- the README is sufficient for a fresh setup
- the Cloudflare tunnel MVP works against port `3000`
- the frontend styling issue is resolved after the PostCSS/Tailwind fix

## Open Decisions Resolved In This Design

- Repo shape: clean standalone repo
- Default runtime: single Next.js app
- Tunnel target: app directly on port `3000`
- SQL assets: included and first-class
- Materialized view lifecycle: included and first-class
- Infra ownership: external `TIDX`, PostgreSQL, and ClickHouse
- `nginx`: excluded from MVP
- `redis`: excluded from MVP
- History preservation: not required

## Recommendation

Proceed with a clean split into `tempo-explorer`, make the SQL and materialized view lifecycle explicit inside that repo, keep the runtime minimal, and only then patch the Tailwind/PostCSS issue in the new standalone codebase.
