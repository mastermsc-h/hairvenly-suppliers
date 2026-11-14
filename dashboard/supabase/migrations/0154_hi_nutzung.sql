-- Verbrauch von "Hi" je Frage (Tokens + Kosten), damit Kosten sichtbar und optimierbar sind.
create table if not exists public.hi_nutzung (
  id bigserial primary key,
  erstellt_am timestamptz not null default now(),
  profil_id uuid,
  frage text,
  modell text not null,
  modus text not null,
  runden int not null,
  werkzeuge text[] not null default '{}',
  input_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  output_tokens int not null default 0,
  kosten_usd numeric(10, 4) not null default 0,
  dauer_ms int
);
alter table public.hi_nutzung enable row level security;
-- Zugriff nur über den Server (service_role); keine Policies.
create index if not exists hi_nutzung_zeit on public.hi_nutzung (erstellt_am desc);
