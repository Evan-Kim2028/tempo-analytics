# Data Assets

This repo keeps ClickHouse view definitions, backfills, and validation scripts as first-class source files.

Apply repo-owned assets with `scripts/apply-clickhouse-assets.sh`, then validate them with `scripts/validate-data.sh`.

Each explorer surface should be traceable to the SQL assets it depends on.

| Explorer surface | App file | SQL assets |
| --- | --- | --- |
| Home and analytics summary cards | `src/lib/analytics.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Analytics TIP-20 inscriptions | `src/lib/inscriptions.ts` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
| Stablecoins page | `src/app/stablecoins/page.tsx` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql` |
| DEX page | `src/app/dex/page.tsx` | `sql/clickhouse/views/erc20-and-dex.sql`, `sql/clickhouse/backfills/erc20-and-dex.sql`, `sql/clickhouse/views/protocol-dex.sql`, `sql/clickhouse/backfills/protocol-dex.sql` |
| NFTs page | `src/app/nfts/page.tsx` | `sql/clickhouse/views/core.sql`, `sql/clickhouse/backfills/core.sql` |
