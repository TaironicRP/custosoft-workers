-- ═══════════════════════════════════════════════════════════════════════════
-- Product Catalog Update v3 — Final pricing for App Store launch
-- Run: wrangler d1 execute custosoft-db --file=scripts/update_products.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Deactivate removed products (FileSystem & GroupChat — no longer sold standalone)
UPDATE products SET is_active = 0 WHERE slug IN ('GroupChat', 'FileSystem');

-- 2. Migrate existing 'Business' rows to 'BusinessBasic' (slug rename)
UPDATE user_extensions SET product = 'BusinessBasic' WHERE product = 'Business';
UPDATE managed_grants  SET product = 'BusinessBasic' WHERE product = 'Business';
UPDATE products SET
  slug                = 'BusinessBasic',
  name                = 'Business Basic',
  description         = '10 Mitarbeiter-Slots · Stempeluhr · Akten · Chat',
  price_formatted     = '49,00 €/Monat',
  base_price          = 49.00,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 30,
  is_slot_based       = 1,
  starting_slots      = 10,
  max_slots           = 10,
  apple_product_id    = 'de.custosoft.app.business.basic.monthly'
WHERE slug = 'Business';

-- 3. PunchClock: 2,99 €/14 Tage mit 14 Tage Trial
UPDATE products SET
  price_formatted     = '2,99 €/2 Wochen',
  base_price          = 2.99,
  trial_days          = 14,
  billing_period_days = 14,
  apple_product_id    = 'de.custosoft.app.punchclock'
WHERE slug = 'PunchClock';

-- 4. MoreSpace: einmalig 4,99 €
UPDATE products SET
  price_formatted     = '4,99 €',
  base_price          = 4.99,
  is_subscription     = 0,
  trial_days          = 0,
  billing_period_days = NULL,
  apple_product_id    = 'de.custosoft.app.morespace'
WHERE slug = 'MoreSpace';

-- 5. Recruitment: einmalig 16,99 €
UPDATE products SET
  price_formatted     = '16,99 €',
  base_price          = 16.99,
  is_subscription     = 0,
  trial_days          = 0,
  billing_period_days = NULL,
  apple_product_id    = 'de.custosoft.app.recruitment'
WHERE slug = 'Recruitment';

-- 6. TerminalMode: einmalig 9,99 €
UPDATE products SET
  price_formatted     = '9,99 €',
  base_price          = 9.99,
  is_subscription     = 0,
  trial_days          = 0,
  billing_period_days = NULL,
  apple_product_id    = 'de.custosoft.app.terminalmode'
WHERE slug = 'TerminalMode';

-- 7. AllInOne / Premium MAX
UPDATE products SET
  name                = 'Premium MAX',
  description         = 'Alle Erweiterungen · für Einzelnutzer & kleine Teams',
  price_formatted     = '69,00 €/Monat',
  base_price          = 69.00,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 30,
  apple_product_id    = 'de.custosoft.app.allinone.monthly'
WHERE slug = 'AllInOne';

-- 8. Insert AllInOne if not exists
INSERT OR IGNORE INTO products (slug, name, description, price_formatted, is_active, is_subscription, trial_days, billing_period_days, base_price, apple_product_id)
VALUES ('AllInOne', 'Premium MAX', 'Alle Erweiterungen · für Einzelnutzer', '69,00 €/Monat', 1, 1, 0, 30, 69.00, 'de.custosoft.app.allinone.monthly');

-- 9. New Business tiers
INSERT OR IGNORE INTO products (slug, name, description, price_formatted, is_active, is_subscription, trial_days, billing_period_days, base_price, is_slot_based, starting_slots, max_slots, apple_product_id) VALUES
  ('BusinessL',          'Business L',          '50 Slots · alle Team-Features',                '89,00 €/Monat',  1, 1, 0,  30,  89.00, 1,  50,   50,   'de.custosoft.app.business.l.monthly'),
  ('BusinessMAX',        'Business MAX',        'Unbegrenzte Slots · alle Erweiterungen inkl.', '149,00 €/Monat', 1, 1, 0,  30, 149.00, 1, 999, 9999, 'de.custosoft.app.business.max.monthly');

-- 10. Yearly variants (-20%)
INSERT OR IGNORE INTO products (slug, name, description, price_formatted, is_active, is_subscription, trial_days, billing_period_days, base_price, is_slot_based, starting_slots, max_slots, apple_product_id) VALUES
  ('BusinessBasicYearly','Business Basic Jährlich', '10 Slots · 20 % Rabatt im Jahresabo',          '469,00 €/Jahr',   1, 1, 0, 365,  469.00, 1,  10,   10,   'de.custosoft.app.business.basic.yearly'),
  ('BusinessLYearly',    'Business L Jährlich',     '50 Slots · 20 % Rabatt im Jahresabo',          '849,00 €/Jahr',   1, 1, 0, 365,  849.00, 1,  50,   50,   'de.custosoft.app.business.l.yearly'),
  ('BusinessMAXYearly',  'Business MAX Jährlich',   'Unbegrenzt · alle Erweiterungen · 20 % Rabatt','1.429,00 €/Jahr', 1, 1, 0, 365, 1429.00, 1, 999, 9999, 'de.custosoft.app.business.max.yearly'),
  ('AllInOneYearly',     'Premium MAX Jährlich',    'Alle Erweiterungen · 20 % Rabatt',             '659,00 €/Jahr',   1, 1, 0, 365,  659.00, 0,  NULL, NULL, 'de.custosoft.app.allinone.yearly');
