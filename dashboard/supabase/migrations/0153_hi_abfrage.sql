-- "Hi" (Hairvenly Intelligence): Lesezugriff der KI auf die Datenbank.
-- Eigene Rolle hi_reader (nur SELECT, keine Tokens/PINs) + Funktion hi_abfrage(sql), die eine
-- einzelne SELECT-Abfrage in einer schreibgeschützten Transaktion ausführt (max. 300 Zeilen, 8 s).
-- Aufrufbar nur mit service_role (API-Route /api/hi prüft vorher: nur Admin).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hi_reader') then
    create role hi_reader nologin bypassrls;
  end if;
end $$;

grant hi_reader to postgres;
grant usage on schema public to hi_reader;
grant select on all tables in schema public to hi_reader;
alter default privileges in schema public grant select on tables to hi_reader;

-- Geheimnisse bleiben draußen
revoke select on public.meta_token from hi_reader;
revoke select on public.salon_pin_versuche from hi_reader;
revoke select on public.salon_employees from hi_reader;
grant select (id, name, active, color, created_at, einnahmen_erlaubt) on public.salon_employees to hi_reader;

create or replace function public.hi_abfrage(sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  q text := btrim(sql);
begin
  q := regexp_replace(q, ';\s*$', '');
  if q !~* '^\s*(select|with)\s' then
    raise exception 'Nur SELECT-Abfragen sind erlaubt';
  end if;
  if position(';' in q) > 0 then
    raise exception 'Nur eine einzelne Abfrage ist erlaubt';
  end if;
  -- schreibgeschützt: auch Funktionen mit Nebenwirkungen können nichts ändern
  set local transaction_read_only = on;
  set local statement_timeout = '8s';
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) hi_q limit 300) t', q) into r;
  return r;
end;
$$;

-- Neuer Eigentümer braucht CREATE auf dem Schema nur für den Besitzwechsel
grant create on schema public to hi_reader;
alter function public.hi_abfrage(text) owner to hi_reader;
revoke create on schema public from hi_reader;
revoke all on function public.hi_abfrage(text) from public, anon, authenticated;
grant execute on function public.hi_abfrage(text) to service_role;
