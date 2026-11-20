-- Gewerbekunden: maßgeblich sind die Shopify-Tags „B2B“ bzw. „B“ (Liste kommt aus Shopify als p_ids).
-- So zählt ein später markierter Kunde auch mit seinen alten Bestellungen.

drop function if exists cockpit_gewerbe_monate(int);
drop function if exists cockpit_gewerbe_kennzahlen();

create or replace function cockpit_gewerbe_monate(p_ids bigint[], p_monate int default 13)
returns table (monat text, aktive int, neue int, bestellungen int, umsatz_b2b numeric, umsatz_gesamt numeric)
language sql stable security invoker as $$
  with b as (
    select customer_id, (customer_id = any(p_ids)) as gw, umsatz_eur, to_char(created_at at time zone 'Europe/Berlin', 'YYYY-MM') as m
    from kunden_bestellungen where not coalesce(storniert, false)
  ),
  erste as (select customer_id, min(m) as m from b where gw group by customer_id),
  monate as (
    select to_char(date_trunc('month', (now() at time zone 'Europe/Berlin')) - make_interval(months => g), 'YYYY-MM') as m
    from generate_series(0, p_monate - 1) g
  )
  select mo.m,
    (select count(distinct customer_id) from b where b.m = mo.m and gw)::int,
    (select count(*) from erste where erste.m = mo.m)::int,
    (select count(*) from b where b.m = mo.m and gw)::int,
    coalesce((select sum(umsatz_eur) from b where b.m = mo.m and gw), 0),
    coalesce((select sum(umsatz_eur) from b where b.m = mo.m), 0)
  from monate mo order by mo.m;
$$;

create or replace function cockpit_gewerbe_kennzahlen(p_ids bigint[])
returns table (kaeufer int, aktiv30 int, aktiv90 int, aktiv90_vorjahr int, umsatz90 numeric, bestellungen90 int)
language sql stable security invoker as $$
  with b as (select customer_id, created_at, umsatz_eur from kunden_bestellungen where customer_id = any(p_ids) and not coalesce(storniert, false))
  select
    (select count(distinct customer_id) from b)::int,
    (select count(distinct customer_id) from b where created_at > now() - interval '30 days')::int,
    (select count(distinct customer_id) from b where created_at > now() - interval '90 days')::int,
    (select count(distinct customer_id) from b where created_at > now() - interval '455 days' and created_at <= now() - interval '365 days')::int,
    coalesce((select sum(umsatz_eur) from b where created_at > now() - interval '90 days'), 0),
    (select count(*) from b where created_at > now() - interval '90 days')::int;
$$;

-- Je Kunde: Bestellungen/Umsatz gesamt und 12 Monate, erste/letzte Bestellung.
-- Liefert alle markierten (p_ids) plus „Undercover“-Kandidaten: nicht markiert, aber Punkte ≥ p_min_punkte
-- (Firma in der Adresse +2 · ≥ 8 Bestellungen in 12 M +3, ≥ 5 +2 · Umsatz 12 M ≥ 3.000 € +3, ≥ 1.500 € +2).
drop function if exists gewerbe_kunden_liste(bigint[], int);
create or replace function gewerbe_kunden_liste(p_ids bigint[], p_min_punkte int default 3)
returns table (
  customer_id bigint, markiert boolean, bestellungen int, umsatz numeric, bestellungen12 int, umsatz12 numeric,
  erste timestamptz, letzte timestamptz, firma boolean, punkte int, gruende text[], stadt text, plz text, land text
)
language sql stable security invoker as $$
  with k as (
    select customer_id,
      count(*)::int as n, sum(umsatz_eur) as u,
      (count(*) filter (where created_at > now() - interval '365 days'))::int as n12,
      coalesce(sum(umsatz_eur) filter (where created_at > now() - interval '365 days'), 0) as u12,
      min(created_at) as erste, max(created_at) as letzte, bool_or(firma) as f,
      (array_agg(stadt order by created_at desc) filter (where stadt is not null and stadt <> ''))[1] as stadt,
      (array_agg(plz order by created_at desc) filter (where plz is not null and plz <> ''))[1] as plz,
      (array_agg(land order by created_at desc) filter (where land is not null and land <> ''))[1] as land
    from kunden_bestellungen
    where not coalesce(storniert, false) and customer_id is not null
    group by customer_id
  ),
  p as (
    select k.*, (k.customer_id = any(p_ids)) as markiert,
      (case when f then 2 else 0 end
       + case when n12 >= 8 then 3 when n12 >= 5 then 2 else 0 end
       + case when u12 >= 3000 then 3 when u12 >= 1500 then 2 else 0 end) as punkte,
      array_remove(array[
        case when f then 'Firma in der Adresse' end,
        case when n12 >= 5 then n12 || ' Bestellungen in 12 Monaten' end,
        case when u12 >= 1500 then 'Umsatz 12 Monate ' || round(u12) || ' €' end
      ], null) as gruende
    from k
  )
  select customer_id, markiert, n, round(u, 2), n12, round(u12, 2), erste, letzte, coalesce(f, false), punkte, gruende, stadt, plz, land
  from p
  where markiert or punkte >= p_min_punkte;
$$;
