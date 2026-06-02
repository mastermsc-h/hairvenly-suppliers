-- 0097: Farb-Helligkeit & KI-Abgrenzung in product_colors
--
-- Quelle: kuratiertes Farb-Sheet "Farben Shopify Details" (Wella-System).
-- Behebt Helligkeits-Halluzinationen des Bots (Bug 02.06: RAW vs ESPRESSO
-- geraten). Jetzt harte Daten: brightness_level (kleiner=dunkler) macht
-- "wer ist dunkler?" zu einem Fakt statt einer LLM-Schätzung.
--
-- Befüllung via Sync-Button im Produktkatalog (syncColorSheet → importColorSheet).
-- similar_in_same_line wurde bereits in einer früheren Pflege angelegt.

ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS wella_level TEXT;        -- z.B. "3/0", "5/37", "6/0 + 8/3"
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS brightness_level NUMERIC; -- Haupt-Tiefe (1=schwarz … 10=hellblond); KLEINER = DUNKLER
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS undertone TEXT;          -- warm/kuehl/neutral
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS color_type TEXT;         -- einheitlich/balayage/ombre/highlights
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS ki_description TEXT;     -- KI-optimierte Farbbeschreibung
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS ki_abgrenzung TEXT;     -- expliziter Vergleich "im Gegensatz zu X..."
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS similar_in_same_line TEXT; -- ähnliche Farben SELBE Linie (Ausverkauf-Alternativen)
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS similar_reviewed BOOLEAN NOT NULL DEFAULT false;
