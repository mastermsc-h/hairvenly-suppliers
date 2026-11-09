-- Ausgaben (z.B. bar bezahlter Einkauf) in derselben App/Tabelle wie die Einnahmen:
-- dritter Bereich 'ausgabe' mit eigenen Arten. Auswertung: Einnahmen − Ausgaben = Saldo.
alter table salon_einnahme_arten drop constraint if exists salon_einnahme_arten_bereich_check;
alter table salon_einnahme_arten add constraint salon_einnahme_arten_bereich_check
  check (bereich in ('verkauf', 'salon', 'ausgabe'));
alter table salon_einnahmen drop constraint if exists salon_einnahmen_bereich_check;
alter table salon_einnahmen add constraint salon_einnahmen_bereich_check
  check (bereich in ('verkauf', 'salon', 'ausgabe'));

insert into salon_einnahme_arten (name, bereich, sortierung)
select v.name, 'ausgabe', v.sortierung
from (values
  ('Material & Verbrauch', 210),
  ('Getränke & Snacks', 220),
  ('Reinigung & Haushalt', 230),
  ('Büro & Porto', 240),
  ('Sonstige Ausgabe', 290)
) as v(name, sortierung)
where not exists (select 1 from salon_einnahme_arten where bereich = 'ausgabe');
