-- Monthly sales per product (line-item title), same basis as
-- shopify_collection_sales: net of tax, cancelled orders excluded.
-- Enables a per-product return rate: refunded pieces / sold pieces.

create table if not exists shopify_product_sales (
  month date not null,
  product_title text not null,
  collection_title text,
  gross_revenue numeric(12,2) not null default 0,
  order_count integer not null default 0,
  item_count integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (month, product_title)
);

create index if not exists idx_product_sales_month
  on shopify_product_sales (month);
create index if not exists idx_product_sales_collection
  on shopify_product_sales (collection_title);

alter table shopify_product_sales enable row level security;

-- Same access pattern as shopify_collection_sales: readable by any
-- authenticated staff member; writes happen via the service role.
drop policy if exists "product_sales_read" on shopify_product_sales;
create policy "product_sales_read" on shopify_product_sales
  for select using (auth.role() = 'authenticated');
