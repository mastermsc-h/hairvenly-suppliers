-- Z-Bons: Wochencheck, Ausnahmen (geschlossen), Einstellungen, KI-Erkennung,
-- dazu Kassenumsatz je Tag aus Shopify (Erwartung + Plausibilität für Shopify POS).

-- POS-Umsatz je Kalendertag (deutsche Zeit), gefüllt vom Cron /api/cron/shopify-umsatz
create table if not exists shopify_pos_tage (
  datum        date primary key,
  umsatz       numeric(12,2) not null,   -- Brutto der POS-Bestellungen (ohne Stornos/Tests)
  bestellungen int not null,
  stand        timestamptz not null default now()
);
alter table shopify_pos_tage enable row level security;
drop policy if exists "Admin read shopify_pos_tage" on shopify_pos_tage;
create policy "Admin read shopify_pos_tage" on shopify_pos_tage for select to authenticated using (is_admin());

-- Tage, für die bewusst kein Z-Bon kommt (geschlossen, Kasse nicht benutzt …)
create table if not exists z_bon_ausnahmen (
  id          uuid primary key default gen_random_uuid(),
  datum       date not null,
  quelle      text not null check (quelle in ('shopify_pos','nexi')),
  grund       text not null,
  erstellt_von uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (datum, quelle)
);
alter table z_bon_ausnahmen enable row level security;
drop policy if exists "Admin read z_bon_ausnahmen" on z_bon_ausnahmen;
create policy "Admin read z_bon_ausnahmen" on z_bon_ausnahmen for select to authenticated using (is_admin());

-- Eine Zeile: ab wann geprüft wird, an welchen Wochentagen Nexi erwartet wird (0=So … 6=Sa)
create table if not exists z_bon_einstellungen (
  id              int primary key default 1 check (id = 1),
  pruef_ab        date not null,
  nexi_wochentage int[] not null default '{1,2,3,4,5,6}',
  updated_at      timestamptz not null default now()
);
insert into z_bon_einstellungen (id, pruef_ab) values (1, '2026-10-29') on conflict (id) do nothing;
alter table z_bon_einstellungen enable row level security;
drop policy if exists "Admin read z_bon_einstellungen" on z_bon_einstellungen;
create policy "Admin read z_bon_einstellungen" on z_bon_einstellungen for select to authenticated using (is_admin());

-- Ergebnis jedes Wochenchecks
create table if not exists z_bon_pruefungen (
  id          uuid primary key default gen_random_uuid(),
  von         date not null,
  bis         date not null,
  fehlend     jsonb not null default '[]'::jsonb,   -- [{datum, quelle}]
  mail_status text,
  geprueft_am timestamptz not null default now()
);
alter table z_bon_pruefungen enable row level security;
drop policy if exists "Admin read z_bon_pruefungen" on z_bon_pruefungen;
create policy "Admin read z_bon_pruefungen" on z_bon_pruefungen for select to authenticated using (is_admin());

-- KI-Erkennung nachvollziehbar halten
alter table z_bons add column if not exists erkannt jsonb;
alter table z_bons add column if not exists automatisch boolean not null default false;

notify pgrst, 'reload schema';
