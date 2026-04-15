# Data Assets

This repo keeps ClickHouse view definitions, backfills, and validation scripts as first-class source files. Every `.sql` file carries a structured `@`-header that IS its documentation. The table below is generated from those headers — do not edit by hand.

## Creating a new view

1. Copy `sql/clickhouse/_template/mv_TEMPLATE.sql` to `sql/clickhouse/views/<domain>/mv_<name>.sql`. Fill the header and the DDL.
2. Copy `sql/clickhouse/_template/backfill_TEMPLATE.sql` to `sql/clickhouse/backfills/<domain>/mv_<name>.sql`. Fill the header.
3. Run `bash scripts/apply-clickhouse-assets.sh --only <domain>/mv_<name> --force-recreate`.
4. Wire the frontend in `src/lib/analytics.ts` (or the relevant lib). Update `@consumers` in the view's header.
5. Commit both `.sql` files and the regenerated section of this doc.

## Editing an existing view

- **SELECT-body only:** edit and run `apply-clickhouse-assets.sh --only <domain>/<name>`. `CREATE OR REPLACE MATERIALIZED VIEW` applies; target-table data stays; new logic applies to new inserts only.
- **Target-table schema change:** edit and run the same command. Apply blocks with a DDL diff. Re-run with `--force-recreate` to drop + recreate + backfill. The consumer-safety grep warns if dropped/renamed columns are referenced in the files listed in `@consumers`.

## Verification after apply

1. Exit 0 from the apply script.
2. `SELECT count() FROM tidx_4217.<mv_name>` is non-zero (or expected-zero with a note in `@notes`).
3. The frontend page in `@consumers` renders without error at the public URL.
4. `takopi service status takopi-tempo-explorer.service` is `active`.

## Takopi integration

- `takopi service restart takopi-tempo-stack.service` applies all views (current bulk behavior).
- Set `TAKOPI_MV_ONLY=<domain>/<name>` to narrow to one view.
- Set `TAKOPI_MV_FORCE_RECREATE=1` (must be combined with `TAKOPI_MV_ONLY`) to drop and recreate. The sync script passes `--i-know-consumers-break` so the grep is non-blocking in the broker path.

<!-- BEGIN GENERATED -->
## Views

| Name | Domain | Purpose | Upstream | Consumers | View SQL | Backfill SQL |
| --- | --- | --- | --- | --- | --- | --- |
| `mv_daily_stats` | chain | Daily transaction type breakdown by chain | `tidx_4217.txs` | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_daily_stats.sql` | `sql/clickhouse/backfills/chain/mv_daily_stats.sql` |
| `mv_daily_uniq` | chain | Daily unique senders via HyperLogLog sketch (uniqState) | `tidx_4217.txs` | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_daily_uniq.sql` | `sql/clickhouse/backfills/chain/mv_daily_uniq.sql` |
| `mv_fee_token_daily` | chain | Daily fee token usage (AA: fee paid in stablecoin vs native) | `tidx_4217.txs` | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_fee_token_daily.sql` | `sql/clickhouse/backfills/chain/mv_fee_token_daily.sql` |
| `mv_inscription_daily` | chain | Daily inscription activity (transactions with JSON payload input) | `tidx_4217.txs` | `src/app/analytics/page.tsx`, `src/lib/inscriptions.ts` | `sql/clickhouse/views/chain/mv_inscription_daily.sql` | `sql/clickhouse/backfills/chain/mv_inscription_daily.sql` |
| `mv_dex_daily` | dex | Daily Uniswap V2-compatible DEX swap activity by pair (swap count only) | `tidx_4217.logs` | `src/app/analytics/page.tsx`, `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_dex_daily.sql` | `sql/clickhouse/backfills/dex/mv_dex_daily.sql` |
| `mv_dex_swap_amounts_daily` | dex | Daily decoded Uniswap V2 swap amounts by pair | `tidx_4217.logs` | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql` | `sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql` |
| `mv_protocol_dex_pool_daily` | dex | Protocol DEX (enshrined precompile) per-pool daily stats | `tidx_4217.logs` | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql` | `sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql` |
| `mv_protocol_dex_pool_dau_daily` | dex | Protocol DEX per-pool daily active users (unique taker addresses) | `tidx_4217.logs` | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_pool_dau_daily.sql` | `sql/clickhouse/backfills/dex/mv_protocol_dex_pool_dau_daily.sql` |
| `mv_protocol_dex_volume_totals_daily` | dex | Protocol DEX (enshrined precompile) daily volume totals across all pools | `tidx_4217.logs` | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql` | `sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql` |
| `mv_nft_daily` | nfts | Daily ERC-721 transfer activity by collection | `tidx_4217.logs` | `src/app/analytics/page.tsx`, `src/app/nfts/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/nfts/mv_nft_daily.sql` | `sql/clickhouse/backfills/nfts/mv_nft_daily.sql` |
| `mv_memo_payments_daily` | payments | Daily memo payment rollups for dashboard counts and volume (success + failed pathUSD rail) | `tidx_4217.logs`, `tidx_4217.receipts`, `tidx_4217.txs` | `src/app/payments/page.tsx`, `src/lib/payments.ts` | `sql/clickhouse/views/payments/mv_memo_payments_daily.sql` | `sql/clickhouse/backfills/payments/mv_memo_payments_daily.sql` |
| `mv_memo_payments_failed_actors` | payments | Failed payment actor aggregation (sender/recipient pairs by day). | `tidx_4217.receipts`, `tidx_4217.txs` | `src/app/payments/page.tsx`, `src/lib/payments.ts` | `sql/clickhouse/views/payments/mv_memo_payments_failed_actors.sql` | none |
| `mv_stablecoin_daily` | stablecoins | Daily transfer volume for whitelisted stablecoins (pathUSD and USDC.e) | `tidx_4217.logs` | `src/app/analytics/page.tsx`, `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql` | `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql` |
| `mv_stablecoin_supply_daily` | stablecoins | Daily net supply change per whitelisted stablecoin (mints minus burns) | `tidx_4217.logs` | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql` | `sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql` |
| `mv_erc20_volume_daily` | tokens | Daily ERC-20 transfer volume across all tokens (~2600+) | `tidx_4217.logs` | `src/lib/analytics.ts` | `sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql` | `sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql` |
| `mv_token_transfers_daily` | tokens | Daily Transfer event count by token address (ERC-20 and ERC-721) | `tidx_4217.logs` | `src/lib/analytics.ts` | `sql/clickhouse/views/tokens/mv_token_transfers_daily.sql` | `sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql` |
<!-- END GENERATED -->
