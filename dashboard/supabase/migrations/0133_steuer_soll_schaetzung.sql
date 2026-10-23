-- Soll-Beträge können eine Schätzung sein (bis der Steuerberater/DATEV den echten Wert liefert).
-- Wird in Vorauszahlungen, Übersicht (Finanzamt-Abgleich) und Liquiditätsvorschau angezeigt.
alter table steuer_posten add column if not exists soll_schaetzung boolean not null default false;

-- USt-VA September 2026: Schätzung (User-Freigabe 23.10.2026) — USt aus den Konto-Eingängen
-- September (223.950 € × 19/119 = 35.757 €) minus gezahlte EUSt (Carl Ungewitter 15.09.: 17.556 €).
-- Methode trifft Jan–Aug 2026 aggregiert auf 3 % (151.714 € geschätzt vs. 147.475 € gezahlt).
update steuer_posten
   set soll_betrag = 18200,
       soll_schaetzung = true,
       notiz = 'USt-VA September — SCHÄTZUNG 18.200 € (USt aus Eingängen 35.757 € − EUSt 17.556 €); echten Wert vom Steuerberater/DATEV eintragen'
 where art = 'ust_va' and zeitraum = '2026-09' and ist_betrag = 0;
