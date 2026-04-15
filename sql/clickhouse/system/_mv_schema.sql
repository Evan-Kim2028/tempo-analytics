-- @name:    _mv_schema
-- @domain:  system
-- @kind:    system
-- @purpose: Tracks the last-applied DDL hash and text for every managed MV, used by apply-clickhouse-assets.sh for drift detection.
-- @owner:   evan
-- @since:   2026-04-15

CREATE TABLE IF NOT EXISTS tidx_4217._mv_schema
(
  name        String,
  ddl_hash    String,
  ddl_text    String,
  applied_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(applied_at)
ORDER BY name;
