-- Shopify-Capital-Kredite wurden über "Banking Circle" ausgezahlt (200k 08/2025, 280k 12/2025) und
-- landeten im Eingangs-Fallback als Kundenzahlung (= Einnahme). Darlehen sind keine Einnahme.
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (5,  'purpose',           'Shopify Capital', 'ein', 'kredit_auszahlung', 'Kreditauszahlung über Banking Circle'),
  (30, 'counterparty_name', 'Klarna',          'ein', 'ein_shop',          'Klarna-Auszahlungen (Shop-Zahlart)')
on conflict (feld, muster, richtung) do nothing;
