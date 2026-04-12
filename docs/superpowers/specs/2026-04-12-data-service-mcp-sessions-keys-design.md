# Data Service, MCP Server, Export Sessions & Access Keys

**Date:** 2026-04-12
**Status:** Approved

## Problem

tempo-analytics has a single payment surface: CSV export via `/api/export` for $0.01 per query. All other data is free and ungated. There is no machine API, no session-based payment model, and no way for developers to integrate programmatically with stable access.

The mppx SDK provides session payments, access keys, and an MCP SDK — none of which are used. The query catalog and payment composition are hardcoded inside a single route handler, making them inaccessible to new consumer surfaces.

## Goal

Transform tempo-analytics from a dashboard with one paywall into a paid data service with three consumer tiers:

- **Humans** browsing in a browser — deposit-based export credit bundles
- **Agents** (Claude, other AI) — MCP server with per-tool payment
- **Developers** integrating via HTTP — self-service access keys with spending limits

All three tiers share a single query registry and payment layer.

## Approach

Shared Query Registry + Unified Payment Layer (Approach A). Extract the query catalog, mppx payment composition, and query execution into a shared data service. Each consumer surface is a thin adapter over the same data+payment core.

## Architecture

### Layer 1: Data Service (`src/lib/dataService.ts`)

Owns the query catalog, query execution, and response formatting. No payment logic — that lives in the payment layer.

**Query catalog:**

```typescript
interface QueryEntry {
  key: string
  description: string
  engine: 'tidx' | 'clickhouse'
  sql: string
  params?: string[]       // named parameters (e.g., pool-trades takes "token")
  price: string           // default price in smallest units (e.g., "10000" = $0.01 USDC)
}
```

The 11 existing queries from route.ts plus pool-trades move here. Each entry carries its SQL, engine, and default price.

**Interface:**

```typescript
getQueryCatalog(): QueryEntry[]
getQuery(key: string): QueryEntry | undefined
executeQuery(key: string, params?: Record<string, string>): Promise<{ columns: string[], rows: Row[] }>
formatCsv(result: QueryResult): string
formatJson(result: QueryResult): JsonResponse
```

`executeQuery` delegates to `queryTidx` or `queryClickHouse` based on the entry's `engine` field. Parameterized queries (e.g., pool-trades) use an allowlist of parameter names defined in the `QueryEntry.params` array. Values are validated against strict patterns (e.g., hex address for "token") before being interpolated. No raw user input reaches SQL — unknown parameter names are rejected, and values that don't match their expected pattern throw.

### Layer 2: Payment (`src/lib/payments.ts`)

Owns the mppx instance, method configuration, and payment composition. Supports three payment modes.

**mppx setup:**

```typescript
function getPaymentMethods() {
  return {
    charge: [
      tempo.charge({ recipient: TEMPO_RECIPIENT, currency: TEMPO_USDC_E }),
      ...(SOLANA_RECIPIENT ? [solana.charge({ recipient: SOLANA_RECIPIENT, currency: SOLANA_USDC, decimals: 6 })] : []),
    ],
    session: tempo.session({ recipient: TEMPO_RECIPIENT, currency: TEMPO_USDC_E }),
  }
}
```

**Compose helper:**

```typescript
async function composePayment(req: Request, queryEntry: QueryEntry): Promise<PaymentResult>
```

Calls `mppx.compose()` with the query's price. Returns either a 402 challenge or a verified result with `withReceipt`. Handles the "already consumed" retry logic currently in route.ts.

**Session management:**

```typescript
function getSessionBalance(sessionId: string): number
function deductSessionCredit(sessionId: string): boolean
function openSession(depositAmount: string): SessionInfo
function closeSession(sessionId: string): void
```

Session state stored in the mppx Store (in-memory, same as existing replay prevention store).

### Layer 3: Consumer Surfaces

#### HTTP Export (`src/app/api/export/route.ts`)

Shrinks to a thin adapter:

