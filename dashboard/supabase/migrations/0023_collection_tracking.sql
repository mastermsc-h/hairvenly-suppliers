-- Track actual Shopify collection per return item + monthly sales per collection

-- 1. Add collection_title to return_items
alter table return_items add column if not exists collection_title text;
create index if not exists return_items_collection_idx on return_items(collection_title);

-- 2. Monthly sales per collection (for rate calculation)
create table if not exists shopify_collection_sales (
  month text not null,                        -- "YYYY-MM-01"
  collection_title text not null,
  gross_revenue numeric(14,2) not null default 0,
  order_count int not null default 0,
  item_count int not null default 0,          -- sum of line-item quantities
  synced_at timestamptz not null default now(),
  primary key (month, collection_title)
);

create index if not exists scs_collection_idx on shopify_collection_sales(collection_title);
create index if not exists scs_month_idx on shopify_collection_sales(month);

alter table shopify_collection_sales enable row level security;
create policy "Authenticated read shopify_collection_sales" on shopify_collection_sales for select to authenticated using (true);
create policy "Admin manage shopify_collection_sales" on shopify_collection_sales for all to authenticated
  using (is_admin()) with check (is_admin());

-- 3. View: totals per collection (return count + sales + rate)
create or replace view v_returns_by_collection as
select
  coalesce(ri.collection_title, 'Unassigned') as collection_title,
  r.return_type,
  count(*)::int as item_count,
  count(distinct r.id)::int as return_count,
  coalesce(sum(r.refund_amount), 0) as total_refund
from return_items ri
join returns r on r.id = ri.return_id
group by 1, 2;
