# Data Assets

This repo keeps ClickHouse view definitions, backfills, and validation scripts as first-class source files.

Apply repo-owned assets with `scripts/apply-clickhouse-assets.sh`, then validate them with `scripts/validate-data.sh`.
View definitions always apply on rerun. Historical backfills are skipped unless `CLICKHOUSE_RUN_BACKFILLS=1` is set explicitly.

Each explorer surface should be traceable to the SQL assets it depends on.

| Explorer surface | App file | SQL assets |
| --- | --- | --- |
| Analytics page summary, daily activity, AA features, and transaction breakdown cards | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_daily_stats.sql`, `sql/clickhouse/backfills/chain/mv_daily_stats.sql` |
| Analytics page unique senders | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_daily_uniq.sql`, `sql/clickhouse/backfills/chain/mv_daily_uniq.sql` |
| Analytics page inscriptions chart | `src/app/analytics/page.tsx`, `src/lib/inscriptions.ts` | `sql/clickhouse/views/chain/mv_inscription_daily.sql`, `sql/clickhouse/backfills/chain/mv_inscription_daily.sql` |
| Analytics page stablecoin chart | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`, `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql` |
| Analytics page DEX activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_dex_daily.sql`, `sql/clickhouse/backfills/dex/mv_dex_daily.sql` |
| Analytics page NFT activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/nfts/mv_nft_daily.sql`, `sql/clickhouse/backfills/nfts/mv_nft_daily.sql` |
| Stablecoins page volume | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_daily.sql`, `sql/clickhouse/backfills/stablecoins/mv_stablecoin_daily.sql` |
| Stablecoins page historical supply chart | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/stablecoins/mv_stablecoin_supply_daily.sql`, `sql/clickhouse/backfills/stablecoins/mv_stablecoin_supply_daily.sql` |
| DEX page fee-token analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/chain/mv_fee_token_daily.sql`, `sql/clickhouse/backfills/chain/mv_fee_token_daily.sql` |
| DEX page community pool analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_dex_daily.sql`, `sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql`, `sql/clickhouse/backfills/dex/mv_dex_daily.sql`, `sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql` |
| DEX page Protocol DEX volume totals | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_volume_totals_daily.sql`, `sql/clickhouse/backfills/dex/mv_protocol_dex_volume_totals_daily.sql` |
| DEX page Protocol DEX pool explorer | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/dex/mv_protocol_dex_pool_daily.sql`, `sql/clickhouse/backfills/dex/mv_protocol_dex_pool_daily.sql` |
| NFTs page | `src/app/nfts/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/nfts/mv_nft_daily.sql`, `sql/clickhouse/backfills/nfts/mv_nft_daily.sql` |
| Token transfers (all ERC-20/ERC-721) | `src/lib/analytics.ts` | `sql/clickhouse/views/tokens/mv_token_transfers_daily.sql`, `sql/clickhouse/backfills/tokens/mv_token_transfers_daily.sql` |
| ERC-20 volume (all tokens) | `src/lib/analytics.ts` | `sql/clickhouse/views/tokens/mv_erc20_volume_daily.sql`, `sql/clickhouse/backfills/tokens/mv_erc20_volume_daily.sql` |
