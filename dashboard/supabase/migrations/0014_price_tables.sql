-- Price tables: supplier purchase prices + selling prices for margin calculation
-- Flexible per-supplier structure: methods as JSONB, prices as JSONB

-- Drop existing tables (reverse dependency order) to allow re-run
drop table if exists price_product_mappings cascade;
drop table if exists price_entries cascade;
drop table if exists price_color_categories cascade;
drop table if exists price_length_groups cascade;
drop table if exists supplier_price_lists cascade;

-- 1. Price lists (one per supplier/region)
create table supplier_price_lists (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name text not null,
  methods jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Length groups within a price list
--    selling_prices: VK per method, same for ALL colors in this length group
--    format: {"Tape": {"brutto": 1750, "netto": 1470.6, "gewerbe": 1400}, ...}
create table price_length_groups (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references supplier_price_lists(id) on delete cascade,
  label text not null,
  length_values text[] not null default '{}',
  selling_prices jsonb not null default '{}',
  sort_order int default 0
);

-- 3. Color categories within a price list
create table price_color_categories (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references supplier_price_lists(id) on delete cascade,
  name text not null,
  sort_order int default 0
);

-- 4. Price entries: one per length_group × color_category
create table price_entries (
  id uuid primary key default gen_random_uuid(),
  length_group_id uuid not null references price_length_groups(id) on delete cascade,
  color_category_id uuid not null references price_color_categories(id) on delete cascade,
  prices jsonb not null default '{}',
  unique(length_group_id, color_category_id)
);

-- 5. Map catalog product_colors to price color categories
create table price_product_mappings (
  id uuid primary key default gen_random_uuid(),
  color_category_id uuid not null references price_color_categories(id) on delete cascade,
  product_color_id uuid not null references product_colors(id) on delete cascade,
  unique(product_color_id)
);

-- RLS policies
alter table supplier_price_lists enable row level security;
alter table price_length_groups enable row level security;
alter table price_color_categories enable row level security;
alter table price_entries enable row level security;
alter table price_product_mappings enable row level security;

-- Read: all authenticated users
create policy "Authenticated can read price lists" on supplier_price_lists for select to authenticated using (true);
create policy "Authenticated can read length groups" on price_length_groups for select to authenticated using (true);
create policy "Authenticated can read color categories" on price_color_categories for select to authenticated using (true);
create policy "Authenticated can read price entries" on price_entries for select to authenticated using (true);
create policy "Authenticated can read product mappings" on price_product_mappings for select to authenticated using (true);

-- Write: admins only
create policy "Admins manage price lists" on supplier_price_lists for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Admins manage length groups" on price_length_groups for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Admins manage color categories" on price_color_categories for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Admins manage price entries" on price_entries for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true));

create policy "Admins manage product mappings" on price_product_mappings for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true));

-- =============================================
-- SEED: Ebru China Price List
-- =============================================
DO $$
DECLARE
  v_china_id uuid;
  v_list_id uuid;
  v_lg_45 uuid;
  v_lg_55 uuid;
  v_lg_70 uuid;
  v_lg_85 uuid;
  v_cc_platin uuid;
  v_cc_naturel uuid;
  v_cc_ombre uuid;
  v_cc_sombre uuid;
  v_cc_brond uuid;
  v_cc_soft uuid;
  v_cc_rofle uuid;
  v_cc_60no uuid;
  v_cc_pearl uuid;
