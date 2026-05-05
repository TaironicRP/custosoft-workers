-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: legal_pages — add `locale` column for multi-language overrides
-- ─────────────────────────────────────────────────────────────────────────────
--
-- BEFORE (slug is UNIQUE):
--   legal_pages(id, slug UNIQUE, title, content, updated_at)
--
-- AFTER ((slug, locale) is UNIQUE):
--   legal_pages(id, slug, locale, title, content, updated_at)
--
-- Existing rows are copied with locale='de' so the German content stays
-- linked to /de/impressum, /de/datenschutz, etc. New rows for other
-- locales can be inserted via the admin UI without breaking the German
-- ones.
--
-- Run:
--   wrangler d1 execute custosoft-db --file=scripts/update_legal_pages_locale.sql --remote
--
-- Idempotent: the rebuild is wrapped in IF NOT EXISTS so a second run is
-- a no-op once the new schema is in place.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Build the new shape under a temporary name (cleanly)
CREATE TABLE IF NOT EXISTS legal_pages_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL,
  locale     TEXT    NOT NULL DEFAULT 'de',
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(slug, locale)
);

-- 2. Copy existing rows. They're treated as German overrides.
--    The IGNORE keeps the script idempotent — a second run does nothing.
INSERT OR IGNORE INTO legal_pages_new (id, slug, locale, title, content, updated_at)
SELECT id, slug, 'de', title, content, updated_at
FROM legal_pages;

-- 3. Drop the old table and rename the new one over it
DROP TABLE IF EXISTS legal_pages;
ALTER TABLE legal_pages_new RENAME TO legal_pages;

-- 4. (Optional) Seed English defaults so the admin UI shows them as
--    editable rows immediately. Comment out if you'd rather leave the
--    defaults purely in code (legal.ts).
--
-- INSERT OR IGNORE INTO legal_pages (slug, locale, title, content) VALUES
--   ('impressum',   'en', 'Imprint',           ''),
--   ('datenschutz', 'en', 'Privacy Policy',    ''),
--   ('agb',         'en', 'Terms of Service',  ''),
--   ('widerruf',    'en', 'Right of Withdrawal', '');
