-- Mitarbeiter-Management: Urlaubskalender + Krankheitstage
-- Admin/HR-verwaltet (kein Self-Service in Phase 1). Service-Role-Client
-- (createServiceClient) schreibt; RLS-Policies trotzdem admin/authenticated
-- als Absicherung. Feature-Gating in der UI via hasFeature("staff").

-- ─── Mitarbeiter-Stammdaten ──────────────────────────────────────
create table staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team text not null
    check (team in ('salon','marketing','kundenservice','lager')),
  annual_vacation_days numeric not null default 0,          -- Jahresanspruch
  carryover_days numeric not null default 0,                -- Übertrag aus Vorjahr
  carryover_expires_on date,                                -- Resturlaub-Verfall (z.B. 31.03.)
  employment_start date,                                    -- für anteiligen Anspruch
  active boolean not null default true,
  profile_id uuid references profiles(id),                  -- Hook für späteren Self-Service
  created_at timestamptz not null default now()
);

create index staff_members_team_idx on staff_members(team) where active = true;

-- ─── Urlaubsanträge ──────────────────────────────────────────────
create table vacation_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days numeric not null,                                    -- berechnete Werktage (halbe möglich)
  paid boolean not null default true,                       -- bezahlt / unbezahlt
  status text not null default 'submitted'
    check (status in ('submitted','approved','rejected')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create index vacation_requests_staff_idx on vacation_requests(staff_id, start_date);
create index vacation_requests_status_idx on vacation_requests(status);

-- ─── Krankheitstage ──────────────────────────────────────────────
-- Datenschutz: KEINE Diagnose. Nur Zeitraum, Kategorie, Bescheinigung.
create table sick_days (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days numeric not null,                                    -- Kalendertage
  category text not null default 'own'
    check (category in ('own','child')),                    -- eigene Krankheit / Kind krank
  certificate_required boolean not null default false,      -- true wenn > 3 Kalendertage
  certificate_uploaded boolean not null default false,
  certificate_path text,                                    -- Pfad im 'staff-documents' Bucket
  certificate_file_name text,
  certificate_expires_on date,                              -- Folgebescheinigung-Tracking
  note text,
  created_at timestamptz not null default now()
);

create index sick_days_staff_idx on sick_days(staff_id, start_date);

-- ─── RLS ─────────────────────────────────────────────────────────
alter table staff_members enable row level security;
alter table vacation_requests enable row level security;
alter table sick_days enable row level security;

-- Lesen + Schreiben: alle authenticated; Feature-Gating ("staff") in der UI.
-- Service-Role-Client (Server Actions) umgeht RLS ohnehin.
create policy "Authenticated read staff_members" on staff_members
  for select to authenticated using (true);
create policy "Authenticated write staff_members" on staff_members
  for all to authenticated using (true) with check (true);

create policy "Authenticated read vacation_requests" on vacation_requests
  for select to authenticated using (true);
create policy "Authenticated write vacation_requests" on vacation_requests
  for all to authenticated using (true) with check (true);

create policy "Authenticated read sick_days" on sick_days
  for select to authenticated using (true);
create policy "Authenticated write sick_days" on sick_days
  for all to authenticated using (true) with check (true);

-- ─── Storage Bucket für AU-Bescheinigungen (privat) ──────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-documents',
  'staff-documents',
  false,
  10485760,                                  -- 10 MB max
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do nothing;

create policy "Authenticated read staff-documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-documents');

create policy "Authenticated upload staff-documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-documents');

create policy "Authenticated update staff-documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'staff-documents');

create policy "Authenticated delete staff-documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-documents');
