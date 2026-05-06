-- ============================================================================
--  punch_archives + punch_archive_entries — Archivierte Stempelzeiten
--
--  Use-Cases:
--   1. User reset:    Free-User (ohne Org) leert seine Stempeluhr → ein Archiv
--                     mit reason='user_reset' wird angelegt.
--   2. Org leave:     User verlässt eine Org → seine Punch-Entries der Org-Zeit
--                     wandern in ein Archiv mit reason='org_leave'. Sichtbar
--                     für den User UND für die Org (Lohnbuchhaltung).
--   3. Org remove:    Admin entfernt User aus der Org → reason='org_remove'.
--   4. Org delete:    Owner löst Org auf → für jedes Mitglied ein Archiv
--                     mit reason='org_delete'. Bleibt sichtbar für die User
--                     (auch wenn die Org weg ist).
--
--  Archivierte Einträge sind NICHT mehr editierbar. Sie liegen separat von
--  punch_entries — der User kann mit einem leeren Stempelpunch wieder von vorn
--  anfangen, das alte Profil bleibt im Archiv konserviert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS punch_archives (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT    NOT NULL,
  -- Snapshot der Identitäts-Daten zum Zeitpunkt der Archivierung. Damit das
  -- Archiv auch lesbar bleibt wenn der User später Namen/Email ändert oder
  -- die Org gelöscht wird.
  user_display_name TEXT,
  user_email        TEXT,
  org_id            INTEGER,                                    -- NULL bei user_reset
  org_name          TEXT,                                       -- Snapshot
  reason            TEXT NOT NULL CHECK(reason IN ('user_reset','org_leave','org_remove','org_delete')),
  -- Aggregate fürs Listing — vermeiden N+1 beim Laden der Übersicht.
  total_entries     INTEGER NOT NULL DEFAULT 0,
  total_seconds     INTEGER NOT NULL DEFAULT 0,
  total_pause_sec   INTEGER NOT NULL DEFAULT 0,
  range_from        TEXT,
  range_to          TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_punch_archives_user
  ON punch_archives(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_punch_archives_org
  ON punch_archives(org_id, created_at DESC);

-- ── Einzel-Einträge ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS punch_archive_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id    INTEGER NOT NULL,
  -- Original-Werte 1:1 — die Tabelle bleibt read-only für den App-Layer.
  user_id       TEXT    NOT NULL,
  org_id        INTEGER,
  clock_in      TEXT    NOT NULL,
  clock_out     TEXT,
  pause_seconds INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  is_manual     INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (archive_id) REFERENCES punch_archives(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_punch_archive_entries_archive
  ON punch_archive_entries(archive_id);
