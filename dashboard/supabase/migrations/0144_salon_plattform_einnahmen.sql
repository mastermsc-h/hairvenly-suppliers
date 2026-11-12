-- Salon-Konto …6001: Online-Buchungen laufen über Stripe ein — bis 06/2026 Planity, seit 07/2026
-- Treatwell (Verwendungszweck "PLANITY GMBH" / "TREATWELL DACH GMBH"). Die allgemeine Regel
-- "STRIPE" (prio 30) hat sie als Shop-Auszahlungen gezählt. Shopify/TikTok über Stripe bleiben Shop.
-- Muster mit Firmenzusatz, damit Überträge wie "… auf Planity Konto" nicht getroffen werden.
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz)
select 20, 'purpose', v.muster, 'ein', 'ein_treatwell', v.notiz
from (values
  ('TREATWELL DACH', 'Salon-Buchungen über Treatwell (Auszahlung via Stripe, Konto …6001)'),
  ('PLANITY GMBH', 'Salon-Buchungen über Planity bis 06/2026 (Auszahlung via Stripe, Konto …6001)')
) as v(muster, notiz)
where not exists (select 1 from bank_kategorie_regeln r where r.feld = 'purpose' and r.muster = v.muster and r.richtung = 'ein');

update bank_transactions t
set kategorie = 'ein_treatwell',
    kategorie_quelle = 'regel',
    kategorie_regel_id = (select id from bank_kategorie_regeln r where r.feld = 'purpose' and r.richtung = 'ein'
                          and r.muster = case when t.purpose ilike '%treatwell%' then 'TREATWELL DACH' else 'PLANITY GMBH' end),
    steuer_split = '[]'::jsonb
where t.amount > 0
  and (t.purpose ilike '%treatwell dach%' or t.purpose ilike '%planity gmbh%')
  and coalesce(t.kategorie_quelle, '') <> 'manuell'
  and t.kategorie is distinct from 'ein_treatwell';