```typescript
export async function POST(req: NextRequest) {
  const { query: queryKey } = await req.json().catch(() => ({}))
  const entry = getQuery(queryKey)
  if (!entry) return NextResponse.json({ error: 'Unknown query' }, { status: 400 })

  const payment = await composePayment(req, entry)
  if (payment.status === 402) return payment.challenge

  const result = await executeQuery(queryKey)
  return payment.wrapResponse(new Response(formatCsv(result), {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="tempo-${queryKey}.csv"` },
  }))
}
```

#### MCP Server

**Files:**

- `src/mcp/server.ts` — MCP server definition, registers tools from query catalog
- `src/mcp/stdio.ts` — stdio transport entry point for local agents
- `src/app/api/mcp/route.ts` — HTTP streamable transport for external agents

**Tool registration:**

Each query entry becomes an MCP tool:

```typescript
for (const entry of getQueryCatalog()) {
  server.tool(
    `tempo_${entry.key.replace(/-/g, '_')}`,
    entry.description,
    entry.params ? { type: 'object', properties: paramSchema(entry.params) } : {},
    async (params) => {
      // mppx MCP SDK handles 402 challenge/credential automatically
      const result = await executeQuery(entry.key, params)
      return formatJson(result)
    }
  )
}
```

**Transport:**

- stdio: `node src/mcp/stdio.ts` — Claude Code connects via MCP config. Payment handled inline by mppx MCP SDK.
- HTTP: Next.js route at `/api/mcp` using streamable HTTP. Same server instance, same payment flow, over HTTP with the mppx 402 challenge.

**Payment for agents:**

The mppx MCP SDK wraps tool calls with payment composition. When an agent calls a tool:

1. Server returns 402 with payment challenge
2. Agent's mppx MCP client handles the challenge (signs, broadcasts, retries)
3. Server verifies credential, executes query, returns data

Agents with an active session or access key pass credentials as context — the 402 step is skipped.

#### Export Sessions

**Deposit balance model with volume discounts:**

| Deposit | Credits | Per-export | Discount |
|---------|---------|------------|----------|
| $0.01   | 1       | $0.01      | —        |
| $0.05   | 6       | ~$0.0083   | 17%      |
| $0.10   | 13      | ~$0.0077   | 23%      |

Custom deposit amounts use the best applicable tier rate. Deposits below $0.05 get 1 credit per $0.01. Deposits of $0.05–$0.09 get credits at the $0.05 tier rate (~$0.0083/credit). Deposits of $0.10+ get credits at the $0.10 tier rate (~$0.0077/credit). Credits are always whole numbers, rounded down.

**Session lifecycle:**

1. **Open**: user clicks "Buy Export Credits" → wallet signs deposit → mppx opens session channel on-chain → server stores session ID + credit balance
2. **Use**: ExportButton checks SessionProvider for credits → submits session voucher (no wallet popup) → server deducts one credit → serves CSV
3. **Close**: balance hits zero, or user clicks "Close Session" (unused deposit returned)

**Client-side:**

`src/providers/SessionProvider.tsx` — React context wrapping the app in layout.tsx.

```typescript
interface SessionContext {
  credits: number
  sessionId: string | null
  openSession(depositAmount: string): Promise<void>
  closeSession(): Promise<void>
}
```

All ExportButton instances read from this context. If `credits > 0`, they skip the payment card and use the session voucher directly. If no session is active, the existing one-shot charge flow works unchanged.

**Server-side:**

`tempo.session()` added as a method in `getPaymentMethods()`. The compose helper accepts session vouchers as an alternative credential type. Session balance tracked in the mppx Store.

**ExportButton changes:**

- Reads `SessionContext` — if credits available, shows "Export CSV (1 credit)" instead of the payment card
- If no session, shows existing payment card with a new "Buy Credits" link that opens the deposit flow
- After successful export via session, decrements credits in context

#### Access Keys (Self-Service API)

**Key provisioning page: `/developers`**

`src/app/developers/page.tsx` — client component with:

- Connect wallet button
- Deposit amount selector with tier pricing table (same discounts as sessions)
- Provision button → signs Tempo KeyAuthorization transaction on-chain
- Active keys list: key (masked), balance remaining, expiry, revoke button
- Usage stats: calls made, credits used, last active
- Code examples panel: curl, TypeScript, Python snippets

**Key provisioning endpoint: `/api/keys`**

`src/app/api/keys/route.ts`:

- `POST /api/keys` — provisions a new key. Body: `{ deposit, expiry? }`. Returns: `{ apiKey, credits, expiresAt }`
- `GET /api/keys` — lists keys for connected wallet (wallet signature required)
- `DELETE /api/keys/:id` — revokes a key, returns unused balance

Keys are derived from the on-chain Tempo KeyAuthorization ID. The API key string maps to the on-chain key, which carries the spending limit and expiry.

**API endpoint: `/api/v1/query`**

`src/app/api/v1/query/route.ts`:

```
POST /api/v1/query
Authorization: Bearer <key>
Content-Type: application/json

