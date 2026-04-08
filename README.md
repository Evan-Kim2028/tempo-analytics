# Tempo Explorer

Analytics-focused explorer for the Tempo blockchain.

## What This Repo Owns

- The standalone Next.js explorer app
- Repo-owned ClickHouse view definitions, backfills, and validation scripts
- The scripts used to apply and verify those analytics assets

## External Dependencies

- TIDX
- PostgreSQL backing TIDX
- ClickHouse
- Tempo RPC

## Quick Start

1. Copy `.env.example` to `.env.local`
2. Set `TIDX_URL`, `CLICKHOUSE_URL`, and `CLICKHOUSE_DB`
3. Set `PAYMENT_ADDRESS` and `USDC_ADDRESS` if you want the export/payment flow to work
4. Set `TEMPO_RPC_URL` only if you need a non-default Tempo RPC endpoint
5. Run `npm install`
6. Start the app with `npm run dev`
7. Share it directly with a tunnel such as `cloudflared tunnel --url http://localhost:3000`

## ClickHouse Assets

- Apply definitions only: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Apply definitions plus historical backfills: `CLICKHOUSE_RUN_BACKFILLS=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Validate the repo-owned analytics assets: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 TIDX_URL=http://localhost:8080 bash scripts/validate-data.sh`
