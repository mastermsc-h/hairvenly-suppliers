-- Regeln nach dem Targobank-Backfill ab 07/2025 (20.10.2026).
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  -- Eingangsseite der Überträge Sparkasse → Gehaltskonto (älteres Format ohne IBAN im Zweck)
  (8,  'purpose', 'auf Gehaltskonto',           'ein',  'umbuchung',              'Übertrag von der Sparkasse (Eingang Targobank)'),
  -- Zurückgegebene Lastschrift eines SV-Beitrags (z.B. "mangels Deckung")
  (20, 'purpose', 'EINZUG BEITRAG',             'alle', 'aus_sozialversicherung', 'Beitragseinzug Krankenkasse inkl. Rücklastschrift'),
  -- Stornierte Gehaltsüberweisungen + Rückzahlungen von Mitarbeitern mindern die Personalkosten
  (25, 'purpose', 'STORNO ECHTZEITÜBERWEISUNG', 'ein',  'aus_personal',           'Storno Gehaltsüberweisung'),
  (35, 'purpose', 'LOHN / GEHALT / RENTE',      'ein',  'aus_personal',           'Rückzahlung Mitarbeiter (Überträge von der Sparkasse greifen vorher per IBAN/Zweck)'),
  -- Targobank-Kartenentgelte
  (30, 'purpose', 'ENTGELT KONTAKTLOS',         'aus',  'aus_bank',               'Targobank'),
  (30, 'purpose', 'ENTGELT FÜR BERECHTIGTE',    'aus',  'aus_bank',               'Targobank')
on conflict (feld, muster, richtung) do nothing;
