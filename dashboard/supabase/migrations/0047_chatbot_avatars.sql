-- Avatars: pro Mitarbeiter-Persona eigene Tonalität, Länge, Wärme
-- Bei jeder neuen Session wird zufällig (gewichtet) ein aktiver Avatar gewählt

create table if not exists chatbot_avatars (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,           -- "Larissa", "Barbara", "Tanja", "Ailar"
  avatar_url    text,                            -- Profilbild für Dashboard
  personality   text not null,                   -- Persönlichkeits-Prompt (wie tickt diese Person?)
  active        boolean default true,
  weight        int default 1 check (weight >= 1), -- Auswahl-Gewicht (höher = öfter gewählt)
  notes         text,                            -- interne Notizen
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_avatars_active on chatbot_avatars(active);

alter table chatbot_avatars enable row level security;
create policy "avatars_read"  on chatbot_avatars for select using (auth.role() = 'authenticated');
create policy "avatars_admin" on chatbot_avatars for all using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

create or replace function update_avatars_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists avatars_updated_at on chatbot_avatars;
create trigger avatars_updated_at before update on chatbot_avatars
  for each row execute function update_avatars_updated_at();
