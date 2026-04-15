# MV Hardening — Design Spec

- **Date:** 2026-04-15
- **Author:** evan
- **Status:** draft, pending review
- **Scope tag:** v1 (explicit non-goals listed)

## Problem

The `sql/clickhouse/{views,backfills}/<domain>/mv_*.sql` tree is well organized, but editing or adding a materialized view is slow and error-prone:

1. `CREATE TABLE IF NOT EXISTS` silently no-ops when a view's target-table schema changes, so edits-in-place drift without warning.
2. There is no per-view replay path. The only options are the whole-tree apply or hand-run SQL.
3. Documentation of what each MV is for, what it reads, and who consumes it lives in `docs/data-assets.md`, which is maintained by discipline and rots.
4. Nothing warns the operator when a target-table column change will break a frontend chart whose server-side SQL references the removed column.

Result: changing or adding an MV is painful enough that analytics velocity drops.

## Goals (v1)

- Make per-view replay a one-command operation: `apply-clickhouse-assets.sh --only <domain>/<name> [--force-recreate]`.
- Detect target-table DDL drift loudly (B-narrow drift guard) and require an explicit `--force-recreate` to proceed.
- Make every `.sql` file self-documenting via a required header block; auto-generate `docs/data-assets.md` from those headers.
- Warn before `--force-recreate` drops or renames a column that frontend consumer files reference.
- Fit into existing takopi capabilities (no new broker capability, no new systemd unit).

## Non-goals (v1)

- Fixture-based SQL regression tests for view output.
- CI workflows.
- New takopi broker capability (planned as v2 once the script stabilizes).
- Dropping orphaned MVs automatically when their repo file is deleted.
- Per-time-range backfill slicing (`--backfill-range`).
- Full TypeScript type generation from MV schemas (considered, deferred — see Section 7).

## Architecture

One front door remains `scripts/apply-clickhouse-assets.sh`. New CLI surface:

```
apply-clickhouse-assets.sh                                 # bulk apply, unchanged behavior
apply-clickhouse-assets.sh --only <domain>/<name>          # single-view logic-only apply
apply-clickhouse-assets.sh --only <domain>/<name> \
                           --force-recreate                # drop + recreate + rerun backfill
CLICKHOUSE_RUN_BACKFILLS=N apply-clickhouse-assets.sh      # unchanged
```

Drift is tracked in a managed side-table:

```sql
CREATE TABLE IF NOT EXISTS tidx_4217._mv_schema (
  name        String,
  ddl_hash    String,
  ddl_text    String,
  applied_at  DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(applied_at)
ORDER BY name;
```

Per-view flow on apply:

1. Parse header, validate required `@`-keys, confirm `@name` matches filename.
2. Extract target-table DDL (the `CREATE TABLE ...` block, ending before `CREATE MATERIALIZED VIEW`).
3. Canonicalize (lowercase keywords, collapse whitespace, strip comments) and hash.
4. Look up `ddl_hash` for this view in `_mv_schema`.
5. Branch:
   - **No row** → first-time install. Apply, record.
   - **Hash match** → SELECT-body edit (or no-op). Run `CREATE OR REPLACE MATERIALIZED VIEW` only. Target-table data preserved.
   - **Hash mismatch, no `--force-recreate`** → print unified diff of recorded `ddl_text` vs new DDL, exit 2.
   - **Hash mismatch, `--force-recreate`** → run consumer-safety check; on pass (or `--i-know-consumers-break`), `DROP TABLE`, `DROP VIEW`, recreate both, run backfill file, update `_mv_schema`.

Takopi path: `scripts/takopi_sync_clickhouse_assets.sh` forwards two new env vars to the apply script: `TAKOPI_MV_ONLY` → `--only`, `TAKOPI_MV_FORCE_RECREATE=1` → `--force-recreate --i-know-consumers-break`. `TAKOPI_MV_FORCE_RECREATE=1` without `TAKOPI_MV_ONLY` is rejected.

## Self-documenting SQL files

Every `sql/clickhouse/**/*.sql` file begins with a structured header:

```
-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         materialized_view     -- or: backfill, system
-- @purpose:      Daily DEX swap counts and unique-trader rollup per pool.
-- @upstream:     tidx_4217.logs, tidx_4217.txs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts::getDexDaily
-- @backfill:     sql/clickhouse/backfills/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--
-- NOTES: free-form prose explaining non-obvious filters, known caveats, etc.
```

Required keys for `@kind: materialized_view`: `@name`, `@domain`, `@kind`, `@purpose`, `@upstream`, `@consumers`, `@backfill` (value may be `none`), `@owner`, `@since`. Required keys for `@kind: backfill`: `@name`, `@domain`, `@kind`, `@purpose`, `@pairs` (path to the paired view file), `@owner`, `@since`. `@notes` / prose is optional for both kinds. Header is parsed by `scripts/lib/mv-header.py`; malformed headers fail the apply.

`scripts/gen-data-assets-doc.sh` reads all headers and rewrites the generated table section of `docs/data-assets.md` with a "DO NOT EDIT BELOW — generated from SQL headers" banner. The prose sections above the banner (creation workflow, editing workflow, verification checklist) are hand-maintained. The generator runs at the end of every successful apply and is also callable standalone.

## Creation workflow

Canonical steps (also lives in `docs/data-assets.md` above the banner):

