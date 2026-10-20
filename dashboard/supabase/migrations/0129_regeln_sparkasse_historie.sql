-- Eindeutige Gegenparteien aus der Sparkasse-Historie ab 07/2025 (20.10.2026).
insert into bank_kategorie_regeln (prioritaet, feld, muster, richtung, kategorie, notiz) values
  (50, 'counterparty_name', 'DeutschePost',         'alle', 'aus_versand',       'Schreibweise ohne Leerzeichen'),
  (50, 'counterparty_name', 'FedEx',                'alle', 'aus_versand',       null),
  (30, 'counterparty_name', 'XIAOYU PACK',          'aus',  'aus_material',      'Verpackung (Wenzhou Xiaoyu Packing/Packaging)'),
  (30, 'counterparty_name', 'Gieseke',              'aus',  'aus_material',      'Friseurbedarf'),
  (30, 'counterparty_name', 'Berufsgenossenschaft', 'aus',  'aus_versicherung',  'gesetzliche Unfallversicherung'),
  (30, 'counterparty_name', 'Reifen-Plate',         'alle', 'aus_miete',         'Vermieter (auch Betriebskosten)'),
  (30, 'counterparty_name', 'Reklame',              'aus',  'aus_marketing',     'Werbung/Beschilderung'),
  (30, 'counterparty_name', 'RESTAURANT',           'aus',  'aus_buero',         'Bewirtung'),
  (30, 'counterparty_name', 'Treatwell',            'aus',  'aus_software',      'Treatwell-Gebühren')
on conflict (feld, muster, richtung) do nothing;
