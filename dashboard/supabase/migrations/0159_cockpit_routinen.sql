-- Startbildschirm "Routinen": wiederkehrende Aufgaben.
--   art 'intervall': alle intervall_tage fällig; letzte Erledigung = max(manuell, letzte Lieferantenbestellung
--                    deren Lieferantenname quelle enthält, z.B. 'Ebru')
--   art 'lager':     fällig, sobald eines der Produkte kürzer reicht als lieferzeit_tage + puffer_tage
--                    (Bestand live aus Shopify, Verkauf aus shopify_variant_daily_sales); nach "Erledigt"
--                    (bestellt) ruht die Routine für lieferzeit_tage.
create table if not exists cockpit_routinen (
  id                 uuid primary key default gen_random_uuid(),
  titel              text not null,
  art                text not null default 'intervall' check (art in ('intervall', 'lager')),
  intervall_tage     int,
  quelle             text,
  lieferzeit_tage    int,
  puffer_tage        int not null default 14,
  produkte           jsonb not null default '[]'::jsonb,  -- [{ handle, titel }]
  letzte_erledigung  date,
  erledigt_von       text,
  notiz              text not null default '',
  farbe              text,
  sort               double precision not null default 0,
  created_at         timestamptz not null default now()
);
alter table cockpit_routinen enable row level security;

insert into cockpit_routinen (titel, art, intervall_tage, quelle, farbe, sort, notiz)
select * from (values
  ('Ebru bestellen', 'intervall', 14, 'Ebru', '#7c5cff', 1::double precision, 'Alle zwei Wochen – China/Türkei'),
  ('Amanda bestellen', 'intervall', 30, 'Amanda', '#f0508f', 2::double precision, 'Einmal im Monat')
) v(titel, art, intervall_tage, quelle, farbe, sort, notiz)
where not exists (select 1 from cockpit_routinen);

insert into cockpit_routinen (titel, art, lieferzeit_tage, puffer_tage, farbe, sort, notiz, produkte)
select 'Reichert bestellen', 'lager', 60, 14, '#0fb5ba', 3, 'Haarpflege & Löser – Reichert liefert erst nach ca. 2 Monaten',
  '[{"handle":"bonding-loser-schonend-tape","titel":"Tape & Bonding Löser"},
    {"handle":"blessed-hairboost-shampoo","titel":"Blessed Hairboost Shampoo"},
    {"handle":"blessed-no-yellow-shampoo","titel":"Blessed No Yellow Shampoo"},
    {"handle":"blessed-hydrating-conditioner","titel":"Blessed Hydrating Conditioner"},
    {"handle":"blessed-masque-pour","titel":"Blessed Masque Pour"},
    {"handle":"blessed-richness-treatment","titel":"Blessed Richness Treatment"},
    {"handle":"blessed-hitzeschutzspray","titel":"Blessed Hitzeschutz Spray"}]'::jsonb
where not exists (select 1 from cockpit_routinen where art = 'lager');
