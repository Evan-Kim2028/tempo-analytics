-- sql/clickhouse/backfills/dex/mv_dex_swap_amounts_daily.sql
-- Backfill for tidx_4217.mv_dex_swap_amounts_daily
-- Apply after sql/clickhouse/views/dex/mv_dex_swap_amounts_daily.sql

INSERT INTO tidx_4217.mv_dex_swap_amounts_daily
SELECT
  toDate(block_timestamp), address,
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 51,  16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 115, 16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 179, 16))))),
  sum(reinterpretAsUInt64(reverse(unhex(substring(data, 243, 16))))),
  count()
FROM tidx_4217.logs
WHERE selector = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
GROUP BY toDate(block_timestamp), address;
