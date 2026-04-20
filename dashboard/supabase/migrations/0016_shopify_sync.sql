-- Shopify data tables: Products, Variants, Orders, Order Items
-- Replaces Google Sheets as data source for inventory/sales/topseller

-- ─── Products ───────────────────────────────────────────────────
create table shopify_products (
  id bigint primary key,                    -- Shopify product_id
  title text not null,
  collection_handle text,                   -- e.g. "tapes-45cm", "clip-extensions"
  collection_title text,                    -- e.g. "Tapes Wellig 45cm"
  quality text,                             -- "Usbekisch Wellig" | "Russisch Glatt" | "Tools"
  product_type text,                        -- "Tapes" | "Bondings" | "Clip-ins" etc.
  length text,                              -- "45cm" | "65cm" | "" etc.
  g_per_unit int not null default 25,       -- grams per unit (from COLL_MAP)
  synced_at timestamptz not null default now()
);

create index shopify_products_quality_idx on shopify_products(quality);
create index shopify_products_handle_idx on shopify_products(collection_handle);

-- ─── Variants (with inventory) ──────────────────────────────────
create table shopify_variants (
  id bigint primary key,                    -- Shopify variant_id
  product_id bigint not null references shopify_products(id) on delete cascade,
  inventory_item_id bigint,                 -- for Inventory Level API
  title text,                               -- e.g. "#3T Pearl White 225g"
  color_code text,                          -- extracted: "#3T PEARL WHITE"
  unit_weight int not null default 0,       -- grams per unit
  quantity int not null default 0,          -- available stock
  total_weight int not null default 0,      -- quantity × unit_weight (computed on sync)
  synced_at timestamptz not null default now()
);

create index shopify_variants_product_idx on shopify_variants(product_id);
create index shopify_variants_color_idx on shopify_variants(color_code);

-- ─── Orders ─────────────────────────────────────────────────────
create table shopify_orders (
  id bigint primary key,                    -- Shopify order_id
  name text,                                -- e.g. "#1234"
  created_at timestamptz not null,
  financial_status text,                    -- "paid", "pending", etc.
  total_price numeric(12,2),
  synced_at timestamptz not null default now()
);

create index shopify_orders_created_idx on shopify_orders(created_at desc);
create index shopify_orders_status_idx on shopify_orders(financial_status);

-- ─── Order Line Items ───────────────────────────────────────────
create table shopify_order_items (
  id bigint primary key generated always as identity,
  order_id bigint not null references shopify_orders(id) on delete cascade,
  shopify_line_item_id bigint,              -- Shopify line_item id
  product_id bigint references shopify_products(id) on delete set null,
  variant_id bigint,
  title text not null,                      -- product name
  variant_title text,                       -- variant name
  quantity int not null,
  unit_weight int not null default 0,       -- g per unit
  total_weight int not null default 0,      -- quantity × unit_weight
  price numeric(12,2) not null,             -- Shopify selling price per unit
  total_revenue numeric(12,2) not null,     -- quantity × price
  collection_handle text,
  ordered_at timestamptz not null           -- order.created_at
);

create index shopify_order_items_order_idx on shopify_order_items(order_id);
create index shopify_order_items_product_idx on shopify_order_items(product_id);
create index shopify_order_items_ordered_idx on shopify_order_items(ordered_at desc);
create index shopify_order_items_handle_idx on shopify_order_items(collection_handle);

-- ─── Sync Log ───────────────────────────────────────────────────
create table shopify_sync_log (
  id uuid primary key default gen_random_uuid(),
  sync_type text not null,                  -- 'inventory' | 'orders' | 'full'
  status text not null default 'running',   -- 'running' | 'completed' | 'failed'
  products_synced int default 0,
  variants_synced int default 0,
  orders_synced int default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ─── RLS ────────────────────────────────────────────────────────
alter table shopify_products enable row level security;
alter table shopify_variants enable row level security;
alter table shopify_orders enable row level security;
alter table shopify_order_items enable row level security;
alter table shopify_sync_log enable row level security;

-- Read: all authenticated users
create policy "Authenticated read shopify_products" on shopify_products for select to authenticated using (true);
create policy "Authenticated read shopify_variants" on shopify_variants for select to authenticated using (true);
create policy "Authenticated read shopify_orders" on shopify_orders for select to authenticated using (true);
create policy "Authenticated read shopify_order_items" on shopify_order_items for select to authenticated using (true);
create policy "Authenticated read shopify_sync_log" on shopify_sync_log for select to authenticated using (true);

-- Write: admins only
create policy "Admin manage shopify_products" on shopify_products for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "Admin manage shopify_variants" on shopify_variants for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "Admin manage shopify_orders" on shopify_orders for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "Admin manage shopify_order_items" on shopify_order_items for all to authenticated
  using (is_admin()) with check (is_admin());
create policy "Admin manage shopify_sync_log" on shopify_sync_log for all to authenticated
  using (is_admin()) with check (is_admin());
