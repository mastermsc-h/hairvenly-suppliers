-- Marketing-Kanäle: veröffentlichte Beiträge je Kanal (automatisch gesammelt oder von Hand gemeldet).
-- Instagram-Storys sind nur 24 h über die API sichtbar → der Cron sichert sie hier.
create table if not exists marketing_beitraege (
  id uuid primary key default gen_random_uuid(),
  kanal text not null,               -- ig_reel, ig_info, ig_story, tiktok, yt_short, yt_video, pinterest, google, blog
  extern_id text not null,           -- ID der Plattform bzw. zufällig bei manuellen Einträgen
  zeitpunkt timestamptz not null,
  titel text,
  quelle text not null default 'auto' check (quelle in ('auto', 'manuell')),
  erstellt_von uuid references profiles(id) on delete set null,
  erstellt_am timestamptz not null default now(),
  unique (kanal, extern_id)
);
create index if not exists marketing_beitraege_kanal_zeit on marketing_beitraege (kanal, zeitpunkt desc);
alter table marketing_beitraege enable row level security;
-- keine Policies: Zugriff nur über service_role (Server)
