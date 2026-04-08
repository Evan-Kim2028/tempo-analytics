# Tempo Explorer

Analytics-focused explorer for the Tempo blockchain.

## What This Repo Owns

- The Next.js explorer app baseline in this repo
- Explorer-specific analytics queries that will be added in later tasks
- ClickHouse materialized-view definitions, backfills, and validation scripts added in later tasks

## External Dependencies

- TIDX
- PostgreSQL
- ClickHouse

## Quick Start

1. Copy `.env.example` to `.env.local`
2. Point `TIDX_URL` and `CLICKHOUSE_URL` at your services
3. Set `TEMPO_RPC_URL` only if you need a non-default Tempo RPC endpoint
4. Install dependencies with `npm install`
5. Start the app with `npm run dev`
6. Optionally expose it with `cloudflared tunnel --url http://localhost:3000`
