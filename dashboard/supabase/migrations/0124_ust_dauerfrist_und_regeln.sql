-- 1) Dauerfristverlängerung (User-Bestätigung 16.10.2026): USt-VA ist am 10. des
--    ÜBERNÄCHSTEN Monats fällig (Wochenende → Montag). Die Vorbefüllung aus 0111 ging
--    vom Folgemonat aus — dadurch erschienen pünktliche Zahlungen als "verspätet".
--    Lohnsteuer bleibt beim 10. des Folgemonats. Spiegel: faelligkeit() in
--    src/lib/bank/kategorien.ts.
with d as (
  select id, (to_date(zeitraum || '-10', 'YYYY-MM-DD') + interval '2 month')::date as f
  from steuer_posten
  where art = 'ust_va' and zeitraum ~ '^\d{4}-\d{2}$'
)
update steuer_posten s
   set faellig_am = case extract(isodow from d.f)
                      when 6 then d.f + 2
                      when 7 then d.f + 1
                      else d.f
                    end
  from d
 where s.id = d.id;

-- 2) Allgemeine Regeln für Ausgänge, die vor allem vom Targobank-Gehaltskonto kommen.
--    Prio 40: hinter IBAN-/Gehaltskonto-Regeln (5/20), Finanzamt-Zwecke greifen vorher.
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (40, 'purpose', 'gehalt', 'aus', 'aus_personal', 'Gehaltszahlungen'),
  (40, 'purpose', 'lohn',   'aus', 'aus_personal', 'Lohnzahlungen'),
  (40, 'purpose', 'miete',  'aus', 'aus_miete',    'Miete und Lagermiete')
on conflict (feld, muster, richtung) do nothing;
