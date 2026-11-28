-- Migration 0029: Privacy-First Analytics, Audience Intelligence, Core Web Vitals RUM & SEO Command Hub
-- Complies with Vietnam Decree 13/2023/ND-CP: zero raw IP addresses stored, zero tracking cookies.

CREATE TABLE IF NOT EXISTS analytics_daily_pages (
  date TEXT NOT NULL,
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  dwell_ms_sum INTEGER NOT NULL DEFAULT 0,
  dwell_count INTEGER NOT NULL DEFAULT 0,
  scroll_sum INTEGER NOT NULL DEFAULT 0,
  scroll_count INTEGER NOT NULL DEFAULT 0,
  lcp_sum INTEGER NOT NULL DEFAULT 0,
  lcp_count INTEGER NOT NULL DEFAULT 0,
  inp_sum INTEGER NOT NULL DEFAULT 0,
  inp_count INTEGER NOT NULL DEFAULT 0,
  cls_x1000_sum INTEGER NOT NULL DEFAULT 0,
  cls_count INTEGER NOT NULL DEFAULT 0,
  ttfb_sum INTEGER NOT NULL DEFAULT 0,
  ttfb_count INTEGER NOT NULL DEFAULT 0,
  cta_clicks INTEGER NOT NULL DEFAULT 0,
  member_views INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date, path)
);

CREATE TABLE IF NOT EXISTS analytics_daily_dims (
  date TEXT NOT NULL,
  dim_type TEXT NOT NULL,
  dim_value TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  dwell_ms_sum INTEGER NOT NULL DEFAULT 0,
  dwell_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date, dim_type, dim_value)
);

CREATE TABLE IF NOT EXISTS analytics_daily_visitors (
  date TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, visitor_hash, scope)
);

CREATE TABLE IF NOT EXISTS analytics_recent_visits (
  id TEXT PRIMARY KEY,
  visited_at TEXT NOT NULL,
  date TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT 'Direct',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  as_org TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'desktop',
  browser TEXT NOT NULL DEFAULT 'Other',
  os TEXT NOT NULL DEFAULT 'Other',
  lang TEXT NOT NULL DEFAULT 'vi',
  is_member INTEGER NOT NULL DEFAULT 0,
  is_returning INTEGER NOT NULL DEFAULT 0,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  scroll_pct INTEGER NOT NULL DEFAULT 0,
  lcp_ms INTEGER NOT NULL DEFAULT 0,
  inp_ms INTEGER NOT NULL DEFAULT 0,
  cls_x1000 INTEGER NOT NULL DEFAULT 0,
  ttfb_ms INTEGER NOT NULL DEFAULT 0,
  goals_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_psi_snapshots (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK(strategy IN ('mobile', 'desktop')),
  perf_score INTEGER NOT NULL DEFAULT 0,
  seo_score INTEGER NOT NULL DEFAULT 0,
  a11y_score INTEGER NOT NULL DEFAULT 0,
  bp_score INTEGER NOT NULL DEFAULT 0,
  fcp_ms INTEGER NOT NULL DEFAULT 0,
  lcp_ms INTEGER NOT NULL DEFAULT 0,
  tbt_ms INTEGER NOT NULL DEFAULT 0,
  cls_x1000 INTEGER NOT NULL DEFAULT 0,
  ttfb_ms INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'pagespeed',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_pages_date ON analytics_daily_pages(date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_dims_lookup ON analytics_daily_dims(dim_type, date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_recent_visited ON analytics_recent_visits(visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_recent_session ON analytics_recent_visits(session_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_psi_created ON analytics_psi_snapshots(created_at DESC);
