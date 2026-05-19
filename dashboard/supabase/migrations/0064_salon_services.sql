-- Salon-Service-Preise (Hairvenly Bremen) — gepflegt von Planity-Seite
-- Damit Chatbot Preise + Dauer für Einarbeitung, Coloration etc. nennen kann.
create table if not exists salon_services (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,         -- "Tapes - Wellig", "Coloration", etc.
  service     text not null,         -- "Tapes 125g wellig"
  price_min   numeric,
  price_max   numeric,
  duration_min int,                  -- in Minuten
  notes       text,
  display_order int default 50,
  active      boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_salon_services_active_cat
  on salon_services(active, category, display_order);

alter table salon_services enable row level security;
create policy "salon_services_read" on salon_services for select using (true);
create policy "salon_services_admin" on salon_services for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

create or replace function update_salon_services_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists salon_services_updated_at on salon_services;
create trigger salon_services_updated_at before update on salon_services
  for each row execute function update_salon_services_updated_at();
