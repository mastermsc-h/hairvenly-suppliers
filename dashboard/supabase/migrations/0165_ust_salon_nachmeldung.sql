-- USt-VA Oktober 2026 laut DATEV-Übermittlungsprotokoll (17.11.2026): Überschuss Kz. 83 −14.321,17 €
-- (vorher Schätzung 22.000 € Erstattung). Erstattung kommt erfahrungsgemäß ~10 Tage nach Übermittlung.
update steuer_posten
set soll_betrag = 14321.17, richtung = 'erstattung', soll_schaetzung = false, faellig_am = '2026-11-27',
    notiz = 'USt-VA Oktober laut Übermittlungsprotokoll 17.11.2026: Überschuss 14.321,17 € (ohne Salon-Umsätze gemeldet)',
    updated_at = now()
where art = 'ust_va' and zeitraum = '2026-10' and jahr = 2026 and ist_betrag = 0;

-- Salon-Umsätze (Treatwell-Konto: Nexi-Karte, Treatwell, Bar) fehlen in den Voranmeldungen Jul–Okt 2026
-- (Kz. 81 Sep/Okt = genau Shop Deutschland netto). Eingänge Jul–Okt 176.999,75 € brutto → 28.260,46 € USt.
-- Offene Nachzahlung bis zur berichtigten Voranmeldung; Fälligkeit geschätzt.
insert into steuer_posten (art, zeitraum, jahr, richtung, soll_betrag, soll_schaetzung, faellig_am, notiz)
select 'ust_nachzahlung', 'Salon Jul–Okt 2026', 2026, 'zahlung', 28260.46, true, '2026-12-10',
       'Salon-Umsätze Jul–Okt 2026 nicht in den USt-Voranmeldungen (176.999,75 € brutto lt. Treatwell-Konto). Berichtigte VAs durch Steuerberater; nach Zahlung hier Ist eintragen.'
where not exists (select 1 from steuer_posten where art = 'ust_nachzahlung' and zeitraum = 'Salon Jul–Okt 2026');
