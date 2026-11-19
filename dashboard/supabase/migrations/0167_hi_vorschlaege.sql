-- "Hi" darf Änderungen nur vorschlagen. Ein Vorschlag liegt hier; ausgeführt wird er erst, wenn der
-- Admin in der Karte "Eintragen" klickt (Server Action prüft Rolle, Status und Alter).
create table if not exists public.hi_vorschlaege (
  id uuid primary key default gen_random_uuid(),
  erstellt_am timestamptz not null default now(),
  profil_id uuid,
  art text not null check (art in ('steuerposten', 'zahltermin', 'annahme', 'eintrag')),
  titel text not null,
  zeilen text[] not null default '{}',
  daten jsonb not null,
  status text not null default 'offen' check (status in ('offen', 'ausgefuehrt', 'verworfen', 'fehler')),
  ergebnis text,
  erledigt_am timestamptz
);
alter table public.hi_vorschlaege enable row level security;
-- Zugriff nur über den Server (service_role); keine Policies.
create index if not exists hi_vorschlaege_zeit on public.hi_vorschlaege (erstellt_am desc);
