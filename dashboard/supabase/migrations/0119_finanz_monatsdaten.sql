-- Finanz-Monatsdaten: editierbare Eingaben des Prognose-Rechners (/finances/overview),
-- gespeichert pro Monat. Die Berechnungen (USt, GewSt, ESt, Nettogewinn) laufen in der
-- App auf Basis dieser Eingaben; hier liegt nur der Eingabe-Zustand als jsonb.

create table if not exists finanz_monatsdaten (
  id          uuid primary key default gen_random_uuid(),
  jahr        int not null,
  monat       int not null check (monat between 1 and 12),
  -- Eingaben: Umsätze, Mitarbeiter, Ausgaben, Raten (Shape: FinanzInput in src/lib/types.ts)
  daten       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (jahr, monat)
);

create index if not exists finanz_monatsdaten_jahr_idx on finanz_monatsdaten (jahr);

alter table finanz_monatsdaten enable row level security;

-- Finanzdaten sind sensibel: nur Admins/Mitarbeiter (Feature-Gate zusätzlich in der App).
create policy "Admin read finanz_monatsdaten" on finanz_monatsdaten
  for select to authenticated using (is_admin());
create policy "Admin manage finanz_monatsdaten" on finanz_monatsdaten
  for all to authenticated using (is_admin()) with check (is_admin());

create or replace function set_finanz_monatsdaten_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_finanz_monatsdaten_updated_at on finanz_monatsdaten;
create trigger trg_finanz_monatsdaten_updated_at
  before update on finanz_monatsdaten
  for each row execute function set_finanz_monatsdaten_updated_at();
