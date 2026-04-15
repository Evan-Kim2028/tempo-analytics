"""Extract, canonicalize, and hash the target-table DDL of a view file."""
from __future__ import annotations

import hashlib
import re
from typing import List

_CREATE_TABLE_RE = re.compile(
    r"(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(]+\s*\(.*?\)\s*ENGINE\s*=\s*[^\n;]+(?:\s*ORDER\s+BY\s+[^\n;]+)?(?:\s*PARTITION\s+BY\s+[^\n;]+)?(?:\s*SETTINGS\s+[^\n;]+)?)\s*;",
    re.IGNORECASE | re.DOTALL,
)

_CREATE_MV_RE = re.compile(r"CREATE\s+MATERIALIZED\s+VIEW", re.IGNORECASE)


class DDLError(ValueError):
    pass


def extract_target_ddl(sql_text: str) -> str:
    """Return the CREATE TABLE ... ENGINE ... block of a view file, as a single statement.

    Raises DDLError if the file is missing either the CREATE TABLE or the
    CREATE MATERIALIZED VIEW block.
    """
    if not _CREATE_MV_RE.search(sql_text):
        raise DDLError("no CREATE MATERIALIZED VIEW block found")
    m = _CREATE_TABLE_RE.search(sql_text)
    if not m:
        raise DDLError("no CREATE TABLE ... ENGINE block found")
    return m.group(1).strip()


def canonicalize_ddl(ddl: str) -> str:
    """Normalize whitespace, strip line comments, lowercase keywords."""
    # Strip -- line comments
    lines = [re.sub(r"--.*$", "", line) for line in ddl.splitlines()]
    text = " ".join(line for line in lines if line.strip())
    # Collapse whitespace (including around punctuation)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*([(),])\s*", r"\1", text)
    return text.lower()


def ddl_hash(sql_text: str) -> str:
    """SHA-256 of the canonicalized target-table DDL."""
    ddl = extract_target_ddl(sql_text)
    return hashlib.sha256(canonicalize_ddl(ddl).encode("utf-8")).hexdigest()


def extract_columns(target_ddl: str) -> List[str]:
    """Return column names from a CREATE TABLE block, in declaration order."""
    m = re.search(r"\((.*)\)\s*ENGINE", target_ddl, re.IGNORECASE | re.DOTALL)
    if not m:
        raise DDLError("could not locate column list in DDL")
    body = m.group(1)
    cols: List[str] = []
    depth = 0
    current = ""
    for ch in body:
        if ch == "(":
            depth += 1
            current += ch
        elif ch == ")":
            depth -= 1
            current += ch
        elif ch == "," and depth == 0:
            cols.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        cols.append(current.strip())
    # First token of each entry is the column name
    return [c.split()[0] for c in cols if c.strip()]
