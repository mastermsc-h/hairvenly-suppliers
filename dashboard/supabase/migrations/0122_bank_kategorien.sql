-- Kontoumsätze kategorisieren (Reiter /finances/bank) + Finanzamt-Buchungen
-- automatisch in den Steuer-Ledger übernehmen.
--
-- Kategorie ist unabhängig vom Vorkasse-Abgleich (match_status bleibt unberührt).
-- Logik: src/lib/bank/kategorien.ts (Smoke: scripts/smoke/bank-kategorien.spec.mjs).

alter table bank_transactions
  add column if not exists kategorie         text,
  add column if not exists kategorie_quelle  text check (kategorie_quelle in ('auto', 'regel', 'manuell')),
  add column if not exists kategorie_regel_id uuid,
  add column if not exists steuer_split      jsonb not null default '[]'::jsonb;

create index if not exists bank_tx_kategorie_idx on bank_transactions (kategorie);

-- Regeln: Teilstring (Groß-/Kleinschreibung egal) in einem Feld → Kategorie.
-- Niedrigste Priorität gewinnt; bei Gleichstand das längere Muster.
create table if not exists bank_kategorie_regeln (
  id          uuid primary key default gen_random_uuid(),
  prioritaet  int  not null default 50,
  feld        text not null check (feld in ('counterparty_name', 'counterparty_iban', 'purpose', 'posting_text')),
  muster      text not null check (length(trim(muster)) >= 2),
  richtung    text not null default 'alle' check (richtung in ('ein', 'aus', 'alle')),
  kategorie   text not null,
  notiz       text,
  created_at  timestamptz not null default now(),
  unique (feld, muster, richtung)
);

alter table bank_kategorie_regeln enable row level security;
create policy "Admin read bank_kategorie_regeln" on bank_kategorie_regeln
  for select to authenticated using (is_admin());
create policy "Admin manage bank_kategorie_regeln" on bank_kategorie_regeln
  for all to authenticated using (is_admin()) with check (is_admin());

-- Steuer-Ledger: Herkunft des Ist-Betrags + was die Bank sagt.
-- Ein von Hand eingetragenes Ist (ist_quelle = 'manuell') überschreibt die Bank nie.
alter table steuer_posten
  add column if not exists ist_quelle          text not null default 'manuell' check (ist_quelle in ('manuell', 'bank')),
  add column if not exists bank_betrag         numeric(12,2),   -- + gezahlt, − erstattet (Summe aller Buchungen)
  add column if not exists bank_anzahl         int,
  add column if not exists bank_letzte_buchung date;

