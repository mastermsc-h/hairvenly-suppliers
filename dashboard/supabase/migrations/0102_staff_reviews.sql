-- Personalakte / Mitarbeitergespräche (NUR ECHTER ADMIN).
-- Sensibel → RLS aktiv OHNE authenticated-Policy: nur Service-Role (App hinter
-- requireStaffAdmin). staff_members hat permissive Read-RLS, deshalb liegen die
-- sensiblen Freitexte in eigener Tabelle, nicht als Spalten auf staff_members.

-- ─── Mitarbeitergespräche (dated log) ───────────────────────────
create table staff_reviews (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  review_date date not null,
  content text,                 -- Inhalt / Absprachen / Notizen
  next_date date,               -- vereinbartes nächstes Gespräch
  created_at timestamptz not null default now()
);
create index staff_reviews_idx on staff_reviews(staff_id, review_date desc);

-- ─── Ziele ──────────────────────────────────────────────────────
create table staff_goals (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open','done')),
  due_date date,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_goals_idx on staff_goals(staff_id, status);

-- ─── Schulungen ─────────────────────────────────────────────────
create table staff_trainings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  training_date date,
  title text not null,
  note text,
  created_at timestamptz not null default now()
);
create index staff_trainings_idx on staff_trainings(staff_id, training_date desc);

-- ─── Verantwortlichkeiten / Aufgaben / Notizen (1:1, Freitext) ──
create table staff_member_meta (
  staff_id uuid primary key references staff_members(id) on delete cascade,
  responsibilities text,
  tasks text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table staff_reviews enable row level security;
alter table staff_goals enable row level security;
alter table staff_trainings enable row level security;
alter table staff_member_meta enable row level security;
