# Tempo Analytics Project Instructions

## Wallet and payment rules

- Use existing scripts before inventing one-off wallet or bridge flows.
- Dry-run first for bridge work. Require explicit user confirmation before any
  live bridge, transfer, or payment send.

## Current Tempo payment path

- MPP export payments are on Tempo mainnet and cost $0.01 in USDC.e or pathUSD.
- The working bridge route is Base USDC -> Tempo USDC.e via Relay.
- The intended wallet is `sui-trading`.
- Use `takopi wallet list` to discover brokered OWS wallets.
- Use `takopi wallet transfer ... --memo ...` for Tempo export payments. Do not call raw `ows` directly from a Takopi session.
- Use `takopi wallet bridge` for the Relay bridge helper.

## Preferred commands

All privileged/runtime actions in Takopi sessions must go through `takopi`
only.

```bash
takopi wallet list
takopi wallet bridge sui-trading 2.0 --dry-run
takopi wallet bridge sui-trading 2.0
takopi wallet transfer sui-trading 0xc8BDAEDEcB05001B5EC22D273393792274f59281 0.01 --chain tempo --token 0x20c000000000000000000000b9537d11c60e8b50 --decimals 6 --memo 0x...
takopi db psql --query "SELECT 1"
takopi db clickhouse --query "SELECT 1"
takopi service status takopi-tempo-explorer.service
takopi service restart takopi-tempo-explorer.service
takopi service restart takopi-tempo-stack.service
node scripts/e2e-payment-test.mjs
```
