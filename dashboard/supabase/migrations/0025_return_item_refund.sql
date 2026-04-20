-- Store the refund amount per line item (Euro). Enables accurate per-collection
-- refund totals. Existing items will be backfilled by splitting the return's
-- total refund_amount equally across its items.

alter table return_items add column if not exists refund_amount numeric(10,2);

-- Backfill: split each return's refund_amount equally among its items
update return_items ri
set refund_amount = sub.per_item
from (
  select
    ri.id,
    case when cnt.item_count > 0
      then round(coalesce(r.refund_amount, 0) / cnt.item_count, 2)
      else 0
    end as per_item
  from return_items ri
  join returns r on r.id = ri.return_id
  join (
    select return_id, count(*) as item_count
    from return_items
    group by return_id
  ) cnt on cnt.return_id = ri.return_id
  where ri.refund_amount is null
) sub
where ri.id = sub.id;

-- Set any remaining NULLs to 0 (shouldn't happen, but safety)
update return_items set refund_amount = 0 where refund_amount is null;

-- Rebuild view: Euro-based totals per collection
create or replace view v_returns_by_collection as
select
  coalesce(ri.collection_title, 'Unassigned') as collection_title,
  r.return_type,
  sum(ri.quantity)::int as item_count,
  count(distinct r.id)::int as return_count,
  coalesce(sum(ri.refund_amount), 0) as total_refund
from return_items ri
join returns r on r.id = ri.return_id
group by 1, 2;
