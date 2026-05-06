-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Bug-Tracker + dynamische Roadmap + Patch-Notes
--
--   wrangler d1 execute custosoft-db --remote \
--     --file=scripts/create_bug_roadmap_patchnotes.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Bug-Reports ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bug_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT,                    -- optional: anonyme Reports erlaubt
  user_email      TEXT,                    -- denormalisiert für schnellen Display
  user_name       TEXT,
  title           TEXT    NOT NULL,
  description     TEXT,                    -- Markdown
  severity        TEXT    NOT NULL DEFAULT 'medium',  -- 'low'|'medium'|'high'|'critical'
  status          TEXT    NOT NULL DEFAULT 'new',     -- 'new'|'investigating'|'fixed'|'wontfix'|'duplicate'
  platform        TEXT,                    -- 'ios'|'ipad'|'mac'|'web'|'all'
  app_version     TEXT,
  attachments     TEXT,                    -- JSON array of {url, name, type, bytes}
  internal_note   TEXT,                    -- Admin-only
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status   ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_when     ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user     ON bug_reports(user_id);

-- ── Roadmap-Items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roadmap_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter         TEXT,                    -- z.B. 'Live', 'Q3 2026', 'Vision'
  title           TEXT    NOT NULL,
  description     TEXT,
  status          TEXT    NOT NULL DEFAULT 'later',  -- 'done'|'now'|'next'|'later'
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_public       INTEGER NOT NULL DEFAULT 1,        -- 1 = auf Landing-Page sichtbar
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_roadmap_sort ON roadmap_items(sort_order ASC);

-- ── Patch-Notes (Versions-Logs) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patch_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  version         TEXT    NOT NULL,        -- '1.7', '1.6', etc.
  title           TEXT,
  body_html       TEXT,                    -- HTML, vom Admin direkt editierbar
  body_markdown   TEXT,                    -- Markdown-Quelle (optional)
  platform        TEXT    NOT NULL DEFAULT 'all',  -- 'ios'|'mac'|'web'|'all'
  released_at     TEXT,
  is_published    INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_patch_notes_when  ON patch_notes(released_at DESC);

-- Seed: bestehende Roadmap-Einträge aus dem Code übernehmen
INSERT OR IGNORE INTO roadmap_items (quarter, title, description, status, sort_order) VALUES
  ('Live',   'iOS · iPadOS · macOS',          'Im App Store + TestFlight Beta verfügbar. Alle Kern-Features production.', 'done',  10),
  ('Q3',     'Webapp (du bist hier!)',        'Browser-Version mit Login, Dashboard, Chat. Kein Download nötig.',         'now',   20),
  ('Q4',     'Android (Kotlin)',              'Native Android-App, gleiche API, gleiche Features wie iOS.',                'next',  30),
  ('2027',   'watchOS Companion',             'Stempeluhr direkt von der Apple Watch.',                                    'later', 40),
  ('2027',   'Slack/Teams Integration',       'Notifications + Bot-Commands für Cross-Plattform-Teams.',                   'later', 50),
  ('Vision', 'visionOS Spatial-Workflow',     'Räumliche Mitarbeiter-Karten, immersive Stats.',                            'later', 60);

-- Seed: erste Patch-Note (1.7)
INSERT OR IGNORE INTO patch_notes (version, title, body_html, platform, released_at, sort_order) VALUES
  ('1.7', 'Launch Sale, Live Activity, Webapp Beta',
   '<ul><li>Stempeluhr 3,99 €/Monat (Launch Sale: vorher 4,99 €)</li><li>Live Activity in der Dynamic Island</li><li>Mac-Menüleisten-Item</li><li>Avatar-Upload, Chat-Datei-Anhänge mit PDF-Vorschau</li><li>Push-Notifications + Mitteilungszentrale</li><li>Lohnbuchhaltungs-Export pro Mitarbeiter</li><li>Webapp Beta öffnet</li></ul>',
   'all', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 100);

-- Sanity check
SELECT 'bug_reports'   AS tbl, COUNT(*) AS rows FROM bug_reports
UNION ALL SELECT 'roadmap_items',  COUNT(*) FROM roadmap_items
UNION ALL SELECT 'patch_notes',    COUNT(*) FROM patch_notes;
