-- Returns management: Rücksendungen, Umtausch, Reklamationen
-- Syncs with Shopify Returns API + manual enrichment

-- ─── Returns (main table for all 3 types) ──────────────────────
create table returns (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text,
  shopify_return_id text unique,
  order_number text,
  customer_name text not null,
  return_type text not null check (return_type in ('return', 'exchange', 'complaint')),
  reason text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  handler text,
  notes text,
  resolution text,
  resolution_result text,
  refund_amount numeric(10,2),
  initiated_at date,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create index returns_type_idx on returns(return_type);
create index returns_status_idx on returns(status);
create index returns_initiated_idx on returns(initiated_at desc);
create index returns_shopify_order_idx on returns(shopify_order_id);

-- ─── Return Items (products being returned/exchanged) ──────────
create table return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references returns(id) on delete cascade,
  product_type text,
  color text,
  length text,
  origin text,
  weight text,
  quality text,
  exchange_product text,
  exchange_weight text,
  exchange_tracking text
);

create index return_items_return_idx on return_items(return_id);

-- ─── Return Events (timeline / audit log) ──────────────────────
create table return_events (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references returns(id) on delete cascade,
  event_type text not null,
  message text not null,
  actor_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index return_events_return_idx on return_events(return_id);

-- ─── Views ─────────────────────────────────────────────────────

-- Monthly summary by type
create or replace view v_returns_summary as
select
  date_trunc('month', initiated_at)::date as month,
  return_type,
  count(*)::int as total,
  count(*) filter (where status = 'resolved')::int as resolved,
  coalesce(sum(refund_amount), 0) as total_refund
from returns
where initiated_at is not null
group by 1, 2;

-- Reason breakdown
create or replace view v_returns_by_reason as
select
  reason,
  return_type,
  count(*)::int as cnt
from returns
where reason is not null
group by 1, 2
order by cnt desc;

-- Product type breakdown
create or replace view v_returns_by_product as
select
  ri.product_type,
  r.return_type,
  count(distinct r.id)::int as return_count,
  count(ri.id)::int as item_count
from return_items ri
join returns r on r.id = ri.return_id
where ri.product_type is not null
group by 1, 2
order by return_count desc;

-- ─── RLS ───────────────────────────────────────────────────────
alter table returns enable row level security;
alter table return_items enable row level security;
alter table return_events enable row level security;

-- Read: all authenticated
create policy "Authenticated read returns" on returns for select to authenticated using (true);
create policy "Authenticated read return_items" on return_items for select to authenticated using (true);
create policy "Authenticated read return_events" on return_events for select to authenticated using (true);

-- Write: admins only
create policy "Admin manage returns" on returns for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "Admin manage return_items" on return_items for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "Admin manage return_events" on return_events for all to authenticated
  using (is_admin()) with check (is_admin());
