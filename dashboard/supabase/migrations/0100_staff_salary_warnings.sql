-- Mitarbeiter-Management Teil 3: Gehalt (mit Erhöhungs-Historie) + Verwarnungen.
-- SENSIBEL — nur Admins. RLS aktiviert OHNE authenticated-Policy: nur der
-- Service-Role-Client (Server Actions/Pages, hinter requireAdmin) hat Zugriff;
-- normale eingeloggte Nutzer kommen per anon/authenticated nicht an die Daten.

-- ─── Gehalts-Historie (jede Zeile = ein Stand/eine Erhöhung) ─────
create table staff_salary_changes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  effective_date date not null,         -- gültig ab
  amount numeric not null,              -- monatl. brutto (EUR)
  note text,
  created_at timestamptz not null default now()
);
create index staff_salary_changes_idx on staff_salary_changes(staff_id, effective_date desc);

-- ─── Verwarnungen (mündlich / schriftlich) ──────────────────────
create table staff_warnings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  warning_date date not null,
  type text not null check (type in ('oral','written')),
  reason text,
  created_at timestamptz not null default now()
);
create index staff_warnings_idx on staff_warnings(staff_id, warning_date desc);

-- RLS ohne Policy → nur Service-Role (admin-gated im App-Layer).
alter table staff_salary_changes enable row level security;
alter table staff_warnings enable row level security;
