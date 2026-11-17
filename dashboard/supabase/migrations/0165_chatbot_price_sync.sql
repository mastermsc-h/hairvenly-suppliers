-- Preis-Sync Shopify → chatbot_prices (täglicher Cron /api/cron/chatbot-price-sync).
-- chatbot_prices stand seit 03.05.2026 still; der Bot nannte deshalb zu niedrige Preise.
-- Ergebnis des letzten Laufs (geändert / unverändert / prüfen + FAQ-Treffer mit alten Preisen)
-- landet hier und wird auf /chatbot über der Preistabelle angezeigt.
alter table chatbot_settings
  add column if not exists prices_synced_at timestamptz,
  add column if not exists prices_sync_report jsonb;

-- invisible_tape Ebru 65cm: in Shopify gibt es dort zwei verschiedene Produkte
-- (Butterfly Tressen 65cm 134,99 € und Invisible Tapes 65cm 72,50 €), die Zeile
-- (195 € / 50 g) passt zu keinem. Kein Preis ist besser als ein falscher —
-- deaktivieren, bis geklärt ist, welches Produkt gemeint ist.
update chatbot_prices set active = false, updated_at = now()
  where method = 'invisible_tape' and supplier_line = 'ebru' and length_cm = 65;