{ "query": "stablecoin-daily" }
{ "query": "pool-trades", "params": { "token": "0x..." } }
```

Returns: `{ columns: [...], rows: [...], row_count: N, credits_remaining: N }`

**Middleware: `src/middleware.ts`**

Validates bearer keys on `/api/v1/*` routes:

1. Extract key from `Authorization: Bearer <key>` header
2. Look up on-chain key via Tempo KeyAuthorization (cached with 60s TTL)
3. Check spending limit not exceeded
4. Check expiry not passed
5. Deduct one credit from key balance
6. If valid, proceed to route handler
7. If invalid/expired/depleted, return 401/402 with clear error

**Key lifecycle:**

- Provision: on-chain KeyAuthorization tx with spending limit + expiry (default 30 days)
- Top-up: additional deposit extends balance on same key
- Revoke: developer or server closes the key, unused balance returned on-chain
- Expiry: keys auto-expire after configured duration

## File Map

### New files

| File | Purpose |
|------|---------|
| `src/lib/dataService.ts` | Query catalog, execution, formatting |
| `src/lib/payments.ts` | mppx instance, compose helper, session balance management |
| `src/mcp/server.ts` | MCP server definition with tools from query catalog |
| `src/mcp/stdio.ts` | stdio entry point for local agents |
| `src/app/api/mcp/route.ts` | HTTP streamable MCP transport |
| `src/app/api/v1/query/route.ts` | Access key API endpoint |
| `src/app/api/keys/route.ts` | Key provisioning/management endpoint |
| `src/app/developers/page.tsx` | Self-service developer page |
| `src/providers/SessionProvider.tsx` | Session context for ExportButton |
| `src/middleware.ts` | Access key validation on /api/v1/* |

### Changed files

| File | Change |
|------|--------|
| `src/app/api/export/route.ts` | Thin adapter over dataService + payments |
| `src/components/ExportButton.tsx` | Reads SessionProvider, adds "Buy Credits" flow |
| `src/app/layout.tsx` | Wraps with SessionProvider |
| `src/lib/walletPayment.ts` | Adds session client creation |
| `src/components/nav/PrimaryNav.tsx` | Adds "Developers" nav link |

## Testing

- **Data service**: unit tests for query catalog, execution delegation, CSV/JSON formatting
- **Payments**: unit tests for compose helper, session balance operations, already-consumed retry
- **MCP server**: integration test — register tools, call one, verify JSON response shape
- **Access keys**: unit tests for middleware validation, key provisioning, balance deduction
- **ExportButton**: existing tests updated to mock SessionProvider
- **E2E**: extend `scripts/e2e-payment-test.mjs` to test session flow (open → export × 3 → close)

## What Doesn't Change

- The existing one-shot payment flow works exactly as today when no session is active
- Manual payment fallback (paste tx hash) is preserved
- Chart data functions, recharts components, and all non-payment UI are untouched
- The mppx server methods (tempo.charge, solana.charge) keep their current configuration
- ClickHouse materialized views and TIDX SQL allowlist are unchanged
