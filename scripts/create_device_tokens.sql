-- ============================================================================
--  device_tokens — APNS-Geräte-Tokens pro User für Push-Notifications
--
--  Beim Login (oder beim ersten Permission-Grant) ruft die iOS-App
--  POST /api/v1/notifications/devices auf und registriert ihren APNS-Token.
--  Beim Logout DELETE /api/v1/notifications/devices/:token.
--
--  Ein User kann mehrere Geräte gleichzeitig haben (iPhone, iPad, Mac), daher
--  UNIQUE(user_id, token) — jeder Token-Wert pro User nur einmal, aber ein
--  Token kann theoretisch wechseln wenn der User die App neu installiert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  token       TEXT    NOT NULL,                -- APNS Hex-Token (64 Zeichen)
  platform    TEXT    NOT NULL CHECK(platform IN ('ios', 'mac', 'web')),
  app_version TEXT,                            -- z.B. "1.7 (Build 8)"
  bundle_id   TEXT,                            -- z.B. "com.taironic.custosoft"
  environment TEXT    NOT NULL DEFAULT 'production' CHECK(environment IN ('production', 'sandbox')),
  last_seen   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON device_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_device_tokens_last_seen
  ON device_tokens(last_seen);
