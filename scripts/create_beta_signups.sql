-- Migration: beta_signups table
-- Run: wrangler d1 execute custosoft-db --file=scripts/create_beta_signups.sql --remote

CREATE TABLE IF NOT EXISTS beta_signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  first_name TEXT,
  device     TEXT,       -- 'iphone', 'ipad', 'mac', 'multiple'
  team_size  TEXT,       -- '1', '2-5', '6-20', '20+'
  message    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

SELECT 'beta_signups table ready' AS status;
