-- ═══════════════════════════════════════════════════════════════════════════
-- Migration v6 — Orders-Tabelle: notes-Spalte + Upgrade-Log-Spalte
-- Run: wrangler d1 execute custosoft-db --file=scripts/update_orders_v6.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════

-- Upgrade-Log in orders-Tabelle: notes und upgraded_from
ALTER TABLE orders ADD COLUMN notes TEXT;
ALTER TABLE orders ADD COLUMN upgraded_from TEXT;   -- z.B. "BusinessBasic" wenn Upgrade von Basic → L

-- Sanity-Check
SELECT id, product_name, status, notes, upgraded_from FROM orders ORDER BY purchased_at DESC LIMIT 10;
