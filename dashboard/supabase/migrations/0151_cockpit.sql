-- Startbildschirm ("Cockpit"): persönliche Anordnung + Einträge (Notizen, Ideen, Aufgaben,
-- Meilensteine, Wachstumspfeiler, Aktionen, Firmenphilosophie).
-- Zugriff ausschließlich über Server Actions (service_role) nach requireProfile() —
-- RLS ist an und hat bewusst keine Policies.

create table if not exists cockpit_layout (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  -- { items: [{ i, x, y, w, h }], aus: ["widget-id", …] }
  layout      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table cockpit_layout enable row level security;

create table if not exists cockpit_eintraege (
  id          uuid primary key default gen_random_uuid(),
  art         text not null check (art in ('notiz','idee','aufgabe','meilenstein','pfeiler','aktion','philosophie')),
  -- Notizen sind privat (nur owner); alle anderen Arten sieht das ganze Team.
  owner_id    uuid references auth.users(id) on delete set null,
  titel       text not null default '',
  text        text not null default '',
  -- je Art: farbe, faellig (YYYY-MM-DD), zustaendig, prio, fortschritt (0-100), ziel, von, bis, link …
  daten       jsonb not null default '{}'::jsonb,
  erledigt_am timestamptz,
  sort        double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cockpit_eintraege_art_idx on cockpit_eintraege (art, sort);
create index if not exists cockpit_eintraege_owner_idx on cockpit_eintraege (owner_id) where art = 'notiz';
alter table cockpit_eintraege enable row level security;
