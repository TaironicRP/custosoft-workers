-- ═══════════════════════════════════════════════════════════════════════════
-- Product Catalog Update v4 — App Store Launch Pricing
-- Run: wrangler d1 execute custosoft-db --file=scripts/update_products_v4.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Apple Product IDs (1:1 mit App Store Connect):
--   de.custosoft.app.punchclock                   — Auto-Renewable, 2,99 €/Woche
--   de.custosoft.app.business.basic.monthly       — Auto-Renewable, 49,00 €/Monat (10 Slots)
--   de.custosoft.app.business.basic.yearly        — Auto-Renewable, 469,00 €/Jahr (10 Slots)
--   de.custosoft.app.business.l.monthly           — Auto-Renewable, 89,00 €/Monat (50 Slots) — Top-Tier
--   de.custosoft.app.business.l.yearly            — Auto-Renewable, 849,00 €/Jahr (50 Slots)
--   de.custosoft.app.morespace                    — Non-Consumable, 4,99 €
--   de.custosoft.app.recruitment                  — Non-Consumable, 9,99 €
--   de.custosoft.app.terminalmode                 — Non-Consumable, 14,99 €
--
-- BusinessMAX, AllInOne und Legacy-Produkte werden deaktiviert.
-- Trials sind backend-seitig auf 0 (Frontend-Flag FeatureFlags.trialsEnabled
-- erlaubt jederzeit re-aktivieren sobald hier wieder trial_days > 0 steht).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Legacy + MAX-Tier deaktivieren (User-Käufe bleiben unangetastet)
UPDATE products
   SET is_active = 0
 WHERE slug IN (
   'GroupChat', 'FileSystem',
   'AllInOne', 'AllInOneYearly',
   'BusinessMAX', 'BusinessMAXYearly'
 );

-- 2. Slug-Migration: alte 'Business' → 'BusinessBasic' (User-Lizenzen mitziehen)
UPDATE user_extensions SET product = 'BusinessBasic' WHERE product = 'Business';
UPDATE managed_grants  SET product = 'BusinessBasic' WHERE product = 'Business';

-- 3. PunchClock: 2,99 €/Woche, kein Trial
UPDATE products SET
  name                = 'Stempeluhr',
  description         = 'Zeiterfassung für eine Person — wöchentliches Abo, jederzeit kündbar.',
  price_formatted     = '2,99 €/Woche',
  base_price          = 2.99,
  is_active           = 1,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 7,
  is_slot_based       = 0,
  apple_product_id    = 'de.custosoft.app.punchclock'
WHERE slug = 'PunchClock';

-- 4. Business → BusinessBasic (49 €/Monat, 10 Slots fest)
UPDATE products SET
  slug                = 'BusinessBasic',
  name                = 'Business Basic',
  description         = '10 Mitarbeiter-Slots · Stempeluhr · Akten · Chat',
  price_formatted     = '49,00 €/Monat',
  base_price          = 49.00,
  per_slot_price      = 0,
  is_active           = 1,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 30,
  is_slot_based       = 0,
  starting_slots      = 10,
  max_slots           = 10,
  apple_product_id    = 'de.custosoft.app.business.basic.monthly'
WHERE slug = 'Business' OR slug = 'BusinessBasic';

-- 5. MoreSpace
UPDATE products SET
  price_formatted     = '4,99 €',
  base_price          = 4.99,
  is_active           = 1,
  is_subscription     = 0,
  trial_days          = 0,
  billing_period_days = NULL,
  is_slot_based       = 0,
  apple_product_id    = 'de.custosoft.app.morespace'
WHERE slug = 'MoreSpace';

-- 6. Recruitment
UPDATE products SET
  price_formatted     = '9,99 €',
  base_price          = 9.99,
  is_active           = 1,
  is_subscription     = 0,
  trial_days          = 0,
  billing_period_days = NULL,
  is_slot_based       = 0,
  apple_product_id    = 'de.custosoft.app.recruitment'
WHERE slug = 'Recruitment';

-- 7. TerminalMode
UPDATE products SET
  price_formatted     = '14,99 €',
  base_price          = 14.99,
  is_active           = 1,
  is_subscription     = 0,
  trial_days          = 0,
  billing_period_days = NULL,
  is_slot_based       = 0,
  apple_product_id    = 'de.custosoft.app.terminalmode'
WHERE slug = 'TerminalMode';

-- 8. BusinessBasicYearly anlegen (falls noch nicht da)
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, is_slot_based,
   starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessBasicYearly', 'Business Basic Jährlich',
   '10 Slots · 20 % Rabatt im Jahresabo',
   '469,00 €/Jahr', 1, 1, 0, 365, 469.00, 0, 10, 10,
   'de.custosoft.app.business.basic.yearly');

-- Sicherstellen dass Yearly-Variante korrekt aktiv ist
UPDATE products SET
  is_active           = 1,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 365,
  base_price          = 469.00,
  is_slot_based       = 0,
  starting_slots      = 10,
  max_slots           = 10,
  apple_product_id    = 'de.custosoft.app.business.basic.yearly',
  price_formatted     = '469,00 €/Jahr',
  description         = '10 Slots · 20 % Rabatt im Jahresabo',
  name                = 'Business Basic Jährlich'
WHERE slug = 'BusinessBasicYearly';

-- 9. BusinessL anlegen
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, is_slot_based,
   starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessL', 'Business L',
   '50 Mitarbeiter-Slots · alle Team-Features inkl. Bewerbungsmanagement',
   '89,00 €/Monat', 1, 1, 0, 30, 89.00, 0, 50, 50,
   'de.custosoft.app.business.l.monthly');

UPDATE products SET
  is_active           = 1,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 30,
  base_price          = 89.00,
  is_slot_based       = 0,
  starting_slots      = 50,
  max_slots           = 50,
  apple_product_id    = 'de.custosoft.app.business.l.monthly',
  price_formatted     = '89,00 €/Monat',
  description         = '50 Mitarbeiter-Slots · alle Team-Features inkl. Bewerbungsmanagement',
  name                = 'Business L'
WHERE slug = 'BusinessL';

-- 10. BusinessLYearly anlegen
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, is_slot_based,
   starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessLYearly', 'Business L Jährlich',
   '50 Slots · 20 % Rabatt im Jahresabo',
   '849,00 €/Jahr', 1, 1, 0, 365, 849.00, 0, 50, 50,
   'de.custosoft.app.business.l.yearly');

UPDATE products SET
  is_active           = 1,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 365,
  base_price          = 849.00,
  is_slot_based       = 0,
  starting_slots      = 50,
  max_slots           = 50,
  apple_product_id    = 'de.custosoft.app.business.l.yearly',
  price_formatted     = '849,00 €/Jahr',
  description         = '50 Slots · 20 % Rabatt im Jahresabo',
  name                = 'Business L Jährlich'
WHERE slug = 'BusinessLYearly';

-- 11. Sanity check: zeige Endzustand
SELECT slug, name, price_formatted, is_active, apple_product_id
  FROM products
 ORDER BY is_active DESC, id ASC;
