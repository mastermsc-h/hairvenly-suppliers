-- SKU (Stock Keeping Unit) für product_colors.
--
-- Sprechende, eindeutige Kennzeichnung pro Farb-Variante. Format:
--   {LIEFERANT}-{METHODE}-{LÄNGE}-{FARBE}
--   z.B. RU-TAPE-45-1A, US-BOND-85-PW, RU-CLIP-50-1A
--
-- Zweck: schnellere Kommunikation mit Lieferant/Team, lesbarere
-- Bestelllisten, eindeutige Referenz in Buchhaltung/Reklamationen.
-- Optional an Shopify variant.sku gesynced.

ALTER TABLE product_colors
  ADD COLUMN IF NOT EXISTS sku text;

-- Eindeutigkeit erzwingen (sku darf nur einmal vergeben sein, NULL erlaubt
-- damit alte rows ohne sku migrieren koennen)
CREATE UNIQUE INDEX IF NOT EXISTS product_colors_sku_uniq
  ON product_colors(sku)
  WHERE sku IS NOT NULL;

-- Fuer schnelle suche per sku (z.B. wizard, inventory)
CREATE INDEX IF NOT EXISTS product_colors_sku_idx
  ON product_colors(sku);

COMMENT ON COLUMN product_colors.sku IS
  'Sprechender Stock-Keeping-Unit-Code. Format: {LIEFERANT}-{METHODE}-{LÄNGE}-{FARBE}. Auto-generiert via lib/sku-generator.';
