-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Stempeluhr von wöchentlich auf monatlich umstellen
--
-- Vor:   2,99 €/Woche  ·  billing_period_days = 7
-- Nach:  2,99 €/Monat  ·  billing_period_days = 30
--
-- Anwendung:
--   wrangler d1 execute custosoft-db --remote \
--     --file=scripts/update_punchclock_monthly.sql
--
-- WICHTIG: In App Store Connect zusätzlich die Subscription-Periode der
-- Live-IAP `de.custosoft.app.punchclock` von P1W auf P1M umstellen.
-- Bei Auto-Renew-Subscribern muss eine neue Subscription-Group oder eine
-- Pricing-Änderung mit Apples Standard-Migration-Path gewählt werden.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE products
SET
  description         = 'Zeiterfassung für eine Person — monatliches Abo, jederzeit kündbar.',
  price_formatted     = '3,99 €/Monat',
  base_price          = 3.99,
  billing_period_days = 30
WHERE slug = 'PunchClock';

-- Sanity-Check: zeige alle Produkte nach der Migration
SELECT slug, price_formatted, billing_period_days, is_subscription
FROM products
ORDER BY id;
