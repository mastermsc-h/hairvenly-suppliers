-- Startbildschirm "Auffälligkeiten": täglicher Bericht (Cron gegen Mittag) + Hilfsabfrage Chats.
create table if not exists cockpit_bericht (
  tag     date primary key,                 -- Berichtstag (deutsche Zeit); ein Bericht je Tag, Neuprüfung überschreibt
  punkte  jsonb not null default '[]'::jsonb, -- [{ id, bereich, schwere, titel, detail, href, liste }]
  fehler  jsonb not null default '[]'::jsonb, -- Prüfungen, die nicht laufen konnten
  stand   timestamptz not null default now()
);
alter table cockpit_bericht enable row level security;
-- keine Policies: nur service_role (Cron, Startbildschirm nach requireProfile)

-- Gespräche, in denen die Kundin zuletzt geschrieben hat und seit p_stunden keine Antwort kam
-- (Bot- und Team-Antworten zählen beide). Nur Gespräche mit Nachricht in den letzten 14 Tagen.
create or replace function cockpit_chats_unbeantwortet(p_stunden int)
returns table (anzahl int, aelteste timestamptz, ueber_24h int)
language sql stable as $$
  with letzte as (
    select distinct on (m.session_id) m.session_id, m.role, m.created_at, coalesce(m.content, '') inhalt
    from chat_messages m
    join chat_sessions s on s.id = m.session_id
    where m.deleted_at is null and m.created_at > now() - interval '14 days' and s.status <> 'closed'
    order by m.session_id, m.created_at desc
  )
  select count(*)::int, min(created_at), count(*) filter (where created_at < now() - interval '24 hours')::int
  from letzte
  where role = 'user' and created_at < now() - make_interval(hours => p_stunden)
    -- Schlussworte ("Danke!", "Ok 👍", nur Emojis/Reaktionen) brauchen keine Antwort
    and not (
      length(btrim(inhalt)) < 40 and inhalt ~* '^[[:space:][:punct:]]*(danke|dankeschön|danke schön|vielen dank|dankee+|thx|merci|ok|okay|okey|oki|super|perfekt|alles klar|top|gerne|gern|lg|liebe grüße|cool|toll|klasse|mach ich|wird gemacht|gut|passt|ja|nein|👍|❤️|🙏)'
    )
    and inhalt !~ '^[^[:alnum:]]*$' 
$$;
revoke all on function cockpit_chats_unbeantwortet(int) from public, anon, authenticated;
