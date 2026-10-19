-- 1) Regeln für Posten des Targobank-Gehaltskontos (Gegenpartei steht dort nur im
--    Verwendungszweck — Name-Regeln greifen dann im Zweck, siehe kategorisiere()).
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (12, 'purpose',           'PRIVATENTNAHME',      'aus', 'privat',                 'Targobank → Privatkonto'),
  (20, 'counterparty_name', 'hkk',                 'aus', 'aus_sozialversicherung', 'Krankenkasse'),
  (20, 'counterparty_name', 'Krankenkasse',        'aus', 'aus_sozialversicherung', null),
  (30, 'counterparty_name', 'EGYM Wellpass',       'aus', 'aus_personal',           'Firmenfitness Mitarbeiter'),
  (30, 'counterparty_name', 'DULLIEN',             'aus', 'aus_miete',              'Dauerauftrag — Lagermiete? (bitte bestätigen)'),
  (30, 'purpose',           'Entgelt EBICS',       'aus', 'aus_bank',               'Targobank'),
  (30, 'purpose',           'Grundgebühr für',     'aus', 'aus_bank',               'Targobank')
on conflict (feld, muster, richtung) do nothing;

-- 2) Kontostände direkt von der Bank (FinTS HKSAL), je Konto der letzte Stand.
--    Sparkasse: Gegenprobe zum Monatsabschluss-Verfahren; Targobank: einzige Quelle
--    (deren Kontoauszug-Texte enthalten keinen Kontostand).
create table if not exists bank_salden (
  account_iban  text primary key,
  saldo         numeric(14,2) not null,
  stand         date not null,
  abgerufen_am  timestamptz not null default now()
);

alter table bank_salden enable row level security;
drop policy if exists "Admin read bank_salden" on bank_salden;
drop policy if exists "Admin manage bank_salden" on bank_salden;
create policy "Admin read bank_salden" on bank_salden
  for select to authenticated using (is_admin());
create policy "Admin manage bank_salden" on bank_salden
  for all to authenticated using (is_admin()) with check (is_admin());

-- 3) Nachtrag nach Durchsicht der Targobank-Umsätze (19.10.2026):
--    Konto …5946 ist das Privatkonto (Überweisungen dorthin heißen "PRIVATENTNAHME").
update bank_kategorie_regeln
   set kategorie = 'privat', notiz = 'Privatkonto Sparkasse …5946 (laut Zweck PRIVATENTNAHME)'
 where feld = 'counterparty_iban' and muster = '0084625946';
--    "PRIVATENTNAHME" im Zweck schlägt jede IBAN-Regel (Prio 3 < 5).
update bank_kategorie_regeln set prioritaet = 3 where feld = 'purpose' and muster = 'PRIVATENTNAHME';
--    Erstattungen der Krankenkassen (AAG, U1/U2) und Betriebskosten-Guthaben mindern Kosten,
--    sind keine Kundenzahlungen.
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (20, 'purpose', 'nach AAG',          'ein', 'aus_sozialversicherung', 'AAG-Erstattung (U1/U2) der Krankenkasse'),
  (20, 'purpose', 'GUTSCHRIFT AOK',    'ein', 'aus_sozialversicherung', 'Erstattung Krankenkasse'),
  (20, 'purpose', 'GUTSCHRIFT IKK',    'ein', 'aus_sozialversicherung', 'Erstattung Krankenkasse'),
  (20, 'purpose', 'GUTSCHRIFT BARMER', 'ein', 'aus_sozialversicherung', 'Erstattung Krankenkasse'),
  (20, 'purpose', 'GUTSCHRIFT hkk',    'ein', 'aus_sozialversicherung', 'Erstattung Krankenkasse'),
  (20, 'purpose', 'GUTSCHRIFT BKK',    'ein', 'aus_sozialversicherung', 'Erstattung Krankenkasse'),
  (30, 'purpose', 'BK-Abr',            'ein', 'aus_miete',              'Betriebskosten-Guthaben')
on conflict (feld, muster, richtung) do nothing;
