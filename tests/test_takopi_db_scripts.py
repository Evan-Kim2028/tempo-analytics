from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest


def _load_module(script_name: str, module_name: str):
    script_path = Path(__file__).resolve().parents[1] / "scripts" / script_name
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {script_name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TakopiDbScriptTests(unittest.TestCase):
    def test_psql_builds_query_command(self) -> None:
        module = _load_module("takopi_psql.py", "takopi_psql")

        argv = module.build_psql_argv("query", "SELECT 1")

        self.assertEqual(
            argv,
            [
                "/usr/bin/psql",
                "--host",
                "127.0.0.1",
                "--port",
                "5432",
                "--username",
                "tidx",
                "--dbname",
                "tidx_mainnet",
                "--command",
                "SELECT 1",
            ],
        )

    def test_clickhouse_loads_repo_local_query_file(self) -> None:
        module = _load_module("takopi_clickhouse.py", "takopi_clickhouse")

        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            sql_path = repo_root / "scripts" / "query.sql"
            sql_path.parent.mkdir(parents=True, exist_ok=True)
            sql_path.write_text("SELECT 42", encoding="utf-8")

            query = module.load_query("file", "scripts/query.sql", repo_root=repo_root)

        self.assertEqual(query, "SELECT 42")

    def test_repo_path_rejects_escape(self) -> None:
        module = _load_module("takopi_psql.py", "takopi_psql_escape")

        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            with self.assertRaises(ValueError):
                module.resolve_repo_path("../outside.sql", repo_root=repo_root)


if __name__ == "__main__":
    unittest.main()
