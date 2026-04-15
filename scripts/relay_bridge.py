"""Bridge USDC from Base to Tempo via Relay.

Reusable script for bridging ERC-20 tokens between EVM chains using
the Relay API (https://api.relay.link). Signs transactions via OWS CLI.

Usage:
    python scripts/relay_bridge.py --wallet sui-trading --amount 2.0
    python scripts/relay_bridge.py --wallet sui-trading --amount 2.0 --dry-run

Requires:
    - OWS CLI installed and wallet configured with EVM account
    - rlp package (available in on_chain_trading/.venv)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_CHAIN_ID = 8453
TEMPO_CHAIN_ID = 4217
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
TEMPO_USDC_E = "0x20c000000000000000000000b9537d11c60e8b50"
USDC_DECIMALS = 6

RELAY_API = "https://api.relay.link"

BASE_RPCS: list[str] = [
    "https://1rpc.io/base",
    "https://base-rpc.publicnode.com",
    "https://mainnet.base.org",
]

# ---------------------------------------------------------------------------
# RPC helpers
# ---------------------------------------------------------------------------


def _base_rpc_call(method: str, params: list[Any], *, timeout: int = 10) -> Any:
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    last_exc: Exception | None = None
    for rpc in BASE_RPCS:
        try:
            req = urllib.request.Request(
                rpc,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "takopi-relay-bridge/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read())
            if "error" in body:
                raise RuntimeError(f"RPC error from {rpc}: {body['error']}")
            return body["result"]
        except Exception as exc:
            last_exc = exc
    raise RuntimeError(f"All Base RPCs failed; last error: {last_exc}") from last_exc


def fetch_usdc_balance(address: str) -> int:
    padded = address.lower().replace("0x", "").zfill(64)
    calldata = "0x70a08231" + padded
    hex_result = _base_rpc_call("eth_call", [{"to": BASE_USDC, "data": calldata}, "latest"])
    return int(hex_result, 16)


def fetch_eth_balance(address: str) -> int:
    hex_result = _base_rpc_call("eth_getBalance", [address, "latest"])
    return int(hex_result, 16)


def fetch_nonce(address: str) -> int:
    hex_result = _base_rpc_call("eth_getTransactionCount", [address, "pending"])
    return int(hex_result, 16)


def wait_for_receipt(tx_hash: str, *, timeout: int = 120, poll: int = 3) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = _base_rpc_call("eth_getTransactionReceipt", [tx_hash])
        if result is not None:
            return result
        time.sleep(poll)
    raise RuntimeError(f"Timed out waiting for receipt: {tx_hash}")


# ---------------------------------------------------------------------------
# OWS signing
# ---------------------------------------------------------------------------


def get_evm_address(wallet: str) -> str:
    result = subprocess.run(
        ["ows", "wallet", "list"], capture_output=True, text=True, check=True
    )
    current_wallet: str | None = None
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("Name:"):
            current_wallet = stripped.split("Name:", 1)[1].strip()
            continue
        if current_wallet != wallet:
            continue
        if stripped.startswith("eip155:1") and "→" in stripped:
            addr = stripped.split("→")[-1].strip()
            return addr
    raise RuntimeError(f"No EVM address found for wallet {wallet}")


def build_and_sign_tx(
    wallet: str,
    *,
    to: str,
    data: str,
    value: str,
    gas: int,
    max_fee_per_gas: int,
    max_priority_fee_per_gas: int,
    nonce: int,
    chain_id: int = BASE_CHAIN_ID,
) -> str:
    """Build an EIP-1559 tx and sign it via OWS, returning the signed hex."""
    import pathlib
    _vendor = str(pathlib.Path(__file__).resolve().parent / "_vendor")
    if _vendor not in sys.path:
        sys.path.insert(0, _vendor)
    import rlp

    to_bytes = bytes.fromhex(to.replace("0x", ""))
    data_bytes = bytes.fromhex(data.replace("0x", ""))
    value_int = int(value, 16) if value.startswith("0x") else int(value)

    fields = [
        chain_id,
        nonce,
        max_priority_fee_per_gas,
        max_fee_per_gas,
        gas,
        to_bytes,
        value_int.to_bytes(max(1, (value_int.bit_length() + 7) // 8), "big") if value_int else b"",
        data_bytes,
        [],  # access_list
    ]

    encoded = rlp.encode(fields)
    raw = b"\x02" + encoded
    return raw.hex()


def send_evm_tx(*, wallet: str, tx_hex: str, chain: str = "base") -> dict[str, Any]:
    result = subprocess.run(
        ["ows", "sign", "send-tx", "--wallet", wallet, "--chain", chain,
         "--tx", tx_hex, "--json"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


# ---------------------------------------------------------------------------
# Relay API
# ---------------------------------------------------------------------------


def relay_quote(
    *,
    user: str,
    amount_raw: int,
    origin_chain: int = BASE_CHAIN_ID,
    dest_chain: int = TEMPO_CHAIN_ID,
    origin_currency: str = BASE_USDC,
    dest_currency: str = TEMPO_USDC_E,
) -> dict[str, Any]:
    body = json.dumps({
        "user": user,
        "originChainId": origin_chain,
        "destinationChainId": dest_chain,
        "originCurrency": origin_currency,
        "destinationCurrency": dest_currency,
        "amount": str(amount_raw),
        "tradeType": "EXACT_INPUT",
    }).encode()
    req = urllib.request.Request(
        f"{RELAY_API}/quote/v2",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    if "message" in result and "steps" not in result:
        raise RuntimeError(f"Relay quote failed: {result['message']}")
    return result


def relay_status(request_id: str) -> dict[str, Any]:
    url = f"{RELAY_API}/intents/status/v3?requestId={request_id}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def poll_relay_status(
    request_id: str, *, max_wait: int = 300, poll_interval: int = 5
) -> dict[str, Any]:
    deadline = time.monotonic() + max_wait
    while True:
        status = relay_status(request_id)
        state = status.get("status", "unknown")
        print(f"  Bridge status: {state}")
        if state == "success":
            return status
        if state in ("failed", "refunded"):
            raise RuntimeError(f"Bridge failed: {json.dumps(status, indent=2)}")
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Bridge timed out after {max_wait}s; last: {state}")
        time.sleep(poll_interval)


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------


def bridge(
    *,
    wallet: str,
    address: str,
    amount_usdc: float,
    dry_run: bool = False,
) -> None:
    amount_raw = int(amount_usdc * 10**USDC_DECIMALS)

    # Pre-flight checks
    usdc_bal = fetch_usdc_balance(address)
    eth_bal = fetch_eth_balance(address)
    print(f"Wallet:      {address}")
    print(f"USDC bal:    {usdc_bal / 1e6:.6f}")
    print(f"ETH bal:     {eth_bal / 1e18:.8f}")
    print(f"Bridge amt:  {amount_usdc} USDC")
    print()

    if usdc_bal < amount_raw:
        print(f"ERROR: Insufficient USDC — have {usdc_bal / 1e6}, need {amount_usdc}")
        sys.exit(1)
    if eth_bal < 100_000_000_000:  # 0.0000001 ETH — very conservative floor
        print("ERROR: No ETH for gas")
        sys.exit(1)

    # Get quote
    print("Fetching Relay quote...")
    quote = relay_quote(user=address, amount_raw=amount_raw)
    details = quote.get("details", {})
    fees = quote.get("fees", {})
    out = details.get("currencyOut", {})
    print(f"  Output:    {out.get('amountFormatted', '?')} USDC.e on Tempo")
    print(f"  Fee:       ~${fees.get('relayer', {}).get('amountUsd', '?')}")
    print(f"  ETA:       ~{details.get('timeEstimate', '?')}s")
    print()

    steps = quote.get("steps", [])
    request_id = steps[-1].get("requestId", "") if steps else ""

    if dry_run:
        print("DRY RUN — would execute these steps:")
        for step in steps:
            print(f"  [{step['id']}] {step['description']}")
            for item in step.get("items", []):
                d = item["data"]
                print(f"    to:   {d['to']}")
                print(f"    gas:  {d.get('gas', 'N/A')}")
        print(f"\n  requestId: {request_id}")
        return

    # Execute steps
    nonce = fetch_nonce(address)
    for step in steps:
        step_id = step["id"]
        print(f"Step: {step_id} — {step['description']}")

        for item in step.get("items", []):
            d = item["data"]
            tx_hex = build_and_sign_tx(
                wallet,
                to=d["to"],
                data=d["data"],
                value=d.get("value", "0"),
                gas=int(d.get("gas", "100000")),
                max_fee_per_gas=int(d.get("maxFeePerGas", "10000000")),
                max_priority_fee_per_gas=int(d.get("maxPriorityFeePerGas", "1000000")),
                nonce=nonce,
            )
            print(f"  Signing and sending via OWS...")
            result = send_evm_tx(wallet=wallet, tx_hex=tx_hex)
            tx_hash = result.get("hash") or result.get("txHash") or result.get("tx_hash", "")
            print(f"  TX: {tx_hash}")

            if tx_hash:
                print(f"  Waiting for confirmation...")
                receipt = wait_for_receipt(tx_hash)
                status = int(receipt.get("status", "0x0"), 16)
                if status != 1:
                    print(f"  ERROR: Transaction reverted!")
                    sys.exit(1)
                print(f"  Confirmed in block {int(receipt['blockNumber'], 16)}")

            nonce += 1
        print()

    # Poll bridge completion
    if request_id:
        print(f"Polling bridge status (requestId: {request_id})...")
        final = poll_relay_status(request_id)
        print(f"\nBridge complete!")
        tx_hashes = final.get("txHashes", {})
        if isinstance(tx_hashes, list):
            tx_out = tx_hashes
        else:
            tx_out = tx_hashes.get("destination", [])
        if tx_out:
            print(f"Tempo TX: {tx_out}")
    else:
        print("No requestId — check Relay manually")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bridge USDC from Base to Tempo via Relay")
    parser.add_argument("--wallet", required=True, help="OWS wallet name (e.g. sui-trading)")
    parser.add_argument("--amount", type=float, required=True, help="USDC amount to bridge")
    parser.add_argument("--address", help="Override EVM address (default: derived from OWS wallet)")
    parser.add_argument("--dry-run", action="store_true", help="Show quote and steps without executing")
    args = parser.parse_args()

    if args.address:
        address = args.address
    else:
        print(f"Resolving EVM address for wallet '{args.wallet}'...")
        address = get_evm_address(args.wallet)
        print(f"  → {address}")

    bridge(
        wallet=args.wallet,
        address=address,
        amount_usdc=args.amount,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
