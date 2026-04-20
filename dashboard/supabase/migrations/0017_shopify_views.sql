-- SQL views for inventory, sales analysis, and topseller rankings.
-- These replace the Google Sheets Dashboard/Verkaufsanalyse/Topseller tabs.

-- ─── v_inventory: Inventory overview ────────────────────────────
-- Replaces readInventorySheet() from stock-sheets.ts
create or replace view v_inventory as
select
  sp.collection_title as collection,
  sp.title as product,
  sv.unit_weight,
  sv.quantity,
  sv.total_weight,
  sp.quality,
  sp.collection_handle,
  sv.color_code,
  sp.product_type,
  sp.length,
  sp.g_per_unit,
  sv.synced_at
from shopify_variants sv
join shopify_products sp on sv.product_id = sp.id
order by sp.quality, sp.collection_title, sp.title;

-- ─── v_sales_summary: Sales analysis per collection ─────────────
-- Replaces readVerkaufsanalyse() from stock-sheets.ts
create or replace view v_sales_summary as
select
  sp.collection_title as collection,
  sp.quality,
  sp.g_per_unit::text as g_per_unit,
  -- 12M average per month
  coalesce(sum(case when soi.ordered_at >= now() - interval '12 months' then soi.total_weight end), 0) / 12000.0 as avg_12m_kg,
  coalesce(sum(case when soi.ordered_at >= now() - interval '12 months' then soi.total_revenue end), 0) / 12.0 as avg_12m_eur,
  -- 3M average per month
  coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_weight end), 0) / 3000.0 as avg_3m_kg,
  coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_revenue end), 0) / 3.0 as avg_3m_eur,
  -- 30 days total
  coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_weight end), 0) / 1000.0 as d30_kg,
  coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_revenue end), 0) as d30_eur,
  -- Current month total
  coalesce(sum(case when soi.ordered_at >= date_trunc('month', now()) then soi.total_weight end), 0) / 1000.0 as cur_month_kg,
  coalesce(sum(case when soi.ordered_at >= date_trunc('month', now()) then soi.total_revenue end), 0) as cur_month_eur,
  -- Trend: 30d daily rate vs 3M daily rate
  case
    when coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_weight end), 0) = 0 then '→ 0%'
    else
      case
        when (coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_weight end), 0) / 30.0)
           / (coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_weight end), 0) / 90.0) > 1.1
        then '↑ +' || round(((coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_weight end), 0) / 30.0)
           / (coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_weight end), 0) / 90.0) - 1) * 100) || '%'
        when (coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_weight end), 0) / 30.0)
           / (coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_weight end), 0) / 90.0) < 0.9
        then '↓ ' || round(((coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_weight end), 0) / 30.0)
           / (coalesce(sum(case when soi.ordered_at >= now() - interval '3 months' then soi.total_weight end), 0) / 90.0) - 1) * 100) || '%'
        else '→ 0%'
      end
  end as trend
from shopify_order_items soi
join shopify_products sp on soi.product_id = sp.id
where sp.quality in ('Usbekisch Wellig', 'Russisch Glatt')
  and soi.ordered_at >= now() - interval '12 months'
group by sp.collection_title, sp.quality, sp.g_per_unit;

