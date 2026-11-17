-- Eigene Kranken-/Pflegeversicherung des Inhabers (AOK, Versichertennummer im Verwendungszweck)
-- ist PRIVAT (Sonderausgabe in der Einkommensteuer), keine Betriebsausgabe und keine
-- Arbeitgeber-Sozialversicherung. Bisher fiel sie unter aus_sozialversicherung.
-- Gefunden 17.11.2026: 01.07. 9.576,48 €, 31.07. 1.226,23 €, 06.10. 2.464,46 €, 15.10. 1.246,33 €,
-- 16.11. 1.214,23 € (plus Lastschrift 18.05. 8.179,30 € mit Rückgabe mangels Deckung).
-- Die Betriebs-Beitragsnachweise laufen über die Betriebsnummer 72651123 und bleiben Sozialversicherung.
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz)
select 10, 'purpose', 'D028779660', 'alle', 'privat', 'Eigene Krankenversicherung des Inhabers (AOK) = privat, nicht Personal'
where not exists (select 1 from bank_kategorie_regeln where feld = 'purpose' and muster = 'D028779660');

update bank_transactions t
set kategorie = 'privat',
    kategorie_quelle = 'regel',
    kategorie_regel_id = (select id from bank_kategorie_regeln where feld = 'purpose' and muster = 'D028779660' limit 1),
    steuer_split = '[]'::jsonb
where t.purpose ilike '%D028779660%'
  and coalesce(t.kategorie_quelle, '') <> 'manuell'
  and t.kategorie is distinct from 'privat';
