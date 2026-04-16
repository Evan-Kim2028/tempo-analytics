from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


class ValidateDataScriptTests(unittest.TestCase):
    def _run_validate_script(self, fake_curl_source: str) -> subprocess.CompletedProcess[str]:
        repo_root = Path(__file__).resolve().parents[1]
        script = repo_root / "scripts" / "validate-data.sh"

        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = Path(tmpdir)
            fake_curl = bin_dir / "curl"
            fake_curl.write_text(textwrap.dedent(fake_curl_source), encoding="utf-8")
            fake_curl.chmod(0o755)

            env = os.environ.copy()
            env.update(
                {
                    "CLICKHOUSE_URL": "http://clickhouse.test:8123",
                    "CLICKHOUSE_DB": "tidx_4217",
                    "TIDX_URL": "http://tidx.test:8080",
                    "PATH": f"{bin_dir}:{env['PATH']}",
                }
            )

            return subprocess.run(
                ["bash", str(script)],
                cwd=repo_root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )

    def _fake_curl(
        self,
        *,
        status_json: str | None = None,
        reject_old_protocol_view: bool = False,
    ) -> str:
        status = status_json or (
            '{"chains":[{"lag":0,'
            '"postgres":{"txs":14905776,"txs_count":1000000},'
            '"clickhouse":{"txs":14905773,"txs_count":1000000}}]}'
        )
        old_protocol_cases = ""
        if not reject_old_protocol_view:
            old_protocol_cases = """
              *"SELECT sum(swaps) FROM"*"mv_protocol_dex_daily"*) echo "50000" ;;
              *"SELECT round(sum(volume_raw)/1e6) FROM"*"mv_protocol_dex_daily"*) echo "1000000" ;;
            """

        return f"""\
        #!/usr/bin/env bash
        set -euo pipefail

        query=""
        url=""
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --data-urlencode)
              echo "ClickHouse SQL must be sent as a raw request body" >&2
              exit 64
              ;;
            --data-binary)
              shift
              if [ "${{1:-}}" = "@-" ]; then
                query="$(cat)"
              else
                query="${{1:-}}"
              fi
              ;;
            http://*|https://*)
              url="$1"
              ;;
          esac
          shift || true
        done

        if [[ "$url" == */status ]]; then
          printf '%s\n' '{status}'
          exit 0
        fi

        case "$query" in
          *"SELECT count() FROM"*"txs"*) echo "17850534" ;;
          *"SELECT uniq(day) FROM"*"mv_daily_stats"*) echo "30" ;;
          *"SELECT uniq(day) FROM"*"mv_daily_uniq"*) echo "30" ;;
          *"SELECT sum(count) FROM"*"mv_inscription_daily"*) echo "1000" ;;
          *"WHERE token='0x20c0000000000000000000000000000000000000'"*) echo "34000000" ;;
          *"mv_fee_token_daily"*) echo "1000" ;;
          *"SELECT sum(swap_count) FROM"*"mv_dex_daily"*) echo "42" ;;
          *"SELECT sum(swap_count) FROM"*"mv_dex_swap_amounts_daily"*) echo "42" ;;
          *"SELECT sum(swaps) FROM"*"mv_protocol_dex_volume_totals_daily"*) echo "50000" ;;
          *"SELECT round(sum(volume_raw)/1e6) FROM"*"mv_protocol_dex_volume_totals_daily"*) echo "1000000" ;;
        {textwrap.indent(textwrap.dedent(old_protocol_cases).strip(), "  ")}
          *"WHERE token='0x20c000000000000000000000b9537d11c60e8b50'"*) echo "21000000" ;;
          *"SELECT sum(transfers) FROM"*"mv_nft_daily"*) echo "100000" ;;
          *)
            echo "unhandled query: $query" >&2
            exit 65
            ;;
        esac
        """

    def test_validate_data_posts_clickhouse_sql_as_raw_body(self) -> None:
        result = self._run_validate_script(self._fake_curl())

        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("PASS: all checks passed", result.stdout)

    def test_validate_data_accepts_matching_watermarks_when_retained_counts_differ(self) -> None:
        status = (
            '{"chains":[{"lag":0,'
            '"postgres":{"txs":14905776,"txs_count":874833},'
            '"clickhouse":{"txs":14905773,"txs_count":17850998}}]}'
        )

        result = self._run_validate_script(self._fake_curl(status_json=status))

        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("PASS: TIDX lag 0 blocks", result.stdout)

    def test_validate_data_uses_current_protocol_dex_volume_totals_view(self) -> None:
        result = self._run_validate_script(
            self._fake_curl(reject_old_protocol_view=True)
        )

        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("Protocol DEX swaps: 50000, volume: $1000000", result.stdout)


if __name__ == "__main__":
    unittest.main()
