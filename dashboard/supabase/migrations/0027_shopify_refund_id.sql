-- Track Shopify refund events individually. Each refund creates its own return
-- row so that multiple refunds on the same order don't get deduplicated away.

alter table returns add column if not exists shopify_refund_id text;

-- Unique when set (multiple NULLs allowed for manual/sheet-imported entries)
create unique index if not exists returns_shopify_refund_id_unique
  on returns (shopify_refund_id)
  where shopify_refund_id is not null;

create index if not exists returns_shopify_refund_id_idx
  on returns (shopify_refund_id);
