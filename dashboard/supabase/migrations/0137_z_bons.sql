-- Z-Bons (Tagesabschlüsse) von Shopify POS und Nexi (Treatwell) als digitale Ablage.
-- Ein Eintrag = ein Tagesabschluss einer Kasse; ein langer Bon kann aus mehreren Fotos bestehen.
create table if not exists z_bons (
  id              uuid primary key default gen_random_uuid(),
  datum           date not null,                       -- Tag, für den der Bon gilt
  quelle          text not null check (quelle in ('shopify_pos','nexi')),
  betrag          numeric(12,2),                       -- Tagesumsatz brutto laut Bon (optional)
  notiz           text,
  hochgeladen_von uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- Kassenbelege sind aufbewahrungspflichtig: Löschen markiert nur (mit Grund), die Datei bleibt
  geloescht_am    timestamptz,
  geloescht_von   uuid references profiles(id) on delete set null,
  geloescht_grund text
);
create index if not exists z_bons_datum_idx on z_bons (datum) where geloescht_am is null;

create table if not exists z_bon_dateien (
  id          uuid primary key default gen_random_uuid(),
  z_bon_id    uuid not null references z_bons(id) on delete cascade,
  pfad        text not null unique,                    -- Pfad im Bucket z-bons
  dateiname   text not null,
  mime        text not null,
  groesse     int not null,
  reihenfolge int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists z_bon_dateien_bon_idx on z_bon_dateien (z_bon_id);

alter table z_bons enable row level security;
alter table z_bon_dateien enable row level security;
drop policy if exists "Admin read z_bons" on z_bons;
create policy "Admin read z_bons" on z_bons for select to authenticated using (is_admin());
drop policy if exists "Admin read z_bon_dateien" on z_bon_dateien;
create policy "Admin read z_bon_dateien" on z_bon_dateien for select to authenticated using (is_admin());
-- Schreiben nur per service_role (Server Actions nach requireFeature("finances"))

-- Privater Bucket; Upload per signierter Upload-URL, Ansicht per signierter URL
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'z-bons',
  'z-bons',
  false,
  26214400,                                  -- 25 MB
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do nothing;
