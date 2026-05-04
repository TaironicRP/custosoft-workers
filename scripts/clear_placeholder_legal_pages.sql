-- ═══════════════════════════════════════════════════════════════════════════
-- Legal Pages Cleanup — Platzhalter-Einträge entfernen
-- ═══════════════════════════════════════════════════════════════════════════
-- Beim ersten DB-Setup (schema.sql) wurden für impressum/agb/datenschutz/
-- widerruf Placeholder-Texte ('… wird hier eingefügt.') gespeichert. Solange
-- diese in der DB stehen, zeigt die Website diese Stümpfe statt der
-- inhaltlich vollständigen Default-Texte aus web-public.ts.
--
-- Lösung: Placeholder-Zeilen löschen — Route fällt automatisch auf den
-- Default-Text zurück. Wenn später im Web-Admin (/admin) richtige Custom-
-- Inhalte gespeichert werden, überschreiben die den Default wieder.
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM legal_pages
 WHERE slug IN ('impressum','agb','datenschutz','widerruf')
   AND (
     content IS NULL
     OR length(content) < 80
     OR content LIKE '%wird hier eingefügt%'
     OR content LIKE '%wird hier eingefügt%'
     OR content LIKE '% — Platzhalter%'
   );

-- Sanity check
SELECT slug, length(content) AS content_len FROM legal_pages ORDER BY slug;
