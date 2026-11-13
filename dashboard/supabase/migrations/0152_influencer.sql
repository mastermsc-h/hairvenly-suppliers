-- Influencer-Tracking (Marketing → Aktionen)
-- Eingetragen wird nur: Influencer + Rabattcode + Zeitraum + Kosten, und Posting-Termine.
-- Code-Nutzung und Umsatz kommen automatisch aus Shopify (Bestellung.discountCodes).

create table if not exists public.influencer (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  handle       text,                       -- z. B. @laura.hair
  plattform    text not null default 'instagram' check (plattform in ('instagram','tiktok','youtube','sonstiges')),
  rabattcode   text,                       -- Shopify-Code, Vergleich ohne Groß/Klein
  aktiv_von    date,
  aktiv_bis    date,                       -- null = läuft
  kosten_eur   numeric(10,2),              -- Honorar/Warenwert für den Deal (optional)
  verguetung   text,                       -- z. B. "Produkte", "200 € + Provision"
  notiz        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) default auth.uid()
);
create unique index if not exists influencer_rabattcode_uniq on public.influencer (upper(rabattcode)) where rabattcode is not null;

create table if not exists public.influencer_postings (
  id             uuid primary key default gen_random_uuid(),
  influencer_id  uuid not null references public.influencer(id) on delete cascade,
  datum          date not null,
  art            text not null default 'reel' check (art in ('reel','story','post','video','live','sonstiges')),
  link           text,
  notiz          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) default auth.uid()
);
create index if not exists influencer_postings_datum on public.influencer_postings (datum);

alter table public.influencer enable row level security;
alter table public.influencer_postings enable row level security;

drop policy if exists "Admins verwalten Influencer" on public.influencer;
create policy "Admins verwalten Influencer" on public.influencer for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins verwalten Influencer-Postings" on public.influencer_postings;
create policy "Admins verwalten Influencer-Postings" on public.influencer_postings for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
