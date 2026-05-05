-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Mail-System für Web-Admin
--
-- Erzeugt zwei neue Tabellen:
--   1. mail_logs       — Audit aller verschickten Emails (Erfolg + Fail)
--   2. mail_templates  — Override-Layer für die hardcoded Default-Templates
--
-- Anwendung:
--   wrangler d1 execute custosoft-db --remote \
--     --file=scripts/create_mail_tables.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mail_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key  TEXT,
  to_email      TEXT    NOT NULL,
  to_name       TEXT,
  from_email    TEXT,
  subject       TEXT,
  status        TEXT    NOT NULL,
  error_message TEXT,
  resend_id     TEXT,
  sent_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  user_id       TEXT,
  triggered_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_logs_to   ON mail_logs(to_email);
CREATE INDEX IF NOT EXISTS idx_mail_logs_when ON mail_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_logs_tpl  ON mail_logs(template_key);

CREATE TABLE IF NOT EXISTS mail_templates (
  template_key  TEXT    PRIMARY KEY,
  subject       TEXT    NOT NULL,
  html          TEXT    NOT NULL,
  text          TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by    TEXT
);

SELECT 'mail_logs' AS table_name, COUNT(*) AS rows FROM mail_logs
UNION ALL
SELECT 'mail_templates',          COUNT(*) FROM mail_templates;
