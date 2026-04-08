# Wallet Auto-Sign for mppx Export Paywall

**Date:** 2026-04-08  
**Status:** Approved

## Problem

The current ExportButton shows payment instructions and requires the user to manually send USDC in a separate wallet app, then copy-paste the transaction hash back into the UI. The mppx payment protocol supports automated verification — the UX just hasn't caught up.

## Goal

One-click export: user clicks "Export CSV", sees a payment prompt, clicks "Pay $0.10" in their browser wallet, approves the transaction, and the CSV downloads automatically. No manual hash pasting.

## Approach

Solana wallet adapter (`@solana/wallet-adapter-react`) for Solana, raw `window.ethereum` (EIP-1193) for Tempo. The asymmetry matches the ecosystem: Solana wallets inject themselves inconsistently so an adapter is necessary; every EVM wallet implements EIP-1193 so no library is needed.

No changes to the server — `/api/export`, mppx setup, and the credential format are unchanged.

## Architecture

### New: `src/providers/WalletProviders.tsx`

Client component. Wraps children with:
- `ConnectionProvider` (Solana RPC URL from env or `https://api.mainnet-beta.solana.com`)
- `WalletProvider` with wallets: Phantom, Solflare, Backpack
- `WalletModalProvider` for the built-in wallet select modal

Added to `src/app/layout.tsx` wrapping `{children}`.

### New: `src/lib/walletPayment.ts`

Two pure async functions. Both resolve with a transaction signature string on success, throw on failure.

**`payWithSolana(challenge, walletAdapter, connection)`**
1. Decode `challenge.request` (base64url → JSON) to get `{ recipient, amount, currency }`
2. Derive payer ATA and recipient ATA via `getAssociatedTokenAddressSync`
3. Build `Transaction` with `createAssociatedTokenAccountIdempotentInstruction` (if recipient ATA absent) + `createTransferInstruction`
4. Set `recentBlockhash` + `feePayer`
5. Sign via `walletAdapter.signTransaction(tx)`
6. Serialize and `sendRawTransaction` via `connection`
7. Await `confirmTransaction` at `confirmed` commitment
8. Return signature string

**`payWithTempo(challenge)`**
1. Decode `challenge.request` to get `{ recipient, amount, currency }` (currency = USDC.e contract address)
2. ABI-encode `transfer(address,uint256)`: selector `0xa9059cbb` + padded recipient + padded amount
3. Call `window.ethereum.request({ method: 'eth_requestAccounts' })` to connect
4. Call `window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: currency, data }] })`
5. Return tx hash string (no explicit confirmation wait — mppx-tempo verifies on-chain)

### Updated: `src/components/ExportButton.tsx`

**New state machine:**
```
idle → challenged → signing → verifying → error
                 ↗ (manual fallback)
```

**Challenged state UI:**
- Method tabs: Tempo (USDC.e) | Solana (USDC) — same as today
- **Solana tab:**
  - If wallet connected: show truncated address + "Pay $0.10" button
  - If not connected: show "Connect Wallet" button (opens adapter modal) + "Pay $0.10" appears after connect
- **Tempo tab:**
  - "Pay $0.10" button (no pre-connect needed — `eth_requestAccounts` is called inline)
- Small "pay manually ↓" toggle below both tabs that reveals the existing hash-paste UI as fallback

**On "Pay $0.10" click:**
1. Set state to `signing`
2. Call `payWithSolana` or `payWithTempo` depending on active method
3. On success: build credential (same `buildCredential` function already in the file), retry export
4. On `verifying` state: show spinner "Verifying payment…"
5. On success response: trigger CSV download (same blob download logic already there)
6. On any error: set state to `error` with message, allow retry

**Wallet connection lifecycle:**
- `useWallet()` hook from `@solana/wallet-adapter-react` — gives `connected`, `connect()`, `signTransaction`, `publicKey`
- Solana wallet state is global (from the provider) — stays connected across button renders
- EVM: stateless — each payment call does `eth_requestAccounts` which is instant if already permitted

## Packages

```
npm install @solana/wallet-adapter-react @solana/wallet-adapter-wallets @solana/wallet-adapter-base
```

`@solana/web3.js` and `@solana/spl-token` are already installed (used by mppx-solana).

No new EVM packages.

## What Doesn't Change

- `/api/export/route.ts` — unchanged
- mppx setup, `MPP_SECRET_KEY`, recipient addresses — unchanged
- The credential wire format (`buildCredential` function) — unchanged
- Manual paste fallback — preserved as a toggle, not removed

## Error Cases

| Situation | Behaviour |
|---|---|
| User rejects wallet popup | Error state: "Transaction rejected" |
| Insufficient USDC balance | Error state: "Insufficient USDC balance" (caught from wallet or RPC) |
| Tx fails on-chain | Error state: "Transaction failed — check your balance" |
| mppx verification fails (race) | Falls back to 402, re-prompts (existing behaviour) |
| No wallet installed (Solana) | "Connect Wallet" opens modal; modal shows "Get Phantom" links |
| No wallet installed (EVM) | Error: "No EVM wallet detected. Install MetaMask or Rabby." |

## Testing

- Manual: connect Phantom on Solana mainnet, click Export CSV on /stablecoins, approve $0.10, confirm CSV downloads
- Manual: connect MetaMask on Tempo mainnet, same flow via Tempo tab
- Existing contract tests in `__tests__/` are unaffected (server-side only)
- The `scripts/mpp-pay-test.mjs` script remains valid for headless testing
