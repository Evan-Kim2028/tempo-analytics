import unittest
from mv_ddl import extract_target_ddl, canonicalize_ddl, ddl_hash, extract_columns, DDLError


VIEW_SQL = """\
-- @name: mv_foo
-- @kind: materialized_view

CREATE TABLE IF NOT EXISTS tidx_4217.mv_foo
(
  day    Date,
  count  UInt64
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW IF NOT EXISTS tidx_4217.mv_foo_view
TO tidx_4217.mv_foo
AS SELECT toDate(block_timestamp) AS day, count() AS count
FROM tidx_4217.txs
GROUP BY day;
"""


class TestExtract(unittest.TestCase):
    def test_extracts_create_table_only(self):
        ddl = extract_target_ddl(VIEW_SQL)
        self.assertIn("CREATE TABLE IF NOT EXISTS tidx_4217.mv_foo", ddl)
        self.assertNotIn("CREATE MATERIALIZED VIEW", ddl)
        self.assertNotIn("SELECT", ddl)

    def test_missing_create_table_raises(self):
        with self.assertRaises(DDLError):
            extract_target_ddl("-- @name: x\nCREATE MATERIALIZED VIEW foo AS SELECT 1;")

    def test_missing_create_mv_raises(self):
        with self.assertRaises(DDLError):
            extract_target_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory;")


class TestCanonicalize(unittest.TestCase):
    def test_whitespace_invariant(self):
        a = canonicalize_ddl("CREATE TABLE  foo (  x Int32  ) ENGINE = Memory")
        b = canonicalize_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory")
        self.assertEqual(a, b)

    def test_strips_line_comments(self):
        a = canonicalize_ddl("CREATE TABLE foo (x Int32) -- trailing\nENGINE = Memory")
        b = canonicalize_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory")
        self.assertEqual(a, b)

    def test_case_insensitive_keywords(self):
        a = canonicalize_ddl("create table foo (x Int32) engine = Memory")
        b = canonicalize_ddl("CREATE TABLE foo (x Int32) ENGINE = Memory")
        self.assertEqual(a, b)

    def test_hash_stable(self):
        self.assertEqual(ddl_hash(VIEW_SQL), ddl_hash(VIEW_SQL.replace("\n\n", "\n")))


class TestExtractColumns(unittest.TestCase):
    def test_basic(self):
        cols = extract_columns(extract_target_ddl(VIEW_SQL))
        self.assertEqual(cols, ["day", "count"])

    def test_handles_nested_parens(self):
        ddl = "CREATE TABLE x (a Array(UInt64), b Tuple(UInt8, String)) ENGINE = Memory"
        cols = extract_columns(ddl)
        self.assertEqual(cols, ["a", "b"])


if __name__ == "__main__":
    unittest.main()