-- ---------------------------------------------------------------------------
-- Startregeln aus den echten Umsätzen (Juli–Okt 2026). Steuern beim Finanzamt
-- werden NICHT per Regel, sondern über den Verwendungszweck erkannt.
-- ---------------------------------------------------------------------------
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  -- Eigene Konten (IBAN-Teilstring der Kontonummer)
  (5,  'counterparty_iban', '0084626001', 'alle', 'umbuchung', 'Sparkasse …6001'),
  (5,  'counterparty_iban', '0084626019', 'alle', 'umbuchung', 'Sparkasse …6019'),
  (5,  'counterparty_iban', '0084625946', 'alle', 'umbuchung', 'Sparkasse …5946'),
  -- Einfuhrabgaben
  (10, 'counterparty_name', 'Ungewitter',  'aus', 'st_eust', 'Zollagent: EUSt + Zoll + Gebühren'),
  (10, 'purpose',           'DHL EXPRESS', 'aus', 'st_eust', 'DHL Express Import-Abgaben (ZIT-Rechnungen)'),
  (10, 'counterparty_name', 'Hauptzollamt','aus', 'st_eust', null),
  (10, 'counterparty_name', 'Bundeskasse', 'aus', 'st_eust', 'Zoll zahlt über die Bundeskasse'),
  -- Personal
  (20, 'purpose',           'auf Gehaltskonto', 'aus', 'aus_personal', 'Übertrag Gehaltskonto (Löhne werden von dort gezahlt?)'),
  (20, 'counterparty_name', 'AOK',               'aus', 'aus_sozialversicherung', null),
  (20, 'counterparty_name', 'Techniker Krankenkasse', 'aus', 'aus_sozialversicherung', null),
  (20, 'counterparty_name', 'Barmer',            'aus', 'aus_sozialversicherung', null),
  (20, 'counterparty_name', 'DAK-Gesundheit',               'aus', 'aus_sozialversicherung', null),
  (20, 'counterparty_name', 'IKK ',               'aus', 'aus_sozialversicherung', null),
  (20, 'counterparty_name', 'BKK',               'aus', 'aus_sozialversicherung', null),
  (20, 'counterparty_name', 'Knappschaft',       'aus', 'aus_sozialversicherung', 'auch Minijob-Zentrale'),
  (20, 'counterparty_name', 'Minijob',           'aus', 'aus_sozialversicherung', null),
  -- Einnahmen
  (30, 'counterparty_name', 'STRIPE',     'ein', 'ein_shop', null),
  (30, 'counterparty_name', 'PAYPAL',     'ein', 'ein_shop', null),
  (30, 'counterparty_name', 'NEXI GERMANY','ein', 'ein_karte', null),
  (30, 'counterparty_name', 'TREATWELL',  'ein', 'ein_treatwell', null),
  (30, 'posting_text',      'BARGELDEINZAHLUNG', 'ein', 'ein_bargeld', null),
  -- Finanzierung
  (30, 'counterparty_name', 'Shopify Capital', 'aus', 'aus_kredit', 'Tilgung, kein Aufwand'),
  -- Wareneinkauf Haare
  (30, 'counterparty_name', 'HAIR PRODUCTS', 'aus', 'aus_wareneinkauf', null),
  (30, 'counterparty_name', 'GREECOR',       'aus', 'aus_wareneinkauf', null),
  -- Material
  (30, 'counterparty_name', 'Wella',         'aus', 'aus_material', null),
  (30, 'counterparty_name', 'Hans Conzen',   'aus', 'aus_material', null),
  (30, 'counterparty_name', 'Reichert Haircompany', 'aus', 'aus_material', null),
  -- Gebühren
  (30, 'counterparty_name', 'NEXI GERMANY',  'aus', 'aus_bank', 'Terminal-Gebühren'),
  (30, 'counterparty_name', 'PROVISION',     'aus', 'aus_bank', 'Auslandsüberweisung'),
  (30, 'counterparty_name', 'COURTAGE',      'aus', 'aus_bank', 'Auslandsüberweisung'),
  (30, 'counterparty_name', 'SPESEN',        'aus', 'aus_bank', 'Auslandsüberweisung'),
  (30, 'counterparty_name', 'BANK OF NEW YORK', 'aus', 'aus_bank', 'Korrespondenzbank'),
  (30, 'counterparty_name', 'CHINA CONSTRUCTION BANK', 'aus', 'aus_bank', 'Korrespondenzbank'),
  (30, 'counterparty_name', 'COMMERCIAL BANK OF CHINA', 'aus', 'aus_bank', 'Korrespondenzbank'),
  (30, 'counterparty_name', 'PAYONE',        'aus', 'aus_bank', null),
  -- Betrieb
  (30, 'counterparty_name', 'WSG Bremen',    'aus', 'aus_steuerberater', null),
  (30, 'counterparty_name', 'E.ON',          'aus', 'aus_energie', null),
  (30, 'counterparty_name', 'swb ',           'aus', 'aus_energie', null),
  (30, 'counterparty_name', 'Vodafone',      'aus', 'aus_telefon', null),
  (30, 'counterparty_name', 'Telekom',       'aus', 'aus_telefon', null),
  (30, 'counterparty_name', 'RegioHelden',   'aus', 'aus_marketing', null),
  (30, 'counterparty_name', 'Kleinanzeigen', 'aus', 'aus_marketing', null),
  (30, 'counterparty_name', 'Shopify International', 'aus', 'aus_software', null),
  (30, 'counterparty_name', 'ALFAHOSTING',   'aus', 'aus_software', null),
  (30, 'counterparty_name', 'PLANITY',       'aus', 'aus_software', 'Salon-Buchungssoftware'),
  (30, 'counterparty_name', 'Haufe',         'aus', 'aus_software', null),
  (30, 'counterparty_name', 'ARAG ',          'aus', 'aus_versicherung', null),
  (30, 'counterparty_name', 'VHV',           'aus', 'aus_versicherung', null),
  (30, 'counterparty_name', 'Culligan',      'aus', 'aus_buero', 'Wasserspender'),
  (30, 'counterparty_name', 'flaschenpost',  'aus', 'aus_buero', null),
  (30, 'counterparty_name', 'VITAMINTAXI',   'aus', 'aus_buero', 'Obstkorb'),
  (30, 'counterparty_name', 'Gastro Express','aus', 'aus_buero', null),
  (30, 'counterparty_name', 'AMAZON',        'aus', 'aus_buero', null),
  (30, 'counterparty_name', 'Innung',        'aus', 'aus_beitraege', null),
  (30, 'counterparty_name', 'Rundfunk',      'aus', 'aus_beitraege', null),
  (40, 'counterparty_name', 'Landesbank Hessen', 'aus', 'aus_karte', 'Debitkarte, Händler steht nicht im Zweck'),
  -- Versand (nach DHL Express!)
  (50, 'counterparty_name', 'DHL',           'alle', 'aus_versand', null),
  (50, 'counterparty_name', 'Deutsche Post', 'alle', 'aus_versand', null)
on conflict (feld, muster, richtung) do nothing;

-- Nachtrag nach Trockenlauf mit echten Daten (16.10.2026)
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (25, 'purpose',      'rueckerstattung',  'aus',  'aus_rueckerstattung', null),
  (25, 'purpose',      'rückerstattung',   'aus',  'aus_rueckerstattung', null),
  (25, 'purpose',      'rückzahlung',      'aus',  'aus_rueckerstattung', null),
  (25, 'purpose',      'rueckzahlung',     'aus',  'aus_rueckerstattung', null),
  (30, 'posting_text', 'ENTGELTABSCHLUSS', 'alle', 'aus_bank', 'Kontoführung Sparkasse'),
  (30, 'purpose',      'SPARKASSE BREMEN', 'aus',  'aus_bank', 'Sparkassen-Rechnungen')
on conflict (feld, muster, richtung) do nothing;
