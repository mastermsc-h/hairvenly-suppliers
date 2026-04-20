-- Add quantity tracking to return_items so return counts match Shopify's Stück
alter table return_items add column if not exists quantity int not null default 1;

-- Rebuild v_returns_by_collection to use quantity instead of count(*)
create or replace view v_returns_by_collection as
select
  coalesce(ri.collection_title, 'Unassigned') as collection_title,
  r.return_type,
  sum(ri.quantity)::int as item_count,
  count(distinct r.id)::int as return_count,
  coalesce(sum(r.refund_amount), 0) as total_refund
from return_items ri
join returns r on r.id = ri.return_id
group by 1, 2;
