"""Send an ERC-20 token transfer on Tempo mainnet.

Reuses signing and RPC plumbing from relay_bridge.py.

Usage (via takopi):
    takopi tempo transfer sui-trading 0xRECIPIENT 0.01 --dry-run
    takopi tempo transfer sui-trading 0xRECIPIENT 0.01
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from typing import Any

TEMPO_CHAIN_ID = 4217
TEMPO_RPC = "https://rpc.mainnet.tempo.xyz"
TEMPO_USDC_E = "0x20c000000000000000000000b9537d11c60e8b50"
USDC_DECIMALS = 6


def _tempo_rpc_call(method: str, params: list[Any], *, timeout: int = 10) -> Any:
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        TEMPO_RPC,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "takopi-tempo-transfer/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read())
    if "error" in body:
        raise RuntimeError(f"RPC error: {body['error']}")
    return body["result"]


def fetch_usdc_balance(address: str) -> int:
    padded = address.lower().replace("0x", "").zfill(64)
    calldata = "0x70a08231" + padded
    hex_result = _tempo_rpc_call(
        "eth_call", [{"to": TEMPO_USDC_E, "data": calldata}, "latest"]
    )
    return int(hex_result, 16)


def fetch_nonce(address: str) -> int:
    hex_result = _tempo_rpc_call(
        "eth_getTransactionCount", [address, "pending"]
    )
    return int(hex_result, 16)


def fetch_gas_price() -> tuple[int, int]:
    hex_result = _tempo_rpc_call("eth_gasPrice", [])
    gas_price = int(hex_result, 16)
    max_fee = gas_price * 2
    max_priority = gas_price // 10 or 1
    return max_fee, max_priority


def main() -> None:
    # Import signing helpers from relay_bridge (same directory)
    import pathlib

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from relay_bridge import build_and_sign_tx, get_evm_address, send_evm_tx

    parser = argparse.ArgumentParser(
        description="Send USDC.e on Tempo mainnet"
    )
    parser.add_argument("--wallet", required=True)
    parser.add_argument("--to", required=True, help="Recipient address")
    parser.add_argument("--amount", type=float, required=True, help="USDC amount")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Resolving EVM address for wallet '{args.wallet}'...")
    address = get_evm_address(args.wallet)
    print(f"  → {address}")

    usdc_bal = fetch_usdc_balance(address)
    amount_raw = int(args.amount * 10**USDC_DECIMALS)

    print(f"Wallet:      {address}")
    print(f"USDC.e bal:  {usdc_bal / 10**USDC_DECIMALS}")
    print(f"Transfer:    {args.amount} USDC.e → {args.to}")

    if usdc_bal < amount_raw:
        print(f"\nInsufficient USDC.e balance: have {usdc_bal / 10**USDC_DECIMALS}, need {args.amount}")
        sys.exit(1)

    # ERC-20 transfer calldata: transfer(address,uint256)
    to_padded = args.to.lower().replace("0x", "").zfill(64)
    amt_hex = hex(amount_raw)[2:].zfill(64)
    calldata = "0xa9059cbb" + to_padded + amt_hex

    nonce = fetch_nonce(address)
    max_fee, max_priority = fetch_gas_price()
    gas_limit = 65000

    if args.dry_run:
        print(f"\nDRY RUN — would send ERC-20 transfer:")
        print(f"  to contract: {TEMPO_USDC_E}")
        print(f"  recipient:   {args.to}")
        print(f"  amount:      {args.amount} USDC.e ({amount_raw} raw)")
        print(f"  gas:         {gas_limit}")
        print(f"  nonce:       {nonce}")
        return

    print(f"\nSigning and sending...")
    tx_hex = build_and_sign_tx(
        args.wallet,
        to=TEMPO_USDC_E,
        data=calldata,
        value="0",
        gas=gas_limit,
        max_fee_per_gas=max_fee,
        max_priority_fee_per_gas=max_priority,
        nonce=nonce,
        chain_id=TEMPO_CHAIN_ID,
    )

    result = send_evm_tx(wallet=args.wallet, tx_hex=tx_hex, chain="eip155:4217")
    tx_hash = result.get("hash") or result.get("txHash") or str(result)
    print(f"  TX: {tx_hash}")

    print("  Waiting for confirmation...")
    import time
    for _ in range(40):
        receipt = _tempo_rpc_call("eth_getTransactionReceipt", [tx_hash])
        if receipt is not None:
            status = int(receipt.get("status", "0x0"), 16)
            block = int(receipt.get("blockNumber", "0x0"), 16)
            if status == 1:
                print(f"  Confirmed in block {block}")
            else:
                print(f"  REVERTED in block {block}")
                sys.exit(1)
            break
        time.sleep(3)
    else:
        print("  Timed out waiting for receipt")
        sys.exit(1)

    print(f"\nTransfer complete!")
    print(f"TX hash: {tx_hash}")


if __name__ == "__main__":
    main()
