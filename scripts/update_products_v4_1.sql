-- ═══════════════════════════════════════════════════════════════════════════
-- Hotfix v4.1 — BusinessL Beschreibung korrigieren
-- BusinessL inkludiert NICHT Recruitment/TerminalMode/MoreSpace.
-- Nur Team-Basis: Stempeluhr, Akten, Chat.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE products SET
  description = '50 Mitarbeiter-Slots · Stempeluhr, Akten & Chat fürs ganze Team'
WHERE slug = 'BusinessL';

UPDATE products SET
  description = '50 Slots · 20 % Rabatt im Jahresabo'
WHERE slug = 'BusinessLYearly';

SELECT slug, description FROM products WHERE slug IN ('BusinessL','BusinessLYearly');
