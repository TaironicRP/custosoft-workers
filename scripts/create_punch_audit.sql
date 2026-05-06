-- ============================================================================
--  punch_record_audit — Audit-Log für Stempelzeit-Änderungen
--
--  Bei jedem PUT /punch/records/:id wird ein Eintrag geschrieben:
--   - editor_user_id  → wer hat geändert
--   - target_user_id  → wessen Eintrag wurde geändert
--   - record_id       → welcher Eintrag (FK auf punch_entries)
--   - field           → welches Feld (clock_in / clock_out / pause_seconds /
--                       note / is_manual)
--   - old_value       → Wert davor (als String — bei Datumsfeldern ISO-8601)
--   - new_value       → Wert danach
--   - changed_at      → Zeitpunkt
--
--  Pro PUT entstehen mehrere Audit-Zeilen — eine pro tatsächlich geändertem
--  Feld. Damit die Lohnabrechnung nachweisbar zeigen kann WER WAS WANN
--  geändert hat (Compliance / Arbeitszeitgesetz).
-- ============================================================================

CREATE TABLE IF NOT EXISTS punch_record_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id       INTEGER NOT NULL,
  editor_user_id  TEXT    NOT NULL,
  editor_name     TEXT,                     -- Snapshot zum Zeitpunkt der Änderung
  target_user_id  TEXT    NOT NULL,
  target_name     TEXT,
  org_id          INTEGER,
  field           TEXT    NOT NULL CHECK(field IN ('clock_in','clock_out','pause_seconds','note','is_manual')),
  old_value       TEXT,
  new_value       TEXT,
  changed_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_punch_audit_record  ON punch_record_audit(record_id);
CREATE INDEX IF NOT EXISTS idx_punch_audit_target  ON punch_record_audit(target_user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_punch_audit_org     ON punch_record_audit(org_id, changed_at DESC);
