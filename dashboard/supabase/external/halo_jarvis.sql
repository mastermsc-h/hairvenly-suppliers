-- Läuft im HALO-Supabase-Projekt (aulnpnafhcnxwqhbbrnt), NICHT in unserem.
-- Rein lesender Zugang für das Hairvenly-Dashboard + Jarvis.
-- Ändert keine HALO-Tabelle, Policy oder Rolle. Rückbau: siehe ganz unten.
--
-- Schutz: Funktion antwortet nur mit dem richtigen Schlüssel (nur dessen
-- SHA-256-Hash liegt hier in jarvis_access). Liefert nur Aufgaben —
-- keine Check-ins, Anfragen, Notizen, Chats oder privaten Dokumente.

create table if not exists public.jarvis_access (
  name     text primary key,
  key_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.jarvis_access enable row level security;
revoke all on public.jarvis_access from anon, authenticated;
-- Hash wird separat gesetzt:
-- insert into public.jarvis_access(name,key_hash) values ('dashboard','<sha256-hex>')
--   on conflict (name) do update set key_hash = excluded.key_hash;

create or replace function public.jarvis_halo(p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select exists (
    select 1 from public.jarvis_access
    where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
  ) into ok;
  if not ok then
    raise exception 'kein Zugriff' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'stand', now(),
    'aufgaben', coalesce((
      select jsonb_agg(x order by x->>'status', x->>'faellig' nulls last)
      from (
        select jsonb_build_object(
          'id', t.id,
          'nr', t.data->'nr',
          'titel', t.data->>'t',
          'bereich', t.data->>'a',
          'person', t.data->>'p',
          'person2', t.data->>'p2',
          'beteiligt', t.data->'who',
          'prio', t.data->>'pr',
          'status', t.data->>'st',
          'faellig', t.data->>'due',
          'angelegt', t.data->>'cd',
          'kampagne', t.data->>'ep',
          'zuletzt_geaendert', t.updated_at,
          'schritte_gesamt', (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.data->'sub') = 'array' then t.data->'sub' else '[]'::jsonb end) s),
          'schritte_erledigt', (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.data->'sub') = 'array' then t.data->'sub' else '[]'::jsonb end) s where (s->>'d')::boolean is true),
          'offene_schritte', coalesce((
            select jsonb_agg(jsonb_build_object('titel', s->>'t', 'geplant', s->>'am', 'minuten', s->'min', 'von', s->>'von') order by s->>'am' nulls last)
            from jsonb_array_elements(case when jsonb_typeof(t.data->'sub') = 'array' then t.data->'sub' else '[]'::jsonb end) s
            where (s->>'d')::boolean is not true
          ), '[]'::jsonb)
        ) x
        from public.tasks t
        where coalesce((t.data->>'tr')::boolean, false) = false      -- nicht im Papierkorb
          and coalesce((t.data->>'arch')::boolean, false) = false    -- nicht archiviert
          and (jsonb_typeof(t.data->'priv') is distinct from 'array'  -- private Aufgaben nur, wenn Mehmet freigegeben
               or t.data->'priv' ? 'mehmet')
      ) q
    ), '[]'::jsonb),
    'kampagnen', coalesce((select data from public.docs where key = 'kampagnen'), '[]'::jsonb)
  );
end $$;

revoke all on function public.jarvis_halo(text) from public;
grant execute on function public.jarvis_halo(text) to anon, authenticated;

-- Rückbau:
-- drop function if exists public.jarvis_halo(text);
-- drop table if exists public.jarvis_access;
