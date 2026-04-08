# Data Assets

This repo keeps ClickHouse view definitions, backfills, and validation scripts as first-class source files.

Apply repo-owned assets with `scripts/apply-clickhouse-assets.sh`, then validate them with `scripts/validate-data.sh`.
View definitions always apply on rerun. Historical backfills are skipped unless `CLICKHOUSE_RUN_BACKFILLS=1` is set explicitly.

Each explorer surface should be traceable to the SQL assets it depends on.

| Explorer surface | App file | SQL assets |
| --- | --- | --- |
| Analytics page summary and activity cards | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Analytics page inscriptions chart | `src/app/analytics/page.tsx`, `src/lib/inscriptions.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Analytics page stablecoin chart | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| Analytics page DEX activity card | `src/app/analytics/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Stablecoins page | `src/app/stablecoins/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| DEX page fee-token and community pool analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| DEX page protocol DEX analytics | `src/app/dex/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/protocol-dex.sql`, `sql/clickhouse/backfills/protocol-dex.sql` |
| NFTs page | `src/app/nfts/page.tsx`, `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
