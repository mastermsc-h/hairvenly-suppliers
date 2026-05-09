-- Salon-Verbrauchs-System
-- Friseure entnehmen Packs aus dem Lager und geben Reste zurueck.
-- Reste wandern in Loose-Stock, bis 25g/50g erreicht sind und der Lagerist
-- daraus wieder ein Pack zusammenstellt.

-- ─── Mitarbeiter ────────────────────────────────────────────────
create table salon_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin text not null,                                       -- 4-6-stellig
  active boolean not null default true,
  color text,                                              -- Tile-Farbe (hex), optional
  created_at timestamptz not null default now()
);

-- PIN muss eindeutig sein (nur fuer aktive Mitarbeiter)
create unique index salon_employees_pin_active
  on salon_employees(pin) where active = true;

-- ─── Entnahmen ──────────────────────────────────────────────────
create table salon_entnahmen (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references salon_employees(id),

  -- Snapshot beim Scan
  barcode text not null,
  product_title text not null,
  variant_title text,
  pack_grams int not null,                                 -- 25 / 50 / 100 / 150 / 225
  category text not null,                                  -- 'tape' | 'mini_tape' | 'bonding' | 'tresse' | 'clip' | 'other'

  -- Status & Rueckgabe
  status text not null default 'open'
    check (status in ('open','returned_full','returned_partial','cancelled')),
  taken_at timestamptz not null default now(),
  closed_at timestamptz,
  used_grams int,                                          -- = pack_grams - rest_grams
  rest_grams int,                                          -- 0 bei vollstaendig
  rest_pieces int,                                         -- nur bei angebrochen
  closed_by uuid references salon_employees(id),           -- wer hat zurueckgegeben (kann anders sein)

  note text
);

create index salon_entnahmen_status_idx on salon_entnahmen(status);
create index salon_entnahmen_employee_idx on salon_entnahmen(employee_id, taken_at desc);
create index salon_entnahmen_barcode_open_idx on salon_entnahmen(barcode) where status = 'open';

-- ─── Loose Stock ────────────────────────────────────────────────
-- Pro Produkt+Variante ein laufender Gramm-Counter.
-- Wenn >= pack_target_grams: Lagerist kann daraus wieder einen Pack einlagern.
create table salon_loose_stock (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  product_title text not null,
  variant_title text,
  total_grams int not null default 0,
  pack_target_grams int not null default 25,               -- ab wann ein neuer Pack moeglich ist
  updated_at timestamptz not null default now()
);

create unique index salon_loose_stock_unique
  on salon_loose_stock(category, product_title, coalesce(variant_title, ''));

-- ─── RLS ────────────────────────────────────────────────────────
alter table salon_employees enable row level security;
alter table salon_entnahmen enable row level security;
alter table salon_loose_stock enable row level security;

-- Admins/Mitarbeiter (is_admin=true) sehen alles und koennen alles aendern.
-- Friseure am iPad sind NICHT in profiles eingeloggt — Schreibzugriff
-- erfolgt ueber service_role (Server Actions mit createServiceClient).
create policy salon_employees_admin on salon_employees
  for all to authenticated
  using ((select is_admin from profiles where id = auth.uid()))
  with check ((select is_admin from profiles where id = auth.uid()));

create policy salon_entnahmen_admin on salon_entnahmen
  for all to authenticated
  using ((select is_admin from profiles where id = auth.uid()))
  with check ((select is_admin from profiles where id = auth.uid()));

create policy salon_loose_stock_admin on salon_loose_stock
  for all to authenticated
  using ((select is_admin from profiles where id = auth.uid()))
  with check ((select is_admin from profiles where id = auth.uid()));
