-- Startbildschirm: Instagram-Anfragen (Kundinnen, die per DM schreiben) für beliebige Zeiträume.
-- Seit dem Chatbot-Start (erste Instagram-Session) zählen chat_messages; davor das importierte
-- Instagram-Archiv (chat_messages_archive, ab Mai 2025) → Vergleich mit dem Vorjahr möglich.
-- "Gespräch" = Unterhaltung, in der die Kundin im Zeitraum mindestens einmal geschrieben hat.
-- Nur für service_role (Startbildschirm lädt serverseitig nach requireProfile()).

create or replace function cockpit_ig_grenze() returns timestamptz
language sql stable as $$
  select coalesce(min(created_at), now()) from chat_sessions where channel = 'instagram'
$$;

create or replace function cockpit_ig_anfragen_zeitraum(p_von timestamptz, p_bis timestamptz)
returns table (gespraeche int, nachrichten int)
language sql stable as $$
  with g as (select cockpit_ig_grenze() t),
  alle as (
    select m.session_id::text k
    from chat_messages m join chat_sessions s on s.id = m.session_id, g
    where m.role = 'user' and m.deleted_at is null and s.channel = 'instagram'
      and m.created_at >= greatest(p_von, g.t) and m.created_at < p_bis
    union all
    select 'a:' || a.thread_id
    from chat_messages_archive a, g
    where not a.is_hairvenly and a.message_at >= p_von and a.message_at < least(p_bis, g.t)
  )
  select count(distinct k)::int, count(*)::int from alle
$$;

create or replace function cockpit_ig_anfragen_tage(p_von date, p_bis date)
returns table (tag date, gespraeche int, nachrichten int)
language sql stable as $$
  with g as (select cockpit_ig_grenze() t),
  alle as (
    select m.session_id::text k, m.created_at ts
    from chat_messages m join chat_sessions s on s.id = m.session_id, g
    where m.role = 'user' and m.deleted_at is null and s.channel = 'instagram'
      and m.created_at >= greatest((p_von::timestamp at time zone 'Europe/Berlin'), g.t)
      and m.created_at < ((p_bis + 1)::timestamp at time zone 'Europe/Berlin')
    union all
    select 'a:' || a.thread_id, a.message_at
    from chat_messages_archive a, g
    where not a.is_hairvenly
      and a.message_at >= (p_von::timestamp at time zone 'Europe/Berlin')
      and a.message_at < least(((p_bis + 1)::timestamp at time zone 'Europe/Berlin'), g.t)
  )
  select (ts at time zone 'Europe/Berlin')::date, count(distinct k)::int, count(*)::int
  from alle group by 1 order by 1
$$;

-- Nur Chatbot-Zeit (Kategorien und Uhrzeiten gibt es im Archiv nicht)
create or replace function cockpit_ig_anfragen_kategorien(p_von timestamptz, p_bis timestamptz)
returns table (kategorie text, gespraeche int)
language sql stable as $$
  select coalesce(s.category, 'general'), count(distinct s.id)::int
  from chat_messages m join chat_sessions s on s.id = m.session_id
  where m.role = 'user' and m.deleted_at is null and s.channel = 'instagram'
    and m.created_at >= p_von and m.created_at < p_bis
  group by 1 order by 2 desc
$$;

create or replace function cockpit_ig_anfragen_stunden(p_von timestamptz)
returns table (wochentag int, stunde int, nachrichten int)
language sql stable as $$
  select extract(isodow from m.created_at at time zone 'Europe/Berlin')::int,
         extract(hour from m.created_at at time zone 'Europe/Berlin')::int, count(*)::int
  from chat_messages m join chat_sessions s on s.id = m.session_id
  where m.role = 'user' and m.deleted_at is null and s.channel = 'instagram' and m.created_at >= p_von
  group by 1, 2
$$;

revoke all on function cockpit_ig_grenze(), cockpit_ig_anfragen_zeitraum(timestamptz, timestamptz),
  cockpit_ig_anfragen_tage(date, date), cockpit_ig_anfragen_kategorien(timestamptz, timestamptz),
  cockpit_ig_anfragen_stunden(timestamptz) from public, anon, authenticated;
