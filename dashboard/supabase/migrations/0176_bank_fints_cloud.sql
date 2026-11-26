-- Bank-Abruf in der Cloud (Vercel-Python-Funktion api/fints.py) statt nur auf dem Mac.
-- Pro Bank: FinTS-Zustand (System-ID, BPD/UPD, gewähltes TAN-Verfahren — KEINE PIN,
-- die liegt als Geheimvariable bei Vercel) + Status (needs_tan, auth_failed,
-- last_success_date, Sperre gegen parallele Läufe).
-- Nur der Service-Role-Key darf lesen/schreiben: RLS an, bewusst keine Policies.
create table if not exists bank_fints_cloud (
  bank        text primary key,              -- 'sparkasse' | 'targobank'
  state_b64   text,                          -- python-fints deconstruct(including_private=True), base64
  status      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table bank_fints_cloud enable row level security;
