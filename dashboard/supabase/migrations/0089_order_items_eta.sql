-- Per-position ETA for order items.
-- Initially equal to the parent order's eta. Can be overridden manually
-- (via the order's source Google Sheet, synced back to DB via dashboard).
alter table public.order_items
  add column if not exists eta date;

-- Backfill existing items with their parent order's eta
update public.order_items oi
  set eta = o.eta
  from public.orders o
  where o.id = oi.order_id
    and oi.eta is null
    and o.eta is not null;

create index if not exists order_items_eta_idx on public.order_items(eta);