-- ─── v_topseller: Ranked products by sales velocity ─────────────
-- Replaces readTopseller() + buildRankingTS_() from Code.js
-- Groups by product_type + length, ranks by 90-day grams sold.
-- Premium categories (55cm Tapes, 65cm Tapes/Bondings/Genius, Std Tapes, Bondings, Minitapes):
--   TOP7 = rank 1-10, MID = rank 11-20
-- Other categories:
--   TOP7 = rank 1-7, MID = rank 8-14
-- REST = rank > MID limit but >= 50g sold, KAUM = < 50g
create or replace view v_topseller as
with sales_90d as (
  -- Aggregate 90-day and 30-day sales per product (color_code)
  select
    sp.collection_handle,
    sp.quality,
    sp.product_type,
    sp.length,
    sv.color_code,
    -- Use full product title as display name
    sp.title as product_name,
    sp.g_per_unit,
    -- 90-day sales
    coalesce(sum(case when soi.ordered_at >= now() - interval '90 days' then soi.total_weight end), 0) as grams_sold_90d,
    coalesce(sum(case when soi.ordered_at >= now() - interval '90 days' then soi.quantity end), 0) as qty_sold_90d,
    -- 30-day sales
    coalesce(sum(case when soi.ordered_at >= now() - interval '30 days' then soi.total_weight end), 0) as grams_sold_30d,
    -- day 31-90 sales (for velocity correction)
    coalesce(sum(case when soi.ordered_at >= now() - interval '90 days'
                       and soi.ordered_at < now() - interval '30 days' then soi.total_weight end), 0) as grams_sold_60d_alt
  from shopify_variants sv
  join shopify_products sp on sv.product_id = sp.id
  left join shopify_order_items soi on soi.product_id = sp.id
    and soi.ordered_at >= now() - interval '90 days'
  where sp.quality in ('Usbekisch Wellig', 'Russisch Glatt')
  group by sp.collection_handle, sp.quality, sp.product_type, sp.length,
           sv.color_code, sp.title, sp.g_per_unit
),
inventory as (
  -- Current stock per product (color_code)
  select
    sp.collection_handle,
    sv.color_code,
    sum(sv.total_weight) as lager_g,
    sum(sv.quantity) as lager_stk
  from shopify_variants sv
  join shopify_products sp on sv.product_id = sp.id
  where sp.quality in ('Usbekisch Wellig', 'Russisch Glatt')
  group by sp.collection_handle, sv.color_code
),
transit as (
  -- In-transit stock from supplier orders (order_items table)
  select
    oi.method_name as product_type,
    oi.color_name,
    sum(oi.quantity) as transit_g
  from order_items oi
  join orders o on oi.order_id = o.id
  where o.status not in ('delivered', 'cancelled')
  group by oi.method_name, oi.color_name
),
ranked as (
  select
    s.*,
    -- Determine if this is a premium category
    case when (s.product_type || '|' || s.length) in (
      'Tapes|55cm', 'Tapes|65cm', 'Bondings|65cm', 'Genius Weft|65cm',
      'Standard Tapes|', 'Bondings|', 'Minitapes|'
    ) then true else false end as is_premium,
    -- Rank within product_type + length group
    row_number() over (
      partition by s.quality, s.product_type, s.length
      order by s.grams_sold_90d desc
    ) as rang,
    -- Inventory
    coalesce(inv.lager_g, 0) as lager_g,
    -- Velocity-corrected forecast (30 days)
    case
      when s.grams_sold_60d_alt / 60.0 > 0.5
        and s.grams_sold_30d / 30.0 < (s.grams_sold_60d_alt / 60.0) * 0.6
      then round(s.grams_sold_60d_alt / 60.0 * 30)
      when s.grams_sold_30d > 0 then round(s.grams_sold_30d / 30.0 * 30)
      else 0
    end as prognose
  from sales_90d s
  left join inventory inv on inv.collection_handle = s.collection_handle
    and inv.color_code = s.color_code
)
select
  r.collection_handle,
  r.quality,
  r.product_type,
  r.length,
  r.color_code,
  r.product_name,
  r.g_per_unit,
  r.rang,
  r.grams_sold_90d,
  r.qty_sold_90d,
  r.grams_sold_30d,
  r.prognose,
  r.lager_g,
  r.is_premium,
  -- Tier assignment
  case
    when r.is_premium and r.rang <= 10 then 'TOP7'
    when not r.is_premium and r.rang <= 7 then 'TOP7'
    when r.is_premium and r.rang <= 20 then 'MID'
    when not r.is_premium and r.rang <= 14 then 'MID'
    when r.grams_sold_90d >= 50 then 'REST'
    else 'KAUM'
  end as tier,
  -- Target stock (Ziel)
  case
    when r.is_premium and r.rang <= 10 then 2000  -- TOP7 premium
    when not r.is_premium and r.rang <= 7 then 1000  -- TOP7 normal
    when (r.is_premium and r.rang <= 20) or (not r.is_premium and r.rang <= 14) then 500  -- MID
    when r.grams_sold_90d >= 50 then 300  -- REST
    else 0  -- KAUM
  end as ziel,
  -- Rang-Klasse label
  case
    when r.is_premium and r.rang <= 10 then 'Top 1–10'
    when not r.is_premium and r.rang <= 7 then 'Top 1–7'
    when r.is_premium and r.rang <= 20 then 'Rang 11–20'
    when not r.is_premium and r.rang <= 14 then 'Rang 8–14'
    when r.grams_sold_90d >= 50 then 'Rest'
    else 'Kaum verkauft'
  end as rang_klasse
from ranked r
order by r.quality, r.product_type, r.length, r.rang;

-- ─── v_last_sync: Last sync timestamp ───────────────────────────
create or replace view v_last_sync as
select
  sync_type,
  max(completed_at) as last_synced
from shopify_sync_log
where status = 'completed'
group by sync_type;
