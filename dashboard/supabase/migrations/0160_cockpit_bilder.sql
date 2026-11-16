-- Startbildschirm "Polaroids": Bilder fürs Team (Vorher/Nachher, Team-Momente …).
-- Privater Bucket; die Seite zeigt sie über kurzlebige signierte Links (service_role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cockpit-bilder', 'cockpit-bilder', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table if not exists cockpit_bilder (
  id          uuid primary key default gen_random_uuid(),
  pfad        text not null,
  titel       text not null default '',
  owner_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table cockpit_bilder enable row level security;
