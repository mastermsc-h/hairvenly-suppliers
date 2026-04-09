-- Hairvenly Supplier Order Dashboard — initial schema
-- All monetary values in USD.

create extension if not exists "pgcrypto";

-- ──────────────────────────────────────────────────────────────────────────────
-- Suppliers
-- ──────────────────────────────────────────────────────────────────────────────
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  default_lead_weeks int not null default 6,
  price_list_url  text,
  created_at      timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Profiles (links auth.users to a supplier OR marks them admin)
-- ──────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  is_admin    boolean not null default false,
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index profiles_supplier_idx on public.profiles(supplier_id);

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Helper: which supplier does the current user belong to?
create or replace function public.current_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select supplier_id from public.profiles where id = auth.uid();
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Orders
-- ──────────────────────────────────────────────────────────────────────────────
create type order_status as enum (
  'draft',
  'sent_to_supplier',
  'confirmed',
  'in_production',
  'ready_to_ship',
  'shipped',
  'in_customs',
  'delivered',
  'cancelled'
);

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers(id) on delete restrict,
  label           text not null,
  description     text,
  tags            text[] not null default '{}',                  -- e.g. {extensions,kleber,zubehör}
  sheet_url       text,                                          -- google sheet link to the order overview
  status          order_status not null default 'draft',
  invoice_total   numeric(12,2),                                 -- total invoice amount in USD
  goods_value     numeric(12,2),                                 -- ware
  shipping_cost   numeric(12,2),                                 -- versand
  customs_duty    numeric(12,2),                                 -- zoll
  import_vat      numeric(12,2),                                 -- einfuhrumsatzsteuer
  weight_kg       numeric(10,2),
  package_count   int,
  tracking_number text,
  tracking_url    text,
  eta             date,
  last_supplier_update date,                                     -- when supplier last gave an update
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index orders_supplier_idx on public.orders(supplier_id);
create index orders_status_idx on public.orders(status);
create index orders_created_at_idx on public.orders(created_at desc);

-- ──────────────────────────────────────────────────────────────────────────────
-- Payments (Teilzahlungen)
-- ──────────────────────────────────────────────────────────────────────────────
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  amount        numeric(12,2) not null check (amount > 0),
  paid_at       date not null default current_date,
  method        text,                              -- e.g. "Sparkasse Überweisung"
  proof_path    text,                              -- storage path to bank receipt
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create index payments_order_idx on public.payments(order_id);

-- Landed cost view (computed, not stored) — depends on orders + payments
create or replace view public.orders_with_totals as
select
  o.*,
  coalesce(o.goods_value,0) + coalesce(o.shipping_cost,0)
    + coalesce(o.customs_duty,0) + coalesce(o.import_vat,0) as landed_cost,
  coalesce((select sum(amount) from public.payments p where p.order_id = o.id), 0) as paid_total,
  coalesce(o.invoice_total,0)
    - coalesce((select sum(amount) from public.payments p where p.order_id = o.id), 0) as remaining_balance
from public.orders o;

-- ──────────────────────────────────────────────────────────────────────────────
-- Documents (screenshots, invoices, customs, DHL, misc)
-- ──────────────────────────────────────────────────────────────────────────────
create type document_kind as enum (
  'order_screenshot',
  'supplier_invoice',
  'customs_document',
  'dhl_document',
  'damage_report',
  'other'
);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  kind         document_kind not null default 'other',
  file_path    text not null,                       -- storage path
  file_name    text not null,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index documents_order_idx on public.documents(order_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Status / Audit timeline
-- ──────────────────────────────────────────────────────────────────────────────
create table public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  event_type  text not null,                        -- 'status_change' | 'note' | 'payment' | 'document' | 'field_change'
  message     text not null,
  meta        jsonb,
  actor_id    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index order_events_order_idx on public.order_events(order_id, created_at desc);

-- Trigger: log status changes automatically
create or replace function public.log_order_status_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events(order_id, event_type, message, actor_id, meta)
    values (new.id, 'status_change', 'Order created with status ' || new.status, auth.uid(),
            jsonb_build_object('status', new.status));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.order_events(order_id, event_type, message, actor_id, meta)
    values (new.id, 'status_change',
            'Status: ' || old.status || ' → ' || new.status, auth.uid(),
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger orders_status_log
after insert or update on public.orders
for each row execute function public.log_order_status_change();

create trigger orders_touch_updated
before update on public.orders
for each row execute function public.log_order_status_change();

-- ──────────────────────────────────────────────────────────────────────────────
-- Auto-create profile on signup
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
