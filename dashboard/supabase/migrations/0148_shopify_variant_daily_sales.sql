-- Verkaufte Stück pro Shopify-Variante und Tag (Bestelldatum, Europe/Berlin).
--
-- Zweck: Lieferbarkeit rekonstruieren (Ladenhüter-Seite). Ein Produkt, das
-- ausverkauft war und gerade wieder eingelagert wurde, hat 0 Verkäufe in 90
-- Tagen, ist aber nicht "tot". Dafür braucht es Tageswerte, nicht Monatswerte.
--
-- Geschrieben vom Cron /api/cron/daily-sales (inkrementell, letzte Tage neu),
-- initial per Backfill. Stornierte/Test-Bestellungen zählen nicht; Menge =
-- currentQuantity (nach Bestellbearbeitungen).

CREATE TABLE IF NOT EXISTS shopify_variant_daily_sales (
  day date NOT NULL,
  variant_id text NOT NULL,
  product_id text,
  handle text,
  variant_title text,
  units integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, variant_id)
);

CREATE INDEX IF NOT EXISTS shopify_variant_daily_sales_handle_idx ON shopify_variant_daily_sales (handle, day);

ALTER TABLE shopify_variant_daily_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY shopify_variant_daily_sales_admin_all ON shopify_variant_daily_sales
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));
