-- Pack-Verifikations-System für Versand
-- Mitarbeiter scannt Order-QR + Artikel-Barcodes, macht 3 Fotos.
-- System verifiziert + markiert Order als versandbereit.

-- ─── Pack Sessions ───────────────────────────────────────────────
-- Eine Session pro Bestellung; trackt den Pack-Vorgang von Anfang bis Ende.
create table pack_sessions (
  id uuid primary key default gen_random_uuid(),
  order_name text not null unique,          -- "#22264" (matches Shopify order.name)
  shopify_order_id bigint,                  -- numeric Shopify order id
  status text not null default 'open',      -- 'open' | 'in_progress' | 'verified' | 'shipped'
  expected_items jsonb,                     -- snapshot: [{variant_id, barcode, title, quantity, image_url}, ...]
  started_at timestamptz,
  finished_at timestamptz,
  fulfilled_at timestamptz,                 -- when reported back to Shopify
  packed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pack_sessions_status_idx on pack_sessions(status);
create index pack_sessions_order_name_idx on pack_sessions(order_name);

-- ─── Pack Scans ──────────────────────────────────────────────────
-- Audit-Log: jeder einzelne Scan-Event (auch Fehlversuche)
create table pack_scans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pack_sessions(id) on delete cascade,
  scanned_barcode text not null,
  matched_variant_id bigint,                -- null if no match
  matched_title text,                       -- product title for display in audit
  status text not null,                     -- 'match' | 'mismatch' | 'duplicate' | 'overflow'
  scanned_by uuid references public.profiles(id),
  scanned_at timestamptz not null default now()
);

create index pack_scans_session_idx on pack_scans(session_id, scanned_at);

-- ─── Pack Photos ─────────────────────────────────────────────────
-- 3 Beweisfotos pro Session, gespeichert in Supabase Storage Bucket "pack-photos"
create table pack_photos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pack_sessions(id) on delete cascade,
  photo_type text not null,                 -- 'products_invoice' | 'products_in_box' | 'package_on_scale'
  storage_path text not null,               -- path in pack-photos bucket
  taken_by uuid references public.profiles(id),
  taken_at timestamptz not null default now(),
  unique (session_id, photo_type)
);

create index pack_photos_session_idx on pack_photos(session_id);

-- ─── Trigger: updated_at auto ────────────────────────────────────
create or replace function update_pack_session_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pack_sessions_updated_at
  before update on pack_sessions
  for each row
  execute function update_pack_session_timestamp();

-- ─── RLS ─────────────────────────────────────────────────────────
alter table pack_sessions enable row level security;
alter table pack_scans enable row level security;
alter table pack_photos enable row level security;

-- All authenticated users (Mitarbeiter mit pack-Feature) können lesen
create policy "Authenticated read pack_sessions" on pack_sessions
  for select to authenticated using (true);
create policy "Authenticated read pack_scans" on pack_scans
  for select to authenticated using (true);
create policy "Authenticated read pack_photos" on pack_photos
  for select to authenticated using (true);

-- Schreiben: alle authenticated (Mitarbeiter packen ja selbst);
-- Feature-Gating geschieht in der UI via hasFeature("shipping").
create policy "Authenticated write pack_sessions" on pack_sessions
  for all to authenticated using (true) with check (true);
create policy "Authenticated write pack_scans" on pack_scans
  for all to authenticated using (true) with check (true);
create policy "Authenticated write pack_photos" on pack_photos
  for all to authenticated using (true) with check (true);

-- ─── Storage Bucket für Pack-Fotos ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pack-photos',
  'pack-photos',
  false,
  5242880,                                  -- 5 MB max
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage policies: authenticated users dürfen lesen + schreiben
create policy "Authenticated read pack-photos bucket" on storage.objects
  for select to authenticated
  using (bucket_id = 'pack-photos');

create policy "Authenticated upload pack-photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pack-photos');

create policy "Authenticated update pack-photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'pack-photos');

create policy "Authenticated delete pack-photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pack-photos');
