-- Row Level Security policies
-- Rule: admins see/do everything; suppliers only see/do rows tied to their supplier_id.

alter table public.suppliers   enable row level security;
alter table public.profiles    enable row level security;
alter table public.orders      enable row level security;
alter table public.payments    enable row level security;
alter table public.documents   enable row level security;
alter table public.order_events enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_admin_write on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ── suppliers ───────────────────────────────────────────────────────────────
create policy suppliers_read on public.suppliers
  for select using (
    public.is_admin() or id = public.current_supplier_id()
  );

create policy suppliers_admin_write on public.suppliers
  for all using (public.is_admin()) with check (public.is_admin());

-- ── orders ──────────────────────────────────────────────────────────────────
create policy orders_read on public.orders
  for select using (
    public.is_admin() or supplier_id = public.current_supplier_id()
  );

create policy orders_admin_insert on public.orders
  for insert with check (public.is_admin());

create policy orders_admin_update_all on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

-- Suppliers may update a limited set of fields on their own orders.
-- (Postgres RLS can't restrict columns, so we allow the row update;
--  the API layer enforces which fields a supplier can change.)
create policy orders_supplier_update on public.orders
  for update using (
    not public.is_admin() and supplier_id = public.current_supplier_id()
  ) with check (
    supplier_id = public.current_supplier_id()
  );

create policy orders_admin_delete on public.orders
  for delete using (public.is_admin());

-- ── payments ────────────────────────────────────────────────────────────────
create policy payments_read on public.payments
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = payments.order_id
                 and o.supplier_id = public.current_supplier_id())
  );

create policy payments_admin_write on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

-- ── documents ───────────────────────────────────────────────────────────────
create policy documents_read on public.documents
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = documents.order_id
                 and o.supplier_id = public.current_supplier_id())
  );

create policy documents_insert on public.documents
  for insert with check (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = documents.order_id
                 and o.supplier_id = public.current_supplier_id())
  );

create policy documents_admin_delete on public.documents
  for delete using (public.is_admin());

-- ── order_events ────────────────────────────────────────────────────────────
create policy order_events_read on public.order_events
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = order_events.order_id
                 and o.supplier_id = public.current_supplier_id())
  );

create policy order_events_insert on public.order_events
  for insert with check (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = order_events.order_id
                 and o.supplier_id = public.current_supplier_id())
  );

-- ── Storage bucket policies ────────────────────────────────────────────────
-- Bucket "order-files" must be created in Supabase dashboard or via:
--   insert into storage.buckets (id, name, public) values ('order-files','order-files', false);
-- Files are stored under: <order_id>/<filename>
-- RLS on storage.objects:

create policy "order-files read"
  on storage.objects for select
  using (
    bucket_id = 'order-files' and (
      public.is_admin()
      or exists (
        select 1 from public.orders o
        where o.id::text = split_part(name, '/', 1)
          and o.supplier_id = public.current_supplier_id()
      )
    )
  );

create policy "order-files insert"
  on storage.objects for insert
  with check (
    bucket_id = 'order-files' and (
      public.is_admin()
      or exists (
        select 1 from public.orders o
        where o.id::text = split_part(name, '/', 1)
          and o.supplier_id = public.current_supplier_id()
      )
    )
  );

create policy "order-files delete admin"
  on storage.objects for delete
  using (bucket_id = 'order-files' and public.is_admin());
