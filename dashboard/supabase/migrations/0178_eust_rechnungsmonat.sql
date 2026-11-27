-- EUSt zählt im Monat der Zollrechnung, nicht der Abbuchung (Steuerberater 27.11.2026:
-- "Einfuhrumsatzsteuer buche ich mit dem Rechnungsdatum"). Carl Ungewitter bucht am
-- Rechnungstag ab; DHL Express ca. 7 Tage später (gemessen an Amanda-Ankünften Apr–Nov 2026).
-- Ausreißer per Hand über eust_monat (Vorrang vor der Regel), Logik: eustMonat() in kategorien.ts.
alter table bank_transactions add column if not exists eust_monat text
  check (eust_monat is null or eust_monat ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Sammelabbuchung 30.10. (ZIT8044246/ZIT8048169) + 02.11. (ZIT8018239): Rechnungen Ende September
-- (Amanda 13.06. angekommen 17.09.) — erklärt die September-Abweichung zum Finanzamt.
update bank_transactions set eust_monat = '2026-09'
where kategorie = 'st_eust' and amount < 0 and eust_monat is null
  and (purpose ilike '%ZIT8044246%' or purpose ilike '%ZIT8048169%' or purpose ilike '%ZIT8018239%');

-- Steuer-Zeitraum aller EUSt-Abbuchungen nach der neuen Regel setzen (wie steuerSplitFuer)
update bank_transactions t
set steuer_split = jsonb_build_array(jsonb_build_object(
  'art', 'eust',
  'zeitraum', z.monat,
  'jahr', substr(z.monat, 1, 4)::int,
  'betrag', round(-t.amount, 2)
))
from (
  select id,
    coalesce(eust_monat,
      case when (coalesce(counterparty_name, '') || ' ' || coalesce(purpose, '')) ~* '(DHL\s*EXPRESS|\mZIT\d{5,})'
        then to_char(booking_date - 7, 'YYYY-MM')
        else to_char(booking_date, 'YYYY-MM') end) as monat
  from bank_transactions where kategorie = 'st_eust' and amount < 0
) z
where t.id = z.id;
