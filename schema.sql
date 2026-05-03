-- ═══════════════════════════════════════════════════════════════════════════
-- CustoSoft D1 Schema · Cloudflare Workers · v2.0
-- Run: wrangler d1 execute custosoft-db --file=schema.sql --remote
-- HINWEIS: D1 verwaltet PRAGMAs (journal_mode, foreign_keys) selbst.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                TEXT    PRIMARY KEY,   -- UUID  v4
  email             TEXT    UNIQUE NOT NULL,
  email_normalized  TEXT    UNIQUE NOT NULL,  -- UPPER(email) for lookups
  password_hash     TEXT,                    -- pbkdf2:sha256:100000:salt:hash
  first_name        TEXT    NOT NULL DEFAULT '',
  last_name         TEXT    NOT NULL DEFAULT '',
  avatar_url        TEXT,
  account_type      TEXT    NOT NULL DEFAULT 'Private',  -- 'Private'|'Organisation'
  app_role          TEXT,                    -- 'SuperAdmin'|'Staff'|NULL
  public_username   TEXT    UNIQUE,
  name_visibility   TEXT    NOT NULL DEFAULT 'Public',  -- 'Public'|'OrgOnly'|'Private'
  last_seen_org_id  INTEGER,
  email_confirmed   INTEGER NOT NULL DEFAULT 0,
  is_blocked        INTEGER NOT NULL DEFAULT 0,
  apple_sub         TEXT    UNIQUE,
  google_sub        TEXT    UNIQUE,
  registered_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_login_at     TEXT,
  terminal_code     TEXT    UNIQUE   -- 7-stelliger Code für Wand-Stempeluhr
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_normalized);
CREATE INDEX IF NOT EXISTS idx_users_terminal_code ON users(terminal_code);

-- ── Email Verification Tokens ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

-- ── Password Reset Tokens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT    UNIQUE NOT NULL,
  expires_at TEXT    NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

-- ── Organisations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  owner_id   TEXT    NOT NULL REFERENCES users(id),
  logo_url   TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Org Members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL DEFAULT 'Member',   -- 'Owner'|'Admin'|'Member'
  is_active   INTEGER NOT NULL DEFAULT 1,
  joined_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Permissions (mirrors OrgMemberPermissions in iOS)
  can_manage_members           INTEGER NOT NULL DEFAULT 0,
  can_manage_invite_codes      INTEGER NOT NULL DEFAULT 0,
  can_create_groups            INTEGER NOT NULL DEFAULT 1,
  can_manage_files             INTEGER NOT NULL DEFAULT 0,
  can_invite_to_chats          INTEGER NOT NULL DEFAULT 1,
  can_use_more_space           INTEGER NOT NULL DEFAULT 0,
  can_view_salaries            INTEGER NOT NULL DEFAULT 0,
  can_manage_employee_profiles INTEGER NOT NULL DEFAULT 0,
  can_manage_org_structure     INTEGER NOT NULL DEFAULT 0,
  can_use_recruitment          INTEGER NOT NULL DEFAULT 1,
  can_manage_recruitment       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

-- ── Org Invite Codes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_invite_codes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code             TEXT    UNIQUE NOT NULL,
  created_by_id    TEXT    NOT NULL,
  created_by_name  TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at       TEXT,
  used_count       INTEGER NOT NULL DEFAULT 0,
  max_uses         INTEGER
);

-- ── Org Positions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── Org Departments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── Employee Profiles (extended member data) ──────────────────────────────
CREATE TABLE IF NOT EXISTS employee_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id        INTEGER UNIQUE NOT NULL REFERENCES org_members(id) ON DELETE CASCADE,
  position_id      INTEGER REFERENCES org_positions(id) ON DELETE SET NULL,
  department_id    INTEGER REFERENCES org_departments(id) ON DELETE SET NULL,
  hourly_rate      REAL,
  monthly_salary   REAL,
  weekly_hours     REAL,
  hire_date        TEXT,
  profile_notes    TEXT
);

-- ── Products ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                TEXT    UNIQUE NOT NULL,  -- ExtensionProduct.rawValue
  name                TEXT    NOT NULL,
  description         TEXT    NOT NULL DEFAULT '',
  price_formatted     TEXT    NOT NULL DEFAULT '',
  is_active           INTEGER NOT NULL DEFAULT 1,
  is_subscription     INTEGER NOT NULL DEFAULT 0,
  trial_days          INTEGER NOT NULL DEFAULT 0,
  billing_period_days INTEGER,
  is_slot_based       INTEGER NOT NULL DEFAULT 0,
  base_price          REAL,
  per_slot_price      REAL,
  starting_slots      INTEGER,
  max_slots           INTEGER,
  apple_product_id    TEXT
);

-- ── User Extensions / Licenses ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_extensions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product              TEXT    NOT NULL,  -- slug matching products.slug
  granted_via          TEXT    NOT NULL DEFAULT 'Purchase',  -- 'Purchase'|'OrgMembership'
  is_active            INTEGER NOT NULL DEFAULT 1,
  purchased_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at           TEXT,
  apple_transaction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_extensions_user ON user_extensions(user_id, is_active);

-- ── Orders ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_name TEXT    NOT NULL,
  price_paid   TEXT    NOT NULL DEFAULT '0.00 €',
  purchased_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  status       TEXT    NOT NULL DEFAULT 'Active'
);

-- ── Conversations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  type           TEXT    NOT NULL,  -- 'OrgGroup'|'DirectMessage'|'InfoChannel'
  org_id         INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  is_read_only   INTEGER NOT NULL DEFAULT 0,
  is_info_channel INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(org_id);

