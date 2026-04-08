# Tempo Explorer

Analytics-focused explorer for the Tempo blockchain.

## What This Repo Owns

- The Next.js explorer app baseline in this repo
- Explorer-specific analytics queries that will be added in later tasks
- ClickHouse materialized-view definitions, backfills, and validation scripts added in later tasks

## External Dependencies

- TIDX
- ClickHouse
- Tempo RPC

This MVP runs directly against the external TIDX and ClickHouse services. It does not require Redis, nginx, or a separate application topology layer.

## Quick Start

1. Copy `.env.example` to `.env.local`
2. Point `TIDX_URL`, `CLICKHOUSE_URL`, and `CLICKHOUSE_DB` at your services
3. Set `PAYMENT_ADDRESS` and `USDC_ADDRESS` if you want the export/payment flow to work
4. Set `TEMPO_RPC_URL` only if you need a non-default Tempo RPC endpoint
5. Install dependencies with `npm install`
6. Start the app with `npm run dev`
7. Optionally expose it with `cloudflared tunnel --url http://localhost:3000`

## ClickHouse Assets

- Apply definitions only: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Apply definitions plus historical backfills: `CLICKHOUSE_RUN_BACKFILLS=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Validate the repo-owned analytics assets: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 TIDX_URL=http://localhost:8080 bash scripts/validate-data.sh`
