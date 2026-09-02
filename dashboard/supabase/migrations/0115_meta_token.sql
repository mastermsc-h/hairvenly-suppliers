-- Speichert den Meta/Instagram Long-Lived Access Token in der DB, damit der
-- tägliche Cron ihn VOR Ablauf automatisch erneuern kann (ig_refresh_token).
-- Vercel-Env-Variablen lassen sich zur Laufzeit nicht schreiben — daher DB.
-- Single-Row (id=1). GEHEIM: nur service_role darf lesen/schreiben (KEIN
-- authenticated-read), sonst läge der Token offen.
create table if not exists meta_token (
  id            int primary key default 1,
  access_token  text not null,
  token_type    text,
  expires_at    timestamptz,               -- geschätzt/aus API (expires_in)
  refreshed_at  timestamptz not null default now(),
  source        text,                       -- 'env-seed' | 'refresh'
  updated_at    timestamptz not null default now(),
  constraint meta_token_singleton check (id = 1)
);

alter table meta_token enable row level security;

-- Nur Service-Role (Server) — kein authenticated-Zugriff auf das Geheimnis.
create policy "meta_token_service_only"
  on meta_token for all
  to service_role
  using (true)
  with check (true);
