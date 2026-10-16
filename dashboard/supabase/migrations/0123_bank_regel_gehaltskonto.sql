-- Targobank-Gehaltskonto (BLZ 30020900): von dort laufen Gehälter, Miete, Lagermiete,
-- Krankenkassen und Versicherungen. Der Übertrag von der Sparkasse ist eine Umbuchung
-- zwischen eigenen Geschäftskonten, kein Aufwand (User-Bestätigung 16.10.2026).

update bank_kategorie_regeln
   set kategorie = 'umbuchung_gehalt', notiz = 'Übertrag Targobank-Gehaltskonto'
 where feld = 'purpose' and muster = 'auf Gehaltskonto';

insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (5, 'counterparty_iban', '5360977267', 'alle', 'umbuchung_gehalt', 'Targobank-Gehaltskonto (IBAN)')
on conflict (feld, muster, richtung) do update set kategorie = excluded.kategorie, prioritaet = excluded.prioritaet;
