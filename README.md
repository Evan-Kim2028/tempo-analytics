# Tempo Explorer

Analytics-focused explorer for the Tempo blockchain.

## What This Repo Owns

- The Next.js explorer app
- Explorer-specific analytics queries
- ClickHouse materialized-view definitions and backfills
- Helper scripts to apply and validate explorer-owned data assets

## External Dependencies

- TIDX
- PostgreSQL
- ClickHouse

## Quick Start

1. Copy `.env.example` to `.env.local`
2. Point `TIDX_URL` and `CLICKHOUSE_URL` at your services
3. Install dependencies with `npm install`
4. Start the app with `npm run dev`
5. Optionally expose it with `cloudflared tunnel --url http://localhost:3000`
