-- ═══════════════════════════════════════════════════════════════════════════
-- Hotfix v5 — Tipp-Fehler "buissnes" korrigieren + BusinessBasic sicherstellen
-- Run: wrangler d1 execute custosoft-db --file=scripts/update_products_v5.sql --remote
--
-- Was dieser Script macht:
--   1. Korrigiert Tipp-Fehler "buissnes" → "business" in apple_product_id
--   2. Stellt sicher dass BusinessBasic mit korrekter Apple-ID existiert
--   3. Stellt sicher dass BusinessL mit korrekter Apple-ID existiert
--   4. Migriert user_extensions die noch "Business" als Slug haben → "BusinessBasic"
--   5. Sanity-Check: zeigt Endstand der Produkte
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Tipp-Fehler in apple_product_id korrigieren (falls vorhanden)
UPDATE products
   SET apple_product_id = REPLACE(apple_product_id, 'buissnes', 'business')
 WHERE apple_product_id LIKE '%buissnes%';

-- 2. Slug-Migration: alte "Business" user_extensions → "BusinessBasic"
UPDATE user_extensions SET product = 'BusinessBasic' WHERE product = 'Business';
UPDATE managed_grants  SET product = 'BusinessBasic' WHERE product = 'Business';

-- 3. BusinessBasic sicherstellen (INSERT wenn fehlt, UPDATE wenn vorhanden)
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, per_slot_price,
   is_slot_based, starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessBasic', 'Business Basic',
   '10 Mitarbeiter-Slots · Stempeluhr · Akten · Chat',
   '49,00 €/Monat', 1, 1, 0, 30, 49.00, 0, 0, 10, 10,
   'de.custosoft.app.business.basic.monthly');

UPDATE products SET
  name                = 'Business Basic',
  description         = '10 Mitarbeiter-Slots · Stempeluhr · Akten · Chat',
  price_formatted     = '49,00 €/Monat',
  is_active           = 1,
  is_subscription     = 1,
  trial_days          = 0,
  billing_period_days = 30,
  base_price          = 49.00,
  per_slot_price      = 0,
  is_slot_based       = 0,
  starting_slots      = 10,
  max_slots           = 10,
  apple_product_id    = 'de.custosoft.app.business.basic.monthly'
WHERE slug = 'BusinessBasic';

-- 4. BusinessBasicYearly sicherstellen
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, per_slot_price,
   is_slot_based, starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessBasicYearly', 'Business Basic Jährlich',
   '10 Slots · 20 % Rabatt im Jahresabo',
   '469,00 €/Jahr', 1, 1, 0, 365, 469.00, 0, 0, 10, 10,
   'de.custosoft.app.business.basic.yearly');

UPDATE products SET
  apple_product_id = 'de.custosoft.app.business.basic.yearly',
  is_active        = 1
WHERE slug = 'BusinessBasicYearly';

-- 5. BusinessL sicherstellen
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, per_slot_price,
   is_slot_based, starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessL', 'Business L',
   '50 Mitarbeiter-Slots · Stempeluhr, Akten & Chat fürs ganze Team',
   '89,00 €/Monat', 1, 1, 0, 30, 89.00, 0, 0, 50, 50,
   'de.custosoft.app.business.l.monthly');

UPDATE products SET
  apple_product_id = 'de.custosoft.app.business.l.monthly',
  is_active        = 1
WHERE slug = 'BusinessL';

-- 6. BusinessLYearly sicherstellen
INSERT OR IGNORE INTO products
  (slug, name, description, price_formatted, is_active, is_subscription,
   trial_days, billing_period_days, base_price, per_slot_price,
   is_slot_based, starting_slots, max_slots, apple_product_id)
VALUES
  ('BusinessLYearly', 'Business L Jährlich',
   '50 Slots · 20 % Rabatt im Jahresabo',
   '849,00 €/Jahr', 1, 1, 0, 365, 849.00, 0, 0, 50, 50,
   'de.custosoft.app.business.l.yearly');

UPDATE products SET
  apple_product_id = 'de.custosoft.app.business.l.yearly',
  is_active        = 1
WHERE slug = 'BusinessLYearly';

-- 7. Legacy/deaktivierte Produkte sicherstellen (bleiben inaktiv)
UPDATE products SET is_active = 0
 WHERE slug IN ('GroupChat', 'FileSystem', 'AllInOne', 'AllInOneYearly',
                'BusinessMAX', 'BusinessMAXYearly');

-- 8. Sanity-Check: Endstand aller Produkte
SELECT slug, name, is_active, apple_product_id
  FROM products
 ORDER BY is_active DESC, id ASC;
