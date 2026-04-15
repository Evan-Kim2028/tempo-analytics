import unittest
from pathlib import Path
import tempfile

from mv_header import parse_header, HeaderError, REQUIRED_VIEW_KEYS, REQUIRED_BACKFILL_KEYS


VALID_VIEW = """\
-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         materialized_view
-- @purpose:      Daily DEX rollup.
-- @upstream:     tidx_4217.logs, tidx_4217.txs
-- @consumers:    src/app/dex/page.tsx, src/lib/analytics.ts::getDexDaily
-- @backfill:     sql/clickhouse/backfills/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--
-- NOTES: free-form.

CREATE TABLE IF NOT EXISTS tidx_4217.mv_dex_daily ( day Date ) ENGINE = SummingMergeTree ORDER BY day;
"""

VALID_BACKFILL = """\
-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         backfill
-- @purpose:      Backfill for mv_dex_daily.
-- @pairs:        sql/clickhouse/views/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15

INSERT INTO tidx_4217.mv_dex_daily SELECT toDate(block_timestamp), 1 FROM tidx_4217.txs;
"""


class TestParseHeader(unittest.TestCase):
    def _write(self, content: str, name: str = "mv_dex_daily.sql") -> Path:
        tmp = Path(tempfile.mkdtemp()) / name
        tmp.write_text(content)
        return tmp

    def test_valid_view_header(self):
        h = parse_header(self._write(VALID_VIEW))
        self.assertEqual(h["name"], "mv_dex_daily")
        self.assertEqual(h["domain"], "dex")
        self.assertEqual(h["kind"], "materialized_view")
        self.assertEqual(h["consumers"], ["src/app/dex/page.tsx", "src/lib/analytics.ts::getDexDaily"])
        self.assertEqual(h["upstream"], ["tidx_4217.logs", "tidx_4217.txs"])

    def test_valid_backfill_header(self):
        h = parse_header(self._write(VALID_BACKFILL, "mv_dex_daily.sql"))
        self.assertEqual(h["kind"], "backfill")
        self.assertEqual(h["pairs"], "sql/clickhouse/views/dex/mv_dex_daily.sql")

    def test_missing_required_key(self):
        bad = VALID_VIEW.replace("-- @purpose:      Daily DEX rollup.\n", "")
        with self.assertRaises(HeaderError) as ctx:
            parse_header(self._write(bad))
        self.assertIn("purpose", str(ctx.exception))

    def test_name_must_match_filename(self):
        with self.assertRaises(HeaderError) as ctx:
            parse_header(self._write(VALID_VIEW, "mv_wrong_name.sql"))
        self.assertIn("@name", str(ctx.exception))

    def test_unknown_kind_rejected(self):
        bad = VALID_VIEW.replace("@kind:         materialized_view", "@kind:         nonsense")
        with self.assertRaises(HeaderError):
            parse_header(self._write(bad))

    def test_required_keys_sets(self):
        self.assertIn("purpose", REQUIRED_VIEW_KEYS)
        self.assertIn("pairs", REQUIRED_BACKFILL_KEYS)


if __name__ == "__main__":
    unittest.main()
