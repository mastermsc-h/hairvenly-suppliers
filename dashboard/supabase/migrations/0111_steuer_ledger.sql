-- Steuer-Ledger: Soll/Ist-Konto für alle Steuerverpflichtungen (Einzelunternehmen).
-- Beantwortet: Was ist offen? Was wurde bezahlt? Wurde die Erstattung erhalten?
-- Stufe 1 = manuelle Pflege; Stufe 2 (Bank-Abgleich) füllt ist_betrag automatisch.

create table if not exists steuer_posten (
  id            uuid primary key default gen_random_uuid(),
  -- Art der Steuer / des Postens
  art           text not null default 'sonstige'
                check (art in (
                  'ust_va',            -- Umsatzsteuer-Voranmeldung
                  'ust_nachzahlung',   -- USt-Jahreserklärung Nachzahlung
                  'est_vz',            -- Einkommensteuer-Vorauszahlung (inkl. Soli/KiSt)
                  'est_nachzahlung',   -- ESt-Bescheid Nachzahlung
                  'gewst_vz',          -- Gewerbesteuer-Vorauszahlung
                  'gewst_nachzahlung', -- GewSt-Bescheid Nachzahlung
                  'sonstige'
                )),
  zeitraum      text not null,                    -- '2026-07', 'Q3 2026', '2026'
  jahr          int  not null,                    -- 2026 (für Jahres-Filter/Kacheln)
  -- Richtung: zahlen wir (zahlung) oder bekommen wir zurück (erstattung)?
  richtung      text not null default 'zahlung'
                check (richtung in ('zahlung', 'erstattung')),
  soll_betrag   numeric(12,2) not null default 0, -- Betrag laut DATEV/Bescheid (Betrag, positiv)
  faellig_am    date,                             -- Fälligkeit / Zahltermin
  ist_betrag    numeric(12,2) not null default 0, -- tatsächlich gezahlt/erhalten (Stufe 2: Bank)
  bezahlt_am    date,                             -- Datum der Zahlung/Erstattung
  bescheid_ref  text,                             -- Bescheid-Nr. / USt-VA-Referenz
  notiz         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists steuer_posten_jahr_idx on steuer_posten (jahr);
create index if not exists steuer_posten_faellig_idx on steuer_posten (faellig_am);

alter table steuer_posten enable row level security;

-- Steuerdaten sind sensibel: nur Admins/Mitarbeiter mit finances-Feature.
-- RLS auf Tabellenebene = Admin-only; Feature-Gate passiert zusätzlich in der App.
create policy "Admin read steuer_posten" on steuer_posten for select to authenticated using (is_admin());
create policy "Admin manage steuer_posten" on steuer_posten for all to authenticated
  using (is_admin()) with check (is_admin());

-- updated_at Trigger
create or replace function set_steuer_posten_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_steuer_posten_updated_at on steuer_posten;
create trigger trg_steuer_posten_updated_at
  before update on steuer_posten
  for each row execute function set_steuer_posten_updated_at();

-- ---------------------------------------------------------------------------
-- Vorbefüllung 2026: typische Einzelunternehmer-Termine (Beträge = 0, zum Ausfüllen).
-- Nur wenn Tabelle leer ist (idempotent bei Re-Run).
-- ---------------------------------------------------------------------------
insert into steuer_posten (art, zeitraum, jahr, richtung, faellig_am, notiz)
select * from (values
  -- USt-Voranmeldung monatlich, fällig 10. des Folgemonats (ohne Dauerfristverlängerung)
  ('ust_va','2026-01',2026,'zahlung','2026-02-10'::date,'USt-VA Januar'),
  ('ust_va','2026-02',2026,'zahlung','2026-03-10'::date,'USt-VA Februar'),
  ('ust_va','2026-03',2026,'zahlung','2026-04-10'::date,'USt-VA März'),
  ('ust_va','2026-04',2026,'zahlung','2026-05-10'::date,'USt-VA April'),
  ('ust_va','2026-05',2026,'zahlung','2026-06-10'::date,'USt-VA Mai'),
  ('ust_va','2026-06',2026,'zahlung','2026-07-10'::date,'USt-VA Juni'),
  ('ust_va','2026-07',2026,'zahlung','2026-08-10'::date,'USt-VA Juli'),
  ('ust_va','2026-08',2026,'zahlung','2026-09-10'::date,'USt-VA August'),
  ('ust_va','2026-09',2026,'zahlung','2026-10-12'::date,'USt-VA September'),
  ('ust_va','2026-10',2026,'zahlung','2026-11-10'::date,'USt-VA Oktober'),
  ('ust_va','2026-11',2026,'zahlung','2026-12-10'::date,'USt-VA November'),
  ('ust_va','2026-12',2026,'zahlung','2027-01-11'::date,'USt-VA Dezember'),
  -- Einkommensteuer-Vorauszahlung quartalsweise (10.03./10.06./10.09./10.12.)
  ('est_vz','Q1 2026',2026,'zahlung','2026-03-10'::date,'ESt-Vorauszahlung Q1 (inkl. Soli)'),
  ('est_vz','Q2 2026',2026,'zahlung','2026-06-10'::date,'ESt-Vorauszahlung Q2 (inkl. Soli)'),
  ('est_vz','Q3 2026',2026,'zahlung','2026-09-10'::date,'ESt-Vorauszahlung Q3 (inkl. Soli)'),
  ('est_vz','Q4 2026',2026,'zahlung','2026-12-10'::date,'ESt-Vorauszahlung Q4 (inkl. Soli)'),
  -- Gewerbesteuer-Vorauszahlung quartalsweise (15.02./15.05./15.08./15.11.)
  ('gewst_vz','Q1 2026',2026,'zahlung','2026-02-16'::date,'GewSt-Vorauszahlung Q1'),
  ('gewst_vz','Q2 2026',2026,'zahlung','2026-05-15'::date,'GewSt-Vorauszahlung Q2'),
  ('gewst_vz','Q3 2026',2026,'zahlung','2026-08-17'::date,'GewSt-Vorauszahlung Q3'),
  ('gewst_vz','Q4 2026',2026,'zahlung','2026-11-16'::date,'GewSt-Vorauszahlung Q4')
) as v(art, zeitraum, jahr, richtung, faellig_am, notiz)
where not exists (select 1 from steuer_posten);
