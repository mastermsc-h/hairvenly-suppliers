-- Startbildschirm „Gewerbekunden“: Monatsverlauf + Kennzahlen aus kunden_bestellungen (gewerbe = Kunde/Bestellung mit Tag B2B).
create or replace function cockpit_gewerbe_monate(p_monate int default 13)
returns table (monat text, aktive int, neue int, bestellungen int, umsatz_b2b numeric, umsatz_gesamt numeric)
language sql stable security invoker as $$
  with b as (
    select customer_id, gewerbe, umsatz_eur, to_char(created_at at time zone 'Europe/Berlin', 'YYYY-MM') as m
    from kunden_bestellungen where not coalesce(storniert, false)
  ),
  erste as (select customer_id, min(m) as m from b where gewerbe group by customer_id),
  monate as (
    select to_char(date_trunc('month', (now() at time zone 'Europe/Berlin')) - make_interval(months => g), 'YYYY-MM') as m
    from generate_series(0, p_monate - 1) g
  )
  select mo.m,
    (select count(distinct customer_id) from b where b.m = mo.m and gewerbe)::int,
    (select count(*) from erste where erste.m = mo.m)::int,
    (select count(*) from b where b.m = mo.m and gewerbe)::int,
    coalesce((select sum(umsatz_eur) from b where b.m = mo.m and gewerbe), 0),
    coalesce((select sum(umsatz_eur) from b where b.m = mo.m), 0)
  from monate mo order by mo.m;
$$;

create or replace function cockpit_gewerbe_kennzahlen()
returns table (kaeufer int, aktiv30 int, aktiv90 int, aktiv90_vorjahr int, umsatz90 numeric, bestellungen90 int)
language sql stable security invoker as $$
  with b as (select customer_id, created_at, umsatz_eur from kunden_bestellungen where gewerbe and not coalesce(storniert, false))
  select
    (select count(distinct customer_id) from b)::int,
    (select count(distinct customer_id) from b where created_at > now() - interval '30 days')::int,
    (select count(distinct customer_id) from b where created_at > now() - interval '90 days')::int,
    (select count(distinct customer_id) from b where created_at > now() - interval '455 days' and created_at <= now() - interval '365 days')::int,
    coalesce((select sum(umsatz_eur) from b where created_at > now() - interval '90 days'), 0),
    (select count(*) from b where created_at > now() - interval '90 days')::int;
$$;
