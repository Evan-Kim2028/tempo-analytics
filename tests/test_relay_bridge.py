from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


def _load_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "relay_bridge.py"
    spec = importlib.util.spec_from_file_location("relay_bridge", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load relay_bridge module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RelayBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = _load_module()

    def test_get_evm_address_uses_the_named_wallet_block(self) -> None:
        wallet_list_output = """ID: first
Name:    tmp-sol
Secured: ✓ (encrypted)
  eip155:1 → 0xfeB611C56958563CEBdA885af8f4fC102208E3B1

ID: second
Name:    sui-trading
Secured: ✓ (encrypted)
  eip155:1 → 0x54465c7D62FE23Ace5EBEaE88016731Cb2017cc1
"""

        with patch.object(
            self.module.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                args=["ows", "wallet", "list"],
                returncode=0,
                stdout=wallet_list_output,
                stderr="",
            ),
        ):
            address = self.module.get_evm_address("sui-trading")

        self.assertEqual(
            address,
            "0x54465c7D62FE23Ace5EBEaE88016731Cb2017cc1",
        )

    def test_get_evm_address_raises_when_wallet_is_missing(self) -> None:
        with patch.object(
            self.module.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                args=["ows", "wallet", "list"],
                returncode=0,
                stdout="Name:    tmp-sol\n  eip155:1 → 0xfeB611C56958563CEBdA885af8f4fC102208E3B1\n",
                stderr="",
            ),
        ):
            with self.assertRaisesRegex(
                RuntimeError, "No EVM address found for wallet missing-wallet"
            ):
                self.module.get_evm_address("missing-wallet")


if __name__ == "__main__":
    unittest.main()
