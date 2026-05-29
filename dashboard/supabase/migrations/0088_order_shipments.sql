-- Teillieferungen ("Partial Shipments"): An order can be split into multiple
-- shipments. Each shipment has its own tracking + ETA + notes, may carry
-- a subset of order_items, and may have its own documents.

create table public.order_shipments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  label        text,                                            -- optional supplier label "Teil 1 / 3"
  tracking_number text,
  tracking_url    text,
  eta          date,
  shipped_at   date,                                             -- when supplier sent it
  arrived_at   date,                                             -- when it arrived here
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index order_shipments_order_idx on public.order_shipments(order_id);

-- Link individual line items to a shipment (nullable = not yet assigned)
alter table public.order_items
  add column if not exists shipment_id uuid references public.order_shipments(id) on delete set null;
create index if not exists order_items_shipment_idx on public.order_items(shipment_id);

-- Documents can be tied to a specific shipment (nullable = order-level doc)
alter table public.documents
  add column if not exists shipment_id uuid references public.order_shipments(id) on delete set null;
create index if not exists documents_shipment_idx on public.documents(shipment_id);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.order_shipments enable row level security;

-- Read: admin + the supplier who owns the parent order
create policy shipments_read on public.order_shipments
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = order_shipments.order_id
                 and o.supplier_id = public.current_supplier_id())
  );

-- Admin: full write
create policy shipments_admin_write on public.order_shipments
  for all using (public.is_admin()) with check (public.is_admin());

-- Supplier: can insert / update / delete shipments for own orders
create policy shipments_supplier_insert on public.order_shipments
  for insert with check (
    not public.is_admin()
    and exists (select 1 from public.orders o
                where o.id = order_shipments.order_id
                  and o.supplier_id = public.current_supplier_id())
  );

create policy shipments_supplier_update on public.order_shipments
  for update using (
    not public.is_admin()
    and exists (select 1 from public.orders o
                where o.id = order_shipments.order_id
                  and o.supplier_id = public.current_supplier_id())
  ) with check (
    exists (select 1 from public.orders o
            where o.id = order_shipments.order_id
              and o.supplier_id = public.current_supplier_id())
  );

create policy shipments_supplier_delete on public.order_shipments
  for delete using (
    not public.is_admin()
    and exists (select 1 from public.orders o
                where o.id = order_shipments.order_id
                  and o.supplier_id = public.current_supplier_id())
  );

-- Trigger to keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_order_shipments_touch on public.order_shipments;
create trigger trg_order_shipments_touch
  before update on public.order_shipments
  for each row execute function public.touch_updated_at();