1. Copy `sql/clickhouse/_template/mv_TEMPLATE.sql` to `sql/clickhouse/views/<domain>/mv_<name>.sql`. Fill the header and the DDL.
2. Copy `sql/clickhouse/_template/backfill_TEMPLATE.sql` to `sql/clickhouse/backfills/<domain>/mv_<name>.sql`. Same header with `@kind: backfill` and `@pairs: views/<domain>/mv_<name>.sql`.
3. Run `bash scripts/apply-clickhouse-assets.sh --only <domain>/mv_<name> --force-recreate`. Script validates headers, applies view, runs backfill, records in `_mv_schema`, regenerates `docs/data-assets.md`.
4. Wire the frontend: add a function in `src/lib/analytics.ts` (or the relevant lib), call it from the page. Update `@consumers` in the SQL header to list the new callsites.
5. Commit both `.sql` files and the regenerated `docs/data-assets.md`.

## Editing workflow

- **SELECT-body-only change:** edit file, run `--only <domain>/<name>`. `CREATE OR REPLACE MATERIALIZED VIEW` applies; target-table data preserved; new logic applies to new inserts only.
- **Target-table schema change:** edit file, run `--only <domain>/<name>`. Apply fails with diff. Review, confirm intent, re-run with `--force-recreate`. Consumer-safety grep runs; address or override, then drop + recreate + backfill happens atomically.

## Error handling

Header validation:

- Missing required `@`-key, `@name` not matching filename, file with zero or multiple `CREATE TABLE` or `CREATE MATERIALIZED VIEW` blocks → exit 2 before any CH write.
- `--only <path>` that doesn't resolve → exit 2 with list of valid view paths.

Drift guard:

- `_mv_schema` missing → apply creates it first; idempotent.
- View exists in CH but not in `_mv_schema` (imported state) → treat as first install, record current repo hash, log a one-line notice.
- View in `_mv_schema` but file deleted from repo → print "orphan MV" warning, continue. Not dropped.
- Recorded `ddl_text` differs from live `SHOW CREATE TABLE` but hash matches → print warning with both, continue. Out-of-band edits surfaced but not blocking.

Apply-time failures:

- `DROP` succeeds but `CREATE` fails under `--force-recreate` → exit non-zero, `_mv_schema` not updated so the next apply re-detects drift.
- `CREATE` succeeds but backfill fails → same. `_mv_schema` updated only after full success.
- Backfill file missing when `--force-recreate` set → warn, continue, still update `_mv_schema`.
- Concurrent apply invocations → out of scope for v1; mitigated by takopi mutation rate-limit (2/5min) and single tempo-stack unit.

Doc generator:

- If a header outside the touched view is malformed, the generator fails. The apply is not rolled back; operator fixes the header and re-runs the generator standalone.

## Consumer-safety check

Triggered on `--force-recreate` when the target-table column set changes (a column is dropped or renamed).

1. Compute `dropped_or_renamed = columns_before - columns_after`.
2. For each consumer path in the view's `@consumers` header, run `grep -nFw "<col>" <consumer_file>` for each dropped/renamed name.
3. If any hits, print a grouped report (file:line, matched token) and require either interactive `y` confirmation or `--i-know-consumers-break`. Non-interactive callers (takopi path, CI) must pass the flag.
4. No hits: proceed silently.

This is a warning layer, not a correctness proof. False positives (generic names) and false negatives (dynamic SQL construction) are called out in the generated doc.

## Files touched

Existing:

- `scripts/apply-clickhouse-assets.sh` — add arg parsing, header parsing, hash/drift logic, per-view recreate path, consumer grep, post-apply `_mv_schema` upsert, doc regen trigger.
- `scripts/takopi_sync_clickhouse_assets.sh` — forward `TAKOPI_MV_ONLY` and `TAKOPI_MV_FORCE_RECREATE` to the apply script.
- `docs/data-assets.md` — restructure into hand-maintained prose (workflows, verification) + auto-generated table below a banner.

New:

- `sql/clickhouse/system/_mv_schema.sql` — DDL for the side-table.
- `sql/clickhouse/_template/mv_TEMPLATE.sql`, `sql/clickhouse/_template/backfill_TEMPLATE.sql`.
- `scripts/lib/mv-header.py` — parse and validate `@`-header.
- `scripts/lib/mv-ddl.py` — `extract_target_ddl`, `canonicalize_ddl`.
- `scripts/lib/mv-header_test.py`, `scripts/lib/mv-ddl_test.py` — unit tests (`python3 -m unittest`).
- `scripts/gen-data-assets-doc.sh` — regenerate the generated portion of the doc.
- `scripts/test-apply-flow.sh` — scripted manual integration test against a throwaway DB.

Migration:

- One-time pass to add `@`-headers to all existing `sql/clickhouse/{views,backfills}/**/*.sql` files. Most fields derivable from filepath and current `docs/data-assets.md` table. Done as part of implementation.

## Testing

- `python3 -m unittest` over `scripts/lib/*_test.py` runs in < 1s, checked in CI-adjacent form (run manually for v1, wired into `scripts/validate-data.sh`).
- `scripts/test-apply-flow.sh` run manually before merging changes to the apply script. Exercises first-install, no-op re-apply, SELECT-body edit, DDL drift (blocked), `--force-recreate` (drop + recreate + backfill), consumer-grep hit.
- Manual post-apply checklist (in generated doc): MV row count non-zero, frontend page renders, `takopi service status takopi-tempo-explorer.service` active.

## Open questions

None blocking. Explicit deferrals listed under Non-goals. Likely v2 follow-ups:

- `takopi tempo mv replay <view>` capability fronting the script.
- `scripts/gen-mv-types.ts` for real TypeScript typing of view result shapes.
- Fixture-based SQL regression tests for high-value views.
- Orphan-MV detection + sanctioned drop path.