BEGIN
  SELECT id INTO v_china_id FROM suppliers WHERE name = 'Eyfel Ebru (CN + TR)';

  -- Create price list
  INSERT INTO supplier_price_lists (supplier_id, name, methods) VALUES (
    v_china_id,
    'Ebru China Preise',
    '[
      {"name": "Tape", "surcharge": 50},
      {"name": "BONDINGS", "surcharge": 50},
      {"name": "TRESSEN", "surcharge": 30},
      {"name": "Genius Weft", "surcharge": 80},
      {"name": "Invisible Tape", "surcharge": 0}
    ]'::jsonb
  ) RETURNING id INTO v_list_id;

  -- Length groups
  -- Length groups with selling prices (VK) from Shopify
  INSERT INTO price_length_groups (price_list_id, label, length_values, selling_prices, sort_order) VALUES (
    v_list_id, '45cm', '{"45cm"}',
    '{"Tape": {"brutto": 1750, "netto": 1470.6, "gewerbe": 1400}}'::jsonb,
    1
  ) RETURNING id INTO v_lg_45;

  INSERT INTO price_length_groups (price_list_id, label, length_values, selling_prices, sort_order) VALUES (
    v_list_id, '55cm', '{"55cm"}',
    '{"Tape": {"brutto": 1850, "netto": 1554.6, "gewerbe": 1450}}'::jsonb,
    2
  ) RETURNING id INTO v_lg_55;

  INSERT INTO price_length_groups (price_list_id, label, length_values, selling_prices, sort_order) VALUES (
    v_list_id, '65cm', '{"65cm"}',
    '{
      "TRESSEN": {"brutto": 1950, "netto": 1638.7, "gewerbe": 1500},
      "Genius Weft": {"brutto": 1950, "netto": 1638.7, "gewerbe": 1500},
      "BONDINGS": {"brutto": 1950, "netto": 1638.7, "gewerbe": 1500},
      "Tape": {"brutto": 1990, "netto": 1672.3, "gewerbe": 1500},
      "Invisible Tape": {"brutto": 2500, "netto": 2100.8, "gewerbe": 2020}
    }'::jsonb,
    3
  ) RETURNING id INTO v_lg_70;

  INSERT INTO price_length_groups (price_list_id, label, length_values, selling_prices, sort_order) VALUES (
    v_list_id, '85cm', '{"85cm"}',
    '{
      "BONDINGS": {"brutto": 2700, "netto": 2268.9, "gewerbe": 2100},
      "Tape": {"brutto": 2700, "netto": 2268.9, "gewerbe": 2100}
    }'::jsonb,
    4
  ) RETURNING id INTO v_lg_85;

  -- Color categories
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'PLATIN (613) ARATON (2-4-6-8-10-27-2E)', 1) RETURNING id INTO v_cc_platin;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'NATUREL', 2) RETURNING id INTO v_cc_naturel;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'OMBRE - BOYALI', 3) RETURNING id INTO v_cc_ombre;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'SOMBRE-SMOKE-ARTIC BLOND', 4) RETURNING id INTO v_cc_sombre;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'BROND MBRE-DUBAI-4/27T24-MOCHA MELT', 5) RETURNING id INTO v_cc_brond;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'SOFT BLOND', 6) RETURNING id INTO v_cc_soft;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'RÖFLE (HAZIR İŞÇİLİK +60$)', 7) RETURNING id INTO v_cc_rofle;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, '60 NO', 8) RETURNING id INTO v_cc_60no;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'PEARLY WHITE', 9) RETURNING id INTO v_cc_pearl;

  -- =============================================
  -- PRICE ENTRIES: 45-52 CM
  -- =============================================
  -- 45cm: nur Tape (Bondings/Tressen/Genius/Invisible gibt es nur bei 65cm)
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES
    (v_lg_45, v_cc_platin,  '{"Tape": 605}'),
    (v_lg_45, v_cc_naturel, '{"Tape": 585}'),
    (v_lg_45, v_cc_ombre,   '{"Tape": 655}'),
    (v_lg_45, v_cc_sombre,  '{"Tape": 705}'),
    (v_lg_45, v_cc_brond,   '{"Tape": 735}'),
    (v_lg_45, v_cc_soft,    '{"Tape": 755}'),
    (v_lg_45, v_cc_rofle,   '{"Tape": 655}'),
    (v_lg_45, v_cc_60no,    '{"Tape": 915}'),
    (v_lg_45, v_cc_pearl,   '{"Tape": 975}');

  -- =============================================
  -- PRICE ENTRIES: 55-62 CM
  -- =============================================
  -- 55cm: nur Tape
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES
    (v_lg_55, v_cc_platin,  '{"Tape": 735}'),
    (v_lg_55, v_cc_naturel, '{"Tape": 715}'),
    (v_lg_55, v_cc_ombre,   '{"Tape": 785}'),
    (v_lg_55, v_cc_sombre,  '{"Tape": 835}'),
    (v_lg_55, v_cc_brond,   '{"Tape": 865}'),
    (v_lg_55, v_cc_soft,    '{"Tape": 885}'),
    (v_lg_55, v_cc_rofle,   '{"Tape": 785}'),
    (v_lg_55, v_cc_60no,    '{"Tape": 1010}'),
    (v_lg_55, v_cc_pearl,   '{"Tape": 1060}');

  -- =============================================
  -- PRICE ENTRIES: 70 CM
  -- =============================================
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES
    (v_lg_70, v_cc_platin,  '{"TRESSEN": 792, "Genius Weft": 842, "BONDINGS": 812, "Tape": 812, "Invisible Tape": 962}'),
    (v_lg_70, v_cc_naturel, '{"TRESSEN": 772, "Genius Weft": 822, "BONDINGS": 792, "Tape": 792, "Invisible Tape": 942}'),
    (v_lg_70, v_cc_ombre,   '{"TRESSEN": 842, "Genius Weft": 892, "BONDINGS": 862, "Tape": 862, "Invisible Tape": 1012}'),
    (v_lg_70, v_cc_sombre,  '{"TRESSEN": 892, "Genius Weft": 942, "BONDINGS": 912, "Tape": 912, "Invisible Tape": 1062}'),
    (v_lg_70, v_cc_brond,   '{"TRESSEN": 887, "Genius Weft": 937, "BONDINGS": 922, "Tape": 962, "Invisible Tape": 1112}'),
    (v_lg_70, v_cc_soft,    '{"TRESSEN": 942, "Genius Weft": 992, "BONDINGS": 962, "Tape": 982, "Invisible Tape": 1132}'),
    (v_lg_70, v_cc_rofle,   '{"TRESSEN": 852, "Genius Weft": 902, "BONDINGS": 872, "Tape": 862, "Invisible Tape": 1012}'),
    (v_lg_70, v_cc_60no,    '{"TRESSEN": 1150, "Genius Weft": 1200, "BONDINGS": 1170, "Tape": 1175, "Invisible Tape": 1325}'),
    (v_lg_70, v_cc_pearl,   '{"TRESSEN": 1186, "Genius Weft": 1236, "BONDINGS": 1206, "Tape": 1211, "Invisible Tape": 1361}');

  -- 85cm: nur Tape + Bondings
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES
    (v_lg_85, v_cc_platin,  '{"Tape": 1230, "BONDINGS": 1225}'),
    (v_lg_85, v_cc_naturel, '{"Tape": 1210, "BONDINGS": 1205}'),
    (v_lg_85, v_cc_ombre,   '{"Tape": 1280, "BONDINGS": 1275}'),
    (v_lg_85, v_cc_rofle,   '{"Tape": 1280, "BONDINGS": 1275}'),
    (v_lg_85, v_cc_sombre,  '{"Tape": 1330, "BONDINGS": 1325}'),
    (v_lg_85, v_cc_soft,    '{"Tape": 1380, "BONDINGS": 1375}'),
    (v_lg_85, v_cc_60no,    '{"Tape": 1675, "BONDINGS": 1670}'),
    (v_lg_85, v_cc_pearl,   '{"Tape": 1695, "BONDINGS": 1690}');

  -- =============================================
  -- AUTO-MAP: Eyfel catalog colors → price categories
  -- (verified against actual order invoices)
  -- =============================================

  -- PLATIN (613) ARATON → only: 2, 2E, 4, 6, 8, 10, 27
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_platin, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly IN ('2', '2E', '4', '10', '27')
  ON CONFLICT (product_color_id) DO NOTHING;

  -- NATUREL → Natural
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_naturel, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly = 'Natural'
  ON CONFLICT (product_color_id) DO NOTHING;

  -- OMBRE - BOYALI → 1A, 3A, 5A, 14A, 24A, 99J, Norwegian, Silver, 5MSilver, 5M/Silver, Lila
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_ombre, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly IN ('1A', '3A', '5A', '4A', '24A', '99J', 'Norwegian', 'Silver', '5MSilver', '5M/Silver', 'Lila')
  ON CONFLICT (product_color_id) DO NOTHING;

  -- SOMBRE-SMOKE-ARTIC BLOND → Bergen Blond, Viking Blond, 2T14A, 5T18A, 3T8A
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_sombre, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly IN ('Bergen blond', 'Bergen Blond', 'Viking Blond', 'Viking blond', '2T14A', '5T18A', '3T8A')
  ON CONFLICT (product_color_id) DO NOTHING;

  -- BROND MBRE-DUBAI → Dubai, Mochamelt, 4/27T24
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_brond, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly IN ('Dubai', 'Mochamelt', '4/27T24')
  ON CONFLICT (product_color_id) DO NOTHING;

  -- SOFT BLOND → Soft Blond Balayage only
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_soft, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly IN ('Soft Blond Balayage', 'Soft blond balayage')
  ON CONFLICT (product_color_id) DO NOTHING;

  -- RÖFLE → 5P18A, 3TPearl White
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_rofle, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly IN ('5P18A', '3TPearl White')
  ON CONFLICT (product_color_id) DO NOTHING;

  -- 60 NO → 60
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_60no, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly = '60'
  ON CONFLICT (product_color_id) DO NOTHING;

  -- PEARLY WHITE → Pearl White
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_pearl, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_china_id
    AND pc.name_hairvenly = 'Pearl White'
  ON CONFLICT (product_color_id) DO NOTHING;

END $$;