-- ── Conversation Members ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_members (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_read_at    TEXT,
  UNIQUE(conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

-- ── Messages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT    NOT NULL,  -- user id (no FK for soft-delete safety)
  sender_name     TEXT    NOT NULL,
  body            TEXT    NOT NULL DEFAULT '',
  sent_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  is_system       INTEGER NOT NULL DEFAULT 0,
  attachment_url   TEXT,
  attachment_name  TEXT,
  attachment_type  TEXT,   -- 'image'|'file'
  attachment_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, sent_at DESC);

-- ── Punch Entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS punch_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id         INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  clock_in       TEXT    NOT NULL,
  clock_out      TEXT,
  pause_seconds  INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  is_manual      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_punch_user ON punch_entries(user_id, clock_in DESC);

-- ── Pause Entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pause_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  punch_entry_id  INTEGER NOT NULL REFERENCES punch_entries(id) ON DELETE CASCADE,
  paused_at       TEXT    NOT NULL,
  resumed_at      TEXT
);

-- ── Employee Files (Akten) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_files (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_display_name TEXT    NOT NULL,
  org_id               INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  title                TEXT    NOT NULL,
  type                 TEXT    NOT NULL,
  file_url             TEXT,
  note                 TEXT,
  linked_punch_id      INTEGER,
  linked_message_id    INTEGER,
  created_by_user_id   TEXT    NOT NULL,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  visibility           INTEGER NOT NULL DEFAULT 1,  -- 0=restricted,1=managers,2=everyone
  is_archived          INTEGER NOT NULL DEFAULT 0,
  archived_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_org ON employee_files(org_id, subject_user_id);

-- ── Terminal Pins ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terminal_pins (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT    UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pin_hash  TEXT    NOT NULL   -- same PBKDF2 format as passwords
);

-- ── Recruitment Links ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_links (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id              INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code                TEXT    UNIQUE NOT NULL,
  title               TEXT    NOT NULL,
  description         TEXT,
  position_id         INTEGER REFERENCES org_positions(id) ON DELETE SET NULL,
  created_by_user_id  TEXT    NOT NULL,
  created_by_name     TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at          TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  used_count          INTEGER NOT NULL DEFAULT 0
);

-- ── Job Applications ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_applications (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id               INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  link_id              INTEGER REFERENCES job_links(id) ON DELETE SET NULL,
  link_title           TEXT,
  first_name           TEXT    NOT NULL,
  last_name            TEXT    NOT NULL,
  email                TEXT    NOT NULL,
  phone                TEXT,
  cover_letter         TEXT,
  applicant_user_id    TEXT    REFERENCES users(id) ON DELETE SET NULL,
  status               TEXT    NOT NULL DEFAULT 'New',
  internal_notes       TEXT,
  assigned_to_user_id  TEXT    REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_name     TEXT,
  submitted_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  first_viewed_at      TEXT,
  last_updated_at      TEXT
);

-- ── Job Application Attachments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_application_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  file_name      TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  content_type   TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  kind           TEXT    NOT NULL DEFAULT 'Other',
  uploaded_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Subscription Notifications ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  body       TEXT,
  type       TEXT,
  ref_id     TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Legal Pages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    UNIQUE NOT NULL,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Push Tokens (APNs) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT    NOT NULL,
  platform   TEXT    NOT NULL DEFAULT 'ios',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(user_id, token)
);

-- ── Managed Grants (manual admin grants) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS managed_grants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product      TEXT    NOT NULL,
  granted_by   TEXT    NOT NULL,
  granted_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  note         TEXT
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed Data: Products
-- ═══════════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO products (slug, name, description, price_formatted, is_active, is_subscription, trial_days, billing_period_days, apple_product_id)
VALUES
  ('GroupChat',    'Gruppen-Chat',      'Team-Gruppen erstellen, Direktnachrichten, Dateianhänge', '1,99 €/2 Wochen', 1, 1, 14, 14, 'de.custosoft.app.groupchat'),
  ('PunchClock',   'Stempeluhr',        'Zeiterfassung mit Pause & Statistiken. Orgs: Team-Übersicht.', '1,99 €/2 Wochen', 1, 1, 14, 14, 'de.custosoft.app.punchclock'),
  ('FileSystem',   'Akten-System',      'Digitale Mitarbeiterakten, Dokumente & Notizen.', '2,99 €/Monat', 1, 1, 14, 30, 'de.custosoft.app.filesystem'),
  ('Business',     'Business-Paket',    'Team-Stempeluhr & Verwaltung — Slot-basiert.', '49,00 €/Monat', 1, 1, 0, 30, 'de.custosoft.app.business'),
  ('MoreSpace',    'Mehr Platz',        'Erweiterte iPad- und Mac-Ansicht.', '9,99 €', 1, 0, 0, NULL, 'de.custosoft.app.morespace'),
  ('Recruitment',  'Bewerbungsmanager', 'Stellen-Links erstellen, Bewerbungen sammeln.', '14,99 €', 1, 0, 0, NULL, 'de.custosoft.app.recruitment'),
  ('TerminalMode', 'Wand-Stempeluhr',   'iPad an die Wand: alle Mitarbeiter stempeln per PIN.', '14,99 €', 1, 0, 0, NULL, 'de.custosoft.app.terminalmode');

-- Seed Data: Legal Pages
INSERT OR IGNORE INTO legal_pages (slug, title, content)
VALUES
  ('datenschutz', 'Datenschutzerklärung', 'Datenschutzerklärung — wird hier eingefügt.'),
  ('agb',         'AGB',                  'Allgemeine Geschäftsbedingungen — wird hier eingefügt.'),
  ('impressum',   'Impressum',            'Impressum — wird hier eingefügt.');
