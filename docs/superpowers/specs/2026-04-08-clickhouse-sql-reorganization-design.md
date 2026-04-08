# ClickHouse SQL Reorganization — Design Spec

**Date:** 2026-04-08
**Scope:** `sql/clickhouse/` directory, `scripts/apply-clickhouse-assets.sh`, `src/lib/analytics.ts`, `docs/data-assets.md`

---

## Goals

- Make each materialized view a first-class, independently navigable artifact (one file per view)
- Organize views by domain so the folder structure signals what a view is about
- Keep backfills in a separate mirrored tree (not co-located with views)
- Rename `mv_protocol_dex_daily` to `mv_protocol_dex_volume_totals_daily` for clarity
- Update the apply script to recurse into domain subfolders and support parallel backfill execution
- Update `docs/data-assets.md` to reflect new paths and the rename

Out of scope: token address consolidation, migration versioning, TypeScript restructuring, validate-data.sh changes.

---

## 1. New Directory Structure

```
sql/clickhouse/
├── views/
│   ├── chain/
│   │   ├── mv_daily_stats.sql
│   │   ├── mv_daily_uniq.sql
│   │   ├── mv_inscription_daily.sql
│   │   └── mv_fee_token_daily.sql
│   ├── tokens/
│   │   ├── mv_token_transfers_daily.sql
│   │   └── mv_erc20_volume_daily.sql
│   ├── stablecoins/
│   │   ├── mv_stablecoin_daily.sql
│   │   └── mv_stablecoin_supply_daily.sql
│   ├── dex/
│   │   ├── mv_dex_daily.sql
│   │   ├── mv_dex_swap_amounts_daily.sql
│   │   ├── mv_protocol_dex_volume_totals_daily.sql
│   │   └── mv_protocol_dex_pool_daily.sql
│   └── nfts/
│       └── mv_nft_daily.sql
└── backfills/
    ├── chain/
    │   ├── mv_daily_stats.sql
    │   ├── mv_daily_uniq.sql
    │   ├── mv_inscription_daily.sql
    │   └── mv_fee_token_daily.sql
    ├── tokens/
    │   ├── mv_token_transfers_daily.sql
    │   └── mv_erc20_volume_daily.sql
    ├── stablecoins/
    │   ├── mv_stablecoin_daily.sql
    │   └── mv_stablecoin_supply_daily.sql
    ├── dex/
    │   ├── mv_dex_daily.sql
    │   ├── mv_dex_swap_amounts_daily.sql
    │   ├── mv_protocol_dex_volume_totals_daily.sql
    │   └── mv_protocol_dex_pool_daily.sql
    └── nfts/
        └── mv_nft_daily.sql
```

**13 view files + 13 backfill files.** Each file contains exactly one CREATE TABLE + one CREATE MATERIALIZED VIEW pair (views) or one INSERT INTO ... SELECT (backfills). File is named after the view it defines.

### Domain rationale

| Domain | What it covers |
|--------|---------------|
| `chain/` | Chain-level daily stats: tx counts by type, unique senders, inscription activity, fee token usage |
| `tokens/` | ERC-20 transfer volume across all tokens (general-purpose, 2600+ tokens) |
| `stablecoins/` | Stablecoin-specific analytics: dedicated volume view + historical supply tracking |
| `dex/` | All DEX mechanisms: community Uniswap V2 swaps/amounts, enshrined Protocol DEX totals, enshrined Protocol DEX per-pool |
| `nfts/` | ERC-721 transfer counts by collection |

---

## 2. View Rename

`mv_protocol_dex_daily` → `mv_protocol_dex_volume_totals_daily`

**Rationale:** The old name gives no signal about what the view tracks. The new name makes clear it is the Protocol DEX (enshrined precompile), it tracks volume (swap count + USD volume), and it is the totals rollup (aggregate across all pools, as distinct from `mv_protocol_dex_pool_daily` which is per-pool).

**Files affected:**
- `sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql` — CREATE TABLE and VIEW renamed
- `sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql` — INSERT target renamed
- `src/lib/analytics.ts` — `getProtocolDexDailyStats()` query updated to reference new table name

---

## 3. `scripts/apply-clickhouse-assets.sh` Changes

### View application

Replace the current explicit file list with a recursive glob:

```bash
find sql/clickhouse/views -name "*.sql" | sort | while read -r f; do
  # apply $f
done
```

**Explicit comment at top of script:**
```
# Views are applied in arbitrary filesystem order (alphabetical by path).
# This is intentional — all views read directly from base tables (txs, logs)
# and no view depends on another. If a cross-view dependency is introduced
# in the future, this script must be updated with explicit ordering.
```

### Backfill application

Change from a boolean gate (`CLICKHOUSE_RUN_BACKFILLS=1`) to a parallelism number:

```bash
# Export functions so xargs subshells can call them
export -f run_sql rewrite_sql_for_db

if [ -n "$CLICKHOUSE_RUN_BACKFILLS" ] && [ "$CLICKHOUSE_RUN_BACKFILLS" -gt 0 ]; then
  find "$SCRIPT_DIR/../sql/clickhouse/backfills" -name "*.sql" | sort | \
    xargs -P "$CLICKHOUSE_RUN_BACKFILLS" -I{} bash -c 'run_sql "$@"' _ {}
fi
```

Usage: `CLICKHOUSE_RUN_BACKFILLS=4 bash scripts/apply-clickhouse-assets.sh` runs 4 backfill files concurrently. Safe because all backfills are independent INSERT INTO ... SELECT statements reading from base tables. `export -f` is required so the `run_sql` and `rewrite_sql_for_db` bash functions are available in the xargs subshells.

---

## 4. `docs/data-assets.md` Update

Update the traceability table to reflect:
- New file paths (domain subfolders instead of flat filenames)
- The rename `mv_protocol_dex_daily` → `mv_protocol_dex_volume_totals_daily`

No structural changes to the table format.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `sql/clickhouse/views/core.sql` | Deleted — split into 7 domain files |
| `sql/clickhouse/views/erc20-and-dex.sql` | Deleted — split into 4 domain files |
| `sql/clickhouse/views/protocol-dex.sql` | Deleted — split into 2 domain files |
| `sql/clickhouse/backfills/core.sql` | Deleted — split into 7 domain files |
| `sql/clickhouse/backfills/erc20-and-dex.sql` | Deleted — split into 4 domain files |
| `sql/clickhouse/backfills/protocol-dex.sql` | Deleted — split into 2 domain files |
| `sql/clickhouse/views/chain/*.sql` | New — 4 files |
| `sql/clickhouse/views/tokens/*.sql` | New — 2 files |
| `sql/clickhouse/views/stablecoins/*.sql` | New — 2 files |
| `sql/clickhouse/views/dex/*.sql` | New — 4 files (includes rename) |
| `sql/clickhouse/views/nfts/*.sql` | New — 1 file |
| `sql/clickhouse/backfills/chain/*.sql` | New — 4 files |
| `sql/clickhouse/backfills/tokens/*.sql` | New — 2 files |
| `sql/clickhouse/backfills/stablecoins/*.sql` | New — 2 files |
| `sql/clickhouse/backfills/dex/*.sql` | New — 4 files (includes rename) |
| `sql/clickhouse/backfills/nfts/*.sql` | New — 1 file |
| `scripts/apply-clickhouse-assets.sh` | Updated — recursive glob + parallel backfills + explicit ordering comment |
| `src/lib/analytics.ts` | Updated — `getProtocolDexDailyStats()` references new table name |
| `docs/data-assets.md` | Updated — new paths + rename reflected in traceability table |
