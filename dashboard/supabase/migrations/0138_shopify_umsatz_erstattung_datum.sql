-- Erstattungen werden jetzt nach Buchungsdatum dem Monat zugerechnet (wie Shopify-Analytics,
-- § 17 UStG), nicht mehr dem Bestellmonat. Nur Doku; Daten wurden neu geladen.
comment on column shopify_umsatz_monat.erstattet is 'Alle im Monat (deutsche Zeit) gebuchten Erstattungen, auch auf ältere Bestellungen';
comment on column shopify_umsatz_monat.brutto is 'Bestellsummen der im Monat angelegten Bestellungen inkl. USt+Versand; stornierte nur mit erstattetem Betrag; ohne Tests';
