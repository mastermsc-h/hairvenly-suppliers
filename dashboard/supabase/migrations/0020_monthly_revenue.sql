-- Monthly revenue snapshot table for return rate calculations
create table if not exists shopify_monthly_revenue (
  month date primary key,                      -- first day of month, e.g. 2026-04-01
  gross_revenue numeric(14,2) not null default 0,
  order_count int not null default 0,
  synced_at timestamptz not null default now()
);

alter table shopify_monthly_revenue enable row level security;

create policy "Authenticated read shopify_monthly_revenue" on shopify_monthly_revenue for select to authenticated using (true);
create policy "Admin manage shopify_monthly_revenue" on shopify_monthly_revenue for all to authenticated
  using (is_admin()) with check (is_admin());
