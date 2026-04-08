# Architecture

Tempo Analytics is a standalone Next.js application with repo-owned analytics assets.

The app talks directly to the external TIDX service, its PostgreSQL backing store, and ClickHouse. The repo owns the ClickHouse view definitions, backfills, and validation scripts that make the explorer surfaces reproducible.

The default path does not include nginx or redis. The intended deployment is the Next.js app exposed directly, then tunnel-shared to collaborators or testers.
