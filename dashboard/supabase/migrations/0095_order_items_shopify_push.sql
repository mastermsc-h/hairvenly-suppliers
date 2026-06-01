-- Track when an order_item was pushed to Shopify inventory and how much was added.
-- Used for the audit trail / report and the "schon eingepflegt" warning in the
-- confirmation modal. No hard skip: user can always re-push (with warning).
alter table order_items
  add column if not exists pushed_to_shopify_at timestamptz,
  add column if not exists shopify_push_qty integer;

comment on column order_items.pushed_to_shopify_at is
  'Last time this item was pushed to Shopify inventory (informational; not a hard skip).';
comment on column order_items.shopify_push_qty is
  'Quantity that was last pushed to Shopify for this item.';
