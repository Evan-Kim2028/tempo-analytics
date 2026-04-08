# Architecture

Tempo Explorer is a standalone Next.js application that depends on external TIDX and ClickHouse services.

The app does not own indexing infrastructure. It owns the explorer UI, explorer-specific data-access code, and the SQL assets required for analytics pages.
