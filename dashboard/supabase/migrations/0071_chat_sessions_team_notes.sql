-- Team-Notizen pro Session: interne Notizen für die Mitarbeiterinnen
-- (z.B. "warte auf Rückmeldung Aria wg. Liefertermin", "Kundin will Beratung
-- vor Ort am Mittwoch", "noch zu klären mit Lager"). Nur für Team sichtbar,
-- nie an Kundin gesendet.
alter table chat_sessions
  add column if not exists team_notes text;
