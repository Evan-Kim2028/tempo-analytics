-- @name:         mv_dex_daily
-- @domain:       dex
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_dex_daily.
-- @pairs:        sql/clickhouse/views/dex/mv_dex_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_dex_daily
SELECT toDate(block_timestamp), address, count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;
