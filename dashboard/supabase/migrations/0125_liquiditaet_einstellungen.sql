-- Einstellungen der Liquiditätsvorschau (/finances/liquiditaet). Eine Zeile; Inhalt =
-- Partial<LiqEinstellungen> aus src/lib/liquiditaet/rechnung.ts (fehlende Felder → Standard).
-- Gilt für die Seite UND für die Ampel an den Bestellungen.
create table if not exists liquiditaet_einstellungen (
  id          int primary key default 1 check (id = 1),
  daten       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

insert into liquiditaet_einstellungen (id) values (1) on conflict (id) do nothing;

alter table liquiditaet_einstellungen enable row level security;
create policy "Admin read liquiditaet_einstellungen" on liquiditaet_einstellungen
  for select to authenticated using (is_admin());
create policy "Admin manage liquiditaet_einstellungen" on liquiditaet_einstellungen
  for all to authenticated using (is_admin()) with check (is_admin());
