-- Anzeige-Einheit pro Preisliste (in Gramm).
--
-- Manche Preislisten speichern Preise pro 1000g (Ebru/China), andere pro
-- 100g (Amanda). display_unit_grams sagt, auf welche Gramm-Basis sich die
-- gespeicherten Werte beziehen. Die UI rechnet alle Preise auf 100g um:
--   angezeigter_preis = gespeicherter_preis * 100 / display_unit_grams
--
-- Default 100 → keine Umrechnung. Ebru wird auf 1000 gesetzt → /10.

ALTER TABLE supplier_price_lists
  ADD COLUMN IF NOT EXISTS display_unit_grams integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN supplier_price_lists.display_unit_grams IS
  'Gramm-Basis der gespeicherten Preise. UI normalisiert auf 100g: preis*100/display_unit_grams. Default 100 = keine Umrechnung.';

-- Ebru-Preislisten auf 1000g setzen (deren Werte sind pro 1000g gespeichert)
UPDATE supplier_price_lists pl
SET display_unit_grams = 1000
FROM suppliers s
WHERE pl.supplier_id = s.id
  AND s.name ILIKE '%ebru%';
