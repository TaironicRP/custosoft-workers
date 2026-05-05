-- ═══════════════════════════════════════════════════════════════════════════
-- Wartungs-Script: Test-Accounts löschen
--
-- Trifft alle User mit synthetischen Test-Mails:
--   *@example.com   (23 Accounts aus Integrations- & Build-Tests)
--   *@x.de          (synthetische Member/Owner-Accounts)
--
-- BEHÄLT:
--   - Apple Review-Accounts (apple@custosoft.de, apple-review@custosoft.de)
--   - Sign-In-with-Apple Private Relays (*@privaterelay.appleid.com)
--   - Echte User-Mails (gmail/yahoo/icloud/Custom-Domains)
--
-- Cleanup-Reihenfolge: Foreign-Key-Children zuerst, users zuletzt.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Punch-Daten — pause_entries hängt an punch_entry_id (kein user_id)
DELETE FROM pause_entries WHERE punch_entry_id IN (
  SELECT id FROM punch_entries WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
  )
);
DELETE FROM punch_entries WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);

-- 2. Chat-Daten
DELETE FROM messages WHERE sender_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);
DELETE FROM conversation_members WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);

-- 3. Files
DELETE FROM employee_files WHERE subject_user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);

-- 4. Org-Membership + employee_profiles (hängt an member_id)
DELETE FROM employee_profiles WHERE member_id IN (
  SELECT id FROM org_members WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
  )
);
DELETE FROM org_members WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);

-- 5. Verwaiste Orgs (deren Owner gelöscht wird) komplett räumen
DELETE FROM org_invite_codes WHERE org_id IN (
  SELECT id FROM organisations WHERE owner_id IN (
    SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
  )
);
DELETE FROM org_departments WHERE org_id IN (
  SELECT id FROM organisations WHERE owner_id IN (
    SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
  )
);
DELETE FROM org_positions WHERE org_id IN (
  SELECT id FROM organisations WHERE owner_id IN (
    SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
  )
);
DELETE FROM employee_profiles WHERE member_id IN (
  SELECT id FROM org_members WHERE org_id IN (
    SELECT id FROM organisations WHERE owner_id IN (
      SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
    )
  )
);
DELETE FROM org_members WHERE org_id IN (
  SELECT id FROM organisations WHERE owner_id IN (
    SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
  )
);
DELETE FROM organisations WHERE owner_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);

-- 6. User-bezogene Tokens / Lizenzen / Logs
DELETE FROM subscription_notifications WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);
DELETE FROM mail_logs WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);
DELETE FROM push_tokens WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);
DELETE FROM terminal_pins WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);
DELETE FROM user_extensions WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);
DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de'
);

-- 7. Endgültig: User selbst (Tokens via CASCADE FK)
DELETE FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@x.de';

-- Verbleibende Accounts auflisten
SELECT email, first_name, last_name, app_role, last_login_at FROM users ORDER BY email;
