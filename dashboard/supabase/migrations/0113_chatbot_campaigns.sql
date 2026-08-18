-- Chatbot-Aktionen/Kampagnen — Zeiträume, die in der Statistik als Bänder
-- über der Nachrichten-Kurve markiert werden (z.B. Gewinnspiel), damit sich
-- ablesen lässt, ob eine Aktion zu mehr Interaktionen geführt hat.
create table if not exists chatbot_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_on   date not null,
  ends_on     date,                       -- null = einmalig / noch laufend
  color       text not null default '#ec4899',
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chatbot_campaigns_starts_on_idx on chatbot_campaigns (starts_on);

alter table chatbot_campaigns enable row level security;

-- Lesbar für alle eingeloggten Mitarbeiter; Schreibzugriff über Service-Role
-- (Server-Actions nach requireAdmin) — analog zu den übrigen chatbot_-Tabellen.
create policy "campaigns_read_authenticated"
  on chatbot_campaigns for select
  to authenticated
  using (true);

create policy "campaigns_write_service"
  on chatbot_campaigns for all
  to service_role
  using (true)
  with check (true);
