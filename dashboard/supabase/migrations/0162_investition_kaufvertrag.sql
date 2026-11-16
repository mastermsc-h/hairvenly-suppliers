-- Kaufpreis der Übernahme (Kaufvertrag mit Rasoul Navaseri) ist eine Investition, kein Aufwand und
-- nicht "unklar". Regel für künftige Raten + bestehende Buchungen umstellen (manuelle bleiben).
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz)
select 10, 'purpose', 'Kaufvertrag', 'aus', 'investition', 'Kaufpreis Übernahme Hairvenly (Rasoul Navaseri)'
where not exists (select 1 from bank_kategorie_regeln where feld = 'purpose' and muster = 'Kaufvertrag' and richtung = 'aus');

update bank_transactions t
set kategorie = 'investition', kategorie_quelle = 'regel',
    kategorie_regel_id = (select id from bank_kategorie_regeln where feld = 'purpose' and muster = 'Kaufvertrag' and richtung = 'aus' limit 1),
    steuer_split = '[]'::jsonb
where t.amount < 0 and t.purpose ilike '%kaufvertrag%' and coalesce(t.kategorie_quelle, '') <> 'manuell';
