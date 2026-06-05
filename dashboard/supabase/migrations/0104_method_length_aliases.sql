-- Aliases für Methoden und Längen (analog product_colors.name_supplier_aliases).
-- Damit kann der Lieferschein-Check chinesische/türkische Bezeichnungen
-- auf unsere Hairvenly-Struktur mappen (z.B. "PU TAPE" → Tapes, "67CM" → 65cm).

ALTER TABLE product_methods
  ADD COLUMN IF NOT EXISTS name_supplier_aliases text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS product_methods_aliases_gin_idx
  ON product_methods USING gin (name_supplier_aliases);

ALTER TABLE product_lengths
  ADD COLUMN IF NOT EXISTS name_supplier_aliases text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS product_lengths_aliases_gin_idx
  ON product_lengths USING gin (name_supplier_aliases);

COMMENT ON COLUMN product_methods.name_supplier_aliases IS
  'Alternative Bezeichnungen für die Methode auf Lieferanten-Dokumenten (chinesisch/türkisch/abgekürzt). Beispiel: ["PU TAPE", "PU\nTAPE"] für Tapes.';

COMMENT ON COLUMN product_lengths.name_supplier_aliases IS
  'Alternative Bezeichnungen für die Länge (z.B. Spannen "45-52" für 45cm).';
