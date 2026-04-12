# Tempo Analytics

Analytics-focused explorer for the Tempo blockchain.

The Docker stack is infra-only. It should run only PostgreSQL, ClickHouse, and TIDX. The explorer app itself runs directly on the host at `http://127.0.0.1:3001` and is intended to be managed by `takopi-tempo-explorer.service`.

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
3. Set `TEMPO_RECIPIENT_ADDRESS` if you want the export/payment flow to work
4. Set `TEMPO_RPC_URL` only if you need a non-default Tempo RPC endpoint
5. Run `npm install`
6. Start the app with `npm run dev -- --port 3001` or `PORT=3001 npm run start:standalone`
7. Share it directly with a tunnel such as `cloudflared tunnel --url http://localhost:3001`
8. For the Takopi-managed runtime, use `takopi service restart takopi-tempo-stack.service` for the stack or `takopi service restart takopi-tempo-explorer.service` for the frontend.

For a production-style local run that serves the built app and copies the required standalone assets, use:

- `npm run build`
- `npm run start:standalone`

## Exporting Data (for agents)

Every chart page has an **Export CSV** button gated behind a $0.01 Tempo micropayment via the [mppx](https://github.com/mppxyz/mppx) payment protocol. Browser wallets are supported in the UI, but Takopi sessions should use the brokered headless script.

### How the payment protocol works

1. `POST /api/export` with `{ "query": "<key>" }` — no auth header → `402 Payment Required` + `WWW-Authenticate: Payment` challenge
2. Pay $0.01 USDC.e or pathUSD on Tempo to the recipient address listed in the challenge, using `transferWithMemo`
3. Retry `POST /api/export` with `Authorization: Payment <credential>` — server verifies on-chain, responds 200 + CSV

The credential is `base64url(JSON({ challenge, payload }))` where `payload` is `{ hash, type: "hash" }` for Tempo.

### Available export keys

| Key | Source | Description |
|-----|--------|-------------|
| `stablecoin-daily` | ClickHouse | Daily stablecoin transfer volume and count by token |
| `dex-daily` | ClickHouse | Daily DEX swap counts by pair |
| `nft-activity` | ClickHouse | Daily NFT transfer counts by collection |
| `mainnet-launch` | TIDX | Weekly tx count and unique senders since mainnet launch |
| `fee-sponsorship` | TIDX | Daily fee sponsorship rate (last 90 days) |
| `account-types` | TIDX | Transaction count by signature type |
| `fee-tokens` | TIDX | Transaction count by fee token |
| `latest-blocks` | TIDX | Latest 1000 blocks |
| `batch-calls` | TIDX | Transaction count by batch call count |

### Headless payment script

`scripts/e2e-payment-test.mjs` does the full round-trip: challenge → brokered Tempo `transferWithMemo` → on-chain confirmation → credential → CSV download.

Prerequisites:
- Takopi runtime installed and `/etc/takopi` refreshed so `takopi wallet transfer` exposes `--memo`
- A funded brokered OWS wallet such as `sui-trading`
- Enough Tempo balance for the $0.01 payment plus gas

```bash
takopi wallet list
node scripts/e2e-payment-test.mjs
```

The script currently exercises the `fee-tokens` export path against `http://localhost:3001/api/export`, which is the direct host-run explorer path. This remains the canonical Takopi-safe path because it routes signing and broadcast through `takopi wallet transfer --memo` rather than raw `ows`.

## ClickHouse Assets

- Apply definitions only: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Apply definitions plus historical backfills: `CLICKHOUSE_RUN_BACKFILLS=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Validate the repo-owned analytics assets: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 TIDX_URL=http://localhost:8080 bash scripts/validate-data.sh`
