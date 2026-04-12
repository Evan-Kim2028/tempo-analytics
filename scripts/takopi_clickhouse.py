from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CLICKHOUSE_URL = "http://127.0.0.1:8123"
DEFAULT_CLICKHOUSE_DATABASE = "tidx_4217"


def resolve_repo_path(raw_path: str, *, repo_root: Path = REPO_ROOT) -> Path:
    root = repo_root.resolve()
    candidate = Path(raw_path)
    resolved = (root / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"path escapes repo root: {raw_path}")
    if not resolved.is_file():
        raise ValueError(f"file not found: {raw_path}")
    return resolved


def load_query(mode: str, payload: str, *, repo_root: Path = REPO_ROOT) -> str:
    if mode == "query":
        return payload
    if mode == "file":
        return resolve_repo_path(payload, repo_root=repo_root).read_text(encoding="utf-8")
    raise ValueError(f"unsupported mode: {mode}")


def _clickhouse_endpoint() -> str:
    base_url = os.environ.get("TAKOPI_TEMPO_CLICKHOUSE_URL", DEFAULT_CLICKHOUSE_URL).rstrip("/")
    database = urllib.parse.quote(
        os.environ.get("TAKOPI_TEMPO_CLICKHOUSE_DATABASE", DEFAULT_CLICKHOUSE_DATABASE),
        safe="",
    )
    return f"{base_url}/?database={database}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--query")
    mode.add_argument("--file")
    args = parser.parse_args(argv)

    query = (
        load_query("query", args.query)
        if args.query is not None
        else load_query("file", args.file)
    )
    request = urllib.request.Request(
        _clickhouse_endpoint(),
        data=query.encode("utf-8"),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            sys.stdout.buffer.write(response.read())
    except urllib.error.HTTPError as exc:
        body = exc.read()
        if body:
            sys.stderr.buffer.write(body)
            if not body.endswith(b"\n"):
                sys.stderr.write("\n")
        else:
            print(str(exc), file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
