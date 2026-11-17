-- Preislisten der Lieferanten als Dokumente (PDF/Bild) — eine Ablage unter /prices.
-- Enthält Einkaufspreise → nur echte Admins (role='admin'); Zugriff ausschließlich über
-- Server-Actions mit service_role, Anzeige per kurzlebigen signierten Links.
-- Lieferant als Text (nicht FK), damit auch Lieferanten ohne Bestell-Datensatz
-- (YHW, Sunny, Reichert …) eine Ablage haben.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lieferanten-preislisten', 'lieferanten-preislisten', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table if not exists lieferanten_preislisten (
  id           uuid primary key default gen_random_uuid(),
  lieferant    text not null check (length(trim(lieferant)) between 1 and 60),
  titel        text not null default '',
  gueltig_ab   date,
  pfad         text not null,
  dateiname    text not null,
  mime         text not null,
  groesse      integer not null,
  hochgeladen_von uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists lieferanten_preislisten_lieferant_idx on lieferanten_preislisten (lieferant, created_at desc);
alter table lieferanten_preislisten enable row level security;
-- Keine Policies: anon/authenticated sehen nichts, nur service_role (Server-Actions).
