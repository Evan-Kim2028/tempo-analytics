-- @name:         mv_protocol_dex_pool_dau_daily
-- @domain:       dex
-- @kind:         backfill
-- @purpose:      Historical backfill for mv_protocol_dex_pool_dau_daily.
-- @pairs:        sql/clickhouse/views/dex/mv_protocol_dex_pool_dau_daily.sql
-- @owner:        evan
-- @since:        2026-04-15
--

INSERT INTO tidx_4217.mv_protocol_dex_pool_dau_daily
SELECT
  toDate(block_timestamp)                                               AS day,
  reinterpretAsUInt64(reverse(unhex(substring(topic1, 51, 16))))       AS pool_id,
  '0x' || lower(substring(topic3, 27))                                 AS token,
  uniqState('0x' || lower(substring(topic2, 27)))                      AS dau_state
FROM tidx_4217.logs
WHERE address  = '0xdec0000000000000000000000000000000000000'
  AND selector = '0x16c08f8f2c17b3c8879b3e3cf5efdbdcdfdbd0fcb3890f9d3086f470cd601ddd'
GROUP BY day, pool_id, token;
