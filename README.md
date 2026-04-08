# Tempo Analytics

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

For a production-style local run that serves the built app and copies the required standalone assets, use:

- `npm run build`
- `npm run start:standalone`

## Exporting Data (for agents)

Every chart page has an **Export CSV** button gated behind a $0.10 USDC micropayment via the [mppx](https://github.com/mppxyz/mppx) payment protocol. Browser wallets are supported in the UI, but agents should use the headless script.

### How the payment protocol works

1. `POST /api/export` with `{ "query": "<key>" }` — no auth header → `402 Payment Required` + `WWW-Authenticate: Payment` challenge
2. Pay $0.10 USDC to the recipient address listed in the challenge (Solana USDC or Tempo USDC.e)
3. Retry `POST /api/export` with `Authorization: Payment <credential>` — server verifies on-chain, responds 200 + CSV

The credential is `base64url(JSON({ challenge, payload }))` where `payload` is `{ signature, type: "hash" }` for Solana or `{ hash, type: "hash" }` for Tempo.

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

`scripts/mpp-pay-test.mjs` does the full round-trip: challenge → Solana USDC SPL transfer → on-chain confirmation → credential → CSV download.

Prerequisites:
- `ows` CLI installed with a funded Solana wallet (wallet name passed as `WALLET_NAME` in the script)
- The wallet must hold enough USDC (≥ $0.10) and SOL for gas (≥ 0.003 SOL)

```bash
node scripts/mpp-pay-test.mjs stablecoin-daily
# Downloads to /tmp/stablecoin-daily-export.csv
```

To use a different query key, pass it as the first argument. To adapt the script for your own wallet, update `PAYER`, `PAYER_ATA`, and `WALLET_NAME` at the top of the file.

## ClickHouse Assets

- Apply definitions only: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Apply definitions plus historical backfills: `CLICKHOUSE_RUN_BACKFILLS=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 bash scripts/apply-clickhouse-assets.sh`
- Validate the repo-owned analytics assets: `CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DB=tidx_4217 TIDX_URL=http://localhost:8080 bash scripts/validate-data.sh`
