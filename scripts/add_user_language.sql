-- Migration: Sprach-Spalte für lokalisierte E-Mails (DE/EN)
--
--   wrangler d1 execute custosoft-db --remote --file=scripts/add_user_language.sql

ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'de';

SELECT 'users' AS tbl, COUNT(*) AS total,
       SUM(CASE WHEN language='de' THEN 1 ELSE 0 END) AS de,
       SUM(CASE WHEN language='en' THEN 1 ELSE 0 END) AS en
FROM users;
