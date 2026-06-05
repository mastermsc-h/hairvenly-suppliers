-- Lieferanten-Aliase pro Farbe (für chinesisch/türkisch/abgekürzte Bezeichnungen
-- auf Lieferscheinen). Beim Lieferschein-Check kann das System eine Bezeichnung
-- via Alias auf die Hairvenly-Farbe matchen.
--
-- Beispiel:
--   name_hairvenly = "BITTER CACAO"
--   name_supplier = "Bitter Cacao" (originale Lieferanten-Schreibweise)
--   name_supplier_aliases = ['苦可可', 'BC-001', 'Bitter Cocoa']  ← alle alternativen
--                                                                  Schreibweisen
--
-- Die Aliase werden im Laufe der Zeit gepflegt: bei jedem manuell zugeordneten
-- Lieferschein-Text wird ein Vorschlag "Alias speichern?" gezeigt.

ALTER TABLE product_colors
  ADD COLUMN IF NOT EXISTS name_supplier_aliases text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN product_colors.name_supplier_aliases IS
  'Alternative Bezeichnungen des Lieferanten (chinesisch, türkisch, Abkürzungen, Tippfehler). Wird beim Lieferschein-Check für Fuzzy-Match verwendet.';

-- Suche-Index: GIN für text[] containment + ILIKE-Lookups
CREATE INDEX IF NOT EXISTS product_colors_aliases_gin_idx
  ON product_colors USING gin (name_supplier_aliases);
