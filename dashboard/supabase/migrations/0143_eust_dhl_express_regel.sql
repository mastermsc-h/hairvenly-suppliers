-- DHL Express als Gegenpartei = Import-Abgaben (EUSt/Zoll), nicht Versand.
-- Die bestehende Regel "DHL EXPRESS" (prio 10) prüft nur den Verwendungszweck. Bei
-- Abbuchungen mit Gegenpartei "DHL Express Germany GmbH" steht dort nur "EUST/Zoll"
-- oder die Kundennummer → sie fielen auf die allgemeine "DHL"-Regel (prio 50, Versand).
-- Eigene Pakete laufen über DHL Paket / Deutsche Post, nicht über DHL Express.
-- Gefunden 04.11.2026: 03.12.2025 (11.676,40 €, "EUST/Zoll") und 13.01.2026 (3.938,69 €).
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz)
select 10, 'counterparty_name', 'DHL Express', 'aus', 'st_eust', 'DHL Express als Gegenpartei = Import-Abgaben (eigene Pakete laufen über DHL Paket)'
where not exists (select 1 from bank_kategorie_regeln where feld = 'counterparty_name' and muster = 'DHL Express');

insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz)
select 10, 'purpose', 'EUST/Zoll', 'aus', 'st_eust', 'Verwendungszweck nennt EUSt/Zoll ausdrücklich'
where not exists (select 1 from bank_kategorie_regeln where feld = 'purpose' and muster = 'EUST/Zoll');

-- Bestehende Buchungen umstellen (nur regel-/auto-kategorisierte, manuelle bleiben).
update bank_transactions t
set kategorie = 'st_eust',
    kategorie_quelle = 'regel',
    kategorie_regel_id = (select id from bank_kategorie_regeln where feld = 'counterparty_name' and muster = 'DHL Express' limit 1),
    steuer_split = jsonb_build_array(jsonb_build_object(
      'art', 'eust',
      'zeitraum', to_char(t.booking_date, 'YYYY-MM'),
      'jahr', extract(year from t.booking_date)::int,
      'betrag', round(-t.amount, 2)
    ))
where t.amount < 0
  and t.counterparty_name ilike '%DHL Express%'
  and coalesce(t.kategorie_quelle, '') <> 'manuell'
  and t.kategorie is distinct from 'st_eust';
