-- Verspätungen je Mitarbeiter (nur Admin, Zugriff über service_role).
create table if not exists staff_verspaetungen (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  datum date not null default (now() at time zone 'Europe/Berlin')::date,
  minuten int not null check (minuten > 0 and minuten <= 600),
  notiz text,
  erstellt_von uuid references profiles(id) on delete set null,
  erstellt_am timestamptz not null default now()
);
create index if not exists staff_verspaetungen_staff_datum on staff_verspaetungen (staff_id, datum desc);
alter table staff_verspaetungen enable row level security;
-- keine Policies: nur service_role
