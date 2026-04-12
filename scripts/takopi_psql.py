from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PSQL = "/usr/bin/psql"
DEFAULT_PGHOST = "127.0.0.1"
DEFAULT_PGPORT = "5432"
DEFAULT_PGUSER = "tidx"
DEFAULT_PGDATABASE = "tidx_mainnet"


def resolve_repo_path(raw_path: str, *, repo_root: Path = REPO_ROOT) -> Path:
    root = repo_root.resolve()
    candidate = Path(raw_path)
    resolved = (root / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"path escapes repo root: {raw_path}")
    if not resolved.is_file():
        raise ValueError(f"file not found: {raw_path}")
    return resolved


def build_psql_argv(mode: str, payload: str) -> list[str]:
    argv = [
        DEFAULT_PSQL,
        "--host",
        os.environ.get("TAKOPI_TEMPO_PGHOST", DEFAULT_PGHOST),
        "--port",
        os.environ.get("TAKOPI_TEMPO_PGPORT", DEFAULT_PGPORT),
        "--username",
        os.environ.get("TAKOPI_TEMPO_PGUSER", DEFAULT_PGUSER),
        "--dbname",
        os.environ.get("TAKOPI_TEMPO_PGDATABASE", DEFAULT_PGDATABASE),
    ]
    if mode == "query":
        return [*argv, "--command", payload]
    if mode == "file":
        return [*argv, "--file", str(resolve_repo_path(payload))]
    raise ValueError(f"unsupported mode: {mode}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--query")
    mode.add_argument("--file")
    args = parser.parse_args(argv)

    os.environ.setdefault("PGPASSWORD", os.environ.get("POSTGRES_PASSWORD", "tidx"))
    command = (
        build_psql_argv("query", args.query)
        if args.query is not None
        else build_psql_argv("file", args.file)
    )
    completed = subprocess.run(command, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
