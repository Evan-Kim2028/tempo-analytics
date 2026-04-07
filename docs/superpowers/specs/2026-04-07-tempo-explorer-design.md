# Tempo Explorer — Design Spec
**Date:** 2026-04-07  
**Status:** Approved

---

## What We're Building

A public-facing, analytics-focused web explorer for the Tempo blockchain (chain ID 4217, "Presto" mainnet). The goal is opinionated, Tempo-specific analytics that don't exist anywhere else — showcasing what's uniquely interesting about Tempo's account model, fee structure, and on-chain behavior.

Free to browse. CSV export costs $0.10 flat per export, paid via Tempo's Machine Payments Protocol (MPP).

The data is still backfilling at time of writing. The infrastructure ships first; analytics charts are iterated on once the full dataset is available.

---

## Architecture

```
Internet
  └─ Cloudflare (free tier) — edge HTML cache + DDoS protection
       └─ Nginx — reverse proxy + local HTTP cache + TLS termination
            └─ Next.js (port 3000) — App Router, SSR, ISR
                 ├─ Redis (port 6379) — query result cache
                 └─ tidx HTTP API (localhost:8080) — data source
```

All services run as Docker containers in `~/tidx/docker-compose.yml`, sharing the existing `tidx_default` network. No new ports are exposed to the internet except 80/443 via Nginx.

### Why this protects the residential connection

Most page loads are served directly from Cloudflare's edge cache — never reach the machine. Under a traffic spike, Cloudflare absorbs it. Nginx provides a second cache layer for anything Cloudflare misses. Redis prevents duplicate ClickHouse/PG queries within the TTL window. The machine itself only processes genuine cache misses.

---

## Caching Strategy

| Layer | Scope | TTL |
|-------|-------|-----|
| Cloudflare | Rendered HTML | 2 minutes |
| Cloudflare | Static assets (JS, CSS, fonts) | 1 year (immutable) |
| Nginx `proxy_cache` | All HTML responses | 2 minutes |
| Redis | tidx query results, keyed by SQL+params | 30s (live stats) / 5 min (aggregations) / 15 min (historical) |
| Next.js ISR | Analytics pages | `revalidate: 60` (serves stale, regenerates in background) |

All data fetching happens server-side only. The browser never calls tidx or ClickHouse directly.

---

## Pages

### Free (no payment required)

**`/`** — Network overview  
Live stats: blocks/sec, tx rate, avg block time, time since mainnet launch (March 18, 2026). Simple number cards + sparklines. Refresh every 30s via ISR.

**`/analytics`** — Analytics hub  
Index page linking to each analytics view. Explains what each chart shows and why it's Tempo-specific.

**`/analytics/[slug]`** — Individual analytics pages  
Each page is one opinionated view. Charts TBD — will be defined once data is fully backfilled. Placeholder structure ships with the infrastructure. Initial candidates:

- `account-types` — passkey vs P256 vs Secp256k1 signature type breakdown
- `batch-calls` — % of txs using Tempo's native `calls[]` batching
- `fee-sponsorship` — txs where `fee_payer ≠ sender` (gas sponsorship adoption)
- `fee-tokens` — which stablecoins are being used to pay fees
- `mainnet-launch` — week-by-week activity before and after March 18

**`/blocks`** — Latest blocks  
Simple list: block number, timestamp, tx count, miner. Live, ISR 30s.

**`/tx/[hash]`** — Transaction detail  
Full tx fields including Tempo-specific ones: `signature_type`, `fee_token`, `fee_payer`, `calls[]`, `valid_before`, `valid_after`, `nonce_key`.

**`/address/[addr]`** — Address overview  
Tx history, nonce key usage, role as fee_payer for others. ISR 60s.

### Paid (MPP, $0.10 flat per export)

**`POST /api/export`** — CSV export endpoint  
Any analytics table or query result can be exported. The request carries the data parameters; the server returns a 402 challenge if no payment credential is present, then streams the CSV once payment is verified.

No other paywalled content. The API is internal-only — not documented or intended for external consumers.

---

## MPP Export Flow

```
1. User clicks "Export CSV" on any table
2. Browser POSTs to /api/export with { query, params }
3. Server: no payment credential → return 402 + MPP challenge
   { price: "0.10", currency: "USDC", challenge: "<nonce>" }
4. User's Tempo wallet signs the payment (session key flow)
5. Browser retries POST with payment credential in header
6. Server: verifies credential on-chain via viem
   - Valid signature
   - Correct amount (≥ $0.10 USDC)
   - Session key not expired
   - Spending limit not exceeded
7. Server streams CSV response
```

Price: **$0.10 flat per export** regardless of row count.  
Wallet support: any Tempo wallet (MetaMask on Tempo network, Privy passkey wallet).  
No account, signup, or billing required.

---

## Tech Stack

| Concern | Choice | Reason |
|---------|--------|--------|
| Framework | Next.js 15, App Router | SSR + ISR, good SEO for public explorer |
| Language | TypeScript | Type safety, Tempo ecosystem is TS-native |
| Blockchain | viem (v2.43+) | Native Tempo support |
| Charts | Recharts | Lightweight, composable, works with React/Next.js |
| Cache | Redis (ioredis) | Fast in-process query cache |
| Styling | Tailwind CSS | Fast iteration |
| Container | Docker (alongside tidx) | Consistent with existing setup |
| Edge | Cloudflare free tier | DDoS + edge cache |

---

## Deployment

Added to `~/tidx/docker-compose.yml`:

```yaml
explorer:
  build: ./explorer
  ports:
    - "127.0.0.1:3000:3000"
  environment:
    TIDX_URL: http://tidx:8080
    REDIS_URL: redis://redis:6379
  depends_on:
    - tidx
    - redis
  restart: unless-stopped

redis:
  image: redis:7-alpine
  volumes:
    - redis_data:/data
  restart: unless-stopped

nginx:
  image: nginx:alpine
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf:ro
    - nginx_cache:/var/cache/nginx
  restart: unless-stopped
```

### Domain
TBD — no domain pointed at the machine yet. When ready: point DNS to the machine's IP, configure Nginx for TLS (Let's Encrypt via certbot), enable Cloudflare proxy.

---

## What Ships First vs Later

### Ships with infrastructure (now)
- Next.js app skeleton with all page routes defined
- Redis cache layer wired up
- Nginx config with proxy_cache
- MPP export endpoint (402 flow, credential verification, CSV stream)
- Overview page (`/`) with live network stats
- Block list (`/blocks`) and tx detail (`/tx/[hash]`)
- Address page (`/address/[addr]`)
- Analytics hub page (`/analytics`) with placeholder cards
- Docker services added to compose

### Added after data backfills
- Individual analytics chart pages (`/analytics/[slug]`)
- Chart content decisions based on actual data exploration
- Any additional Tempo-specific views discovered during data analysis

---

## Out of Scope
- Public API (no `/api/v1/*` endpoints for external consumers)
- User accounts or saved dashboards
- Real-time WebSocket streaming (ISR polling is sufficient)
- Mobile app
- Alerting/notifications (can add later with MPP)
