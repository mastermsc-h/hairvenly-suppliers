-- Lohnsteuer-Anmeldung als eigene Steuerart im Steuer-Ledger.
-- Die Lohnsteuer (inkl. Soli/KiSt) ist Teil des Bruttolohns (kein Zusatzaufwand), wird aber
-- vom Arbeitgeber einbehalten und monatlich ans Finanzamt abgeführt (fällig 10. Folgemonat).
-- Betrag kommt aus der Lohnabrechnung (DATEV/Steuerberater), wird nicht selbst berechnet.

alter table steuer_posten drop constraint if exists steuer_posten_art_check;
alter table steuer_posten add constraint steuer_posten_art_check
  check (art in (
    'ust_va',
    'ust_nachzahlung',
    'eust',
    'lst_anmeldung',     -- Lohnsteuer-Anmeldung (monatlich)
    'est_vz',
    'est_nachzahlung',
    'gewst_vz',
    'gewst_nachzahlung',
    'sonstige'
  ));

-- Vorbefüllung 2026 (Fälligkeit 10. Folgemonat, auf Werktag verschoben). Idempotent je Zeitraum.
insert into steuer_posten (art, zeitraum, jahr, richtung, faellig_am, notiz)
select v.art, v.zeitraum, v.jahr, v.richtung, v.faellig_am, v.notiz
from (values
  ('lst_anmeldung','2026-01',2026,'zahlung','2026-02-10'::date,'Lohnsteuer Januar'),
  ('lst_anmeldung','2026-02',2026,'zahlung','2026-03-10'::date,'Lohnsteuer Februar'),
  ('lst_anmeldung','2026-03',2026,'zahlung','2026-04-10'::date,'Lohnsteuer März'),
  ('lst_anmeldung','2026-04',2026,'zahlung','2026-05-11'::date,'Lohnsteuer April'),
  ('lst_anmeldung','2026-05',2026,'zahlung','2026-06-10'::date,'Lohnsteuer Mai'),
  ('lst_anmeldung','2026-06',2026,'zahlung','2026-07-10'::date,'Lohnsteuer Juni'),
  ('lst_anmeldung','2026-07',2026,'zahlung','2026-08-10'::date,'Lohnsteuer Juli'),
  ('lst_anmeldung','2026-08',2026,'zahlung','2026-09-10'::date,'Lohnsteuer August'),
  ('lst_anmeldung','2026-09',2026,'zahlung','2026-10-12'::date,'Lohnsteuer September'),
  ('lst_anmeldung','2026-10',2026,'zahlung','2026-11-10'::date,'Lohnsteuer Oktober'),
  ('lst_anmeldung','2026-11',2026,'zahlung','2026-12-10'::date,'Lohnsteuer November'),
  ('lst_anmeldung','2026-12',2026,'zahlung','2027-01-11'::date,'Lohnsteuer Dezember')
) as v(art, zeitraum, jahr, richtung, faellig_am, notiz)
where not exists (
  select 1 from steuer_posten s where s.art = v.art and s.zeitraum = v.zeitraum
);
