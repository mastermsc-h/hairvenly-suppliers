-- Kunden-Analyse (Shopify): eine Zeile pro Bestellung mit den Merkmalen, die die
-- Analyse braucht — KEINE Klarnamen. Die Namensherkunft ist eine statistische
-- Schätzung aus Vor-/Nachname und wird nur aggregiert angezeigt.
create table if not exists kunden_bestellungen (
  order_id      bigint primary key,            -- Shopify Order-ID (numerisch)
  order_name    text,
  created_at    timestamptz not null,
  umsatz_eur    numeric(12,2) not null default 0, -- aktueller Gesamtbetrag (nach Erstattungen)
  waehrung      text,
  land          text,                          -- ISO-2 (Lieferadresse, sonst Rechnung)
  stadt         text,
  plz           text,
  customer_id   bigint,                        -- null bei Gastbestellung ohne Kundenkonto
  kanal         text,                          -- web / pos / shopify_draft_order / …
  gewerbe       boolean not null default false,-- B2B-Tag am Kunden oder an der Bestellung
  firma         boolean not null default false,-- Firmenname in der Adresse angegeben
  storniert     boolean not null default false,
  herkunft      text,                          -- Namensherkunft (Schätzung), siehe name_herkunft_cache
  synced_at     timestamptz not null default now()
);
create index if not exists kunden_bestellungen_created_idx on kunden_bestellungen (created_at);
create index if not exists kunden_bestellungen_customer_idx on kunden_bestellungen (customer_id, created_at);

-- Klassifizierungs-Cache: Schlüssel = SHA-256 des normalisierten Namens, kein Klartext.
create table if not exists name_herkunft_cache (
  name_hash  text primary key,
  herkunft   text not null,
  methode    text not null,                    -- 'llm' | 'regel'
  created_at timestamptz not null default now()
);

alter table kunden_bestellungen enable row level security;
alter table name_herkunft_cache enable row level security;
drop policy if exists "Admin read kunden_bestellungen" on kunden_bestellungen;
create policy "Admin read kunden_bestellungen" on kunden_bestellungen
  for select to authenticated using (is_admin());
drop policy if exists "Admin read name_herkunft_cache" on name_herkunft_cache;
create policy "Admin read name_herkunft_cache" on name_herkunft_cache
  for select to authenticated using (is_admin());

-- Basis: n-te Bestellung des Kunden (Gäste ohne Konto zählen als Erstbestellung)
create or replace view kunden_bestellungen_v with (security_invoker = true) as
select b.*,
       date_trunc('month', b.created_at at time zone 'Europe/Berlin')::date as monat,
       case when b.customer_id is null then 1
            else row_number() over (partition by b.customer_id order by b.created_at) end as nr_beim_kunden
from kunden_bestellungen b
where not b.storniert;

-- Monat × Herkunft × Segment × Neu/Stamm
create or replace view kunden_monat_v with (security_invoker = true) as
select monat,
       coalesce(herkunft, 'unklar') as herkunft,
       gewerbe,
       (nr_beim_kunden = 1) as neukunde,
       count(*)::int as bestellungen,
       sum(umsatz_eur)::numeric(14,2) as umsatz,
       count(distinct coalesce(customer_id, -order_id))::int as kunden
from kunden_bestellungen_v
group by 1, 2, 3, 4;

-- Aktive / neue Kunden pro Monat und Segment (distinct korrekt über alle Herkünfte)
create or replace view kunden_segment_monat_v with (security_invoker = true) as
select monat,
       gewerbe,
       count(*)::int as bestellungen,
       sum(umsatz_eur)::numeric(14,2) as umsatz,
       count(distinct coalesce(customer_id, -order_id))::int as kunden,
       count(distinct coalesce(customer_id, -order_id)) filter (where nr_beim_kunden = 1)::int as neue_kunden
from kunden_bestellungen_v
group by 1, 2;

-- Land pro Monat
create or replace view kunden_land_monat_v with (security_invoker = true) as
select monat, coalesce(land, '??') as land, count(*)::int as bestellungen, sum(umsatz_eur)::numeric(14,2) as umsatz
from kunden_bestellungen_v
group by 1, 2;

-- Städte (normalisiert) pro Halbjahr
create or replace view kunden_stadt_v with (security_invoker = true) as
select (extract(year from monat)::int * 10 + case when extract(month from monat) <= 6 then 1 else 2 end) as halbjahr,
       coalesce(land, '??') as land,
       lower(btrim(stadt)) as stadt_key,
       min(btrim(stadt)) as stadt,
       count(*)::int as bestellungen,
       sum(umsatz_eur)::numeric(14,2) as umsatz,
       count(distinct coalesce(customer_id, -order_id))::int as kunden
from kunden_bestellungen_v
where stadt is not null and btrim(stadt) <> ''
group by 1, 2, 3;

-- Kanal pro Monat
create or replace view kunden_kanal_monat_v with (security_invoker = true) as
select monat, coalesce(kanal, 'sonstige') as kanal, gewerbe, count(*)::int as bestellungen, sum(umsatz_eur)::numeric(14,2) as umsatz
from kunden_bestellungen_v
group by 1, 2, 3;

-- Kundenebene: Bestellungen/Umsatz pro Kunde je Segment und Herkunft (Lifetime)
create or replace view kunden_lifetime_v with (security_invoker = true) as
select gewerbe,
       coalesce(herkunft, 'unklar') as herkunft,
       count(*)::int as kunden,
       sum(n)::int as bestellungen,
       sum(u)::numeric(14,2) as umsatz,
       count(*) filter (where n >= 2)::int as wiederkaeufer
from (
  select coalesce(customer_id, -order_id) as k, bool_or(gewerbe) as gewerbe, max(herkunft) as herkunft,
         count(*) as n, sum(umsatz_eur) as u
  from kunden_bestellungen_v
  group by 1
) x
group by 1, 2;
