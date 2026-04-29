-- Track customer identity + repurchase outcome for each return
-- so we can compute "Wiederkaufsrate nach Retoure" analytics.

alter table returns
  add column if not exists customer_email text,
  add column if not exists customer_id text,                  -- shopify Customer GID
  add column if not exists repurchase_status text,            -- 'exchange' | 'new_order' | 'lost' | 'pending'
  add column if not exists repurchase_order_id text,          -- shopify Order GID of the recovery order
  add column if not exists repurchase_order_at timestamptz,
  add column if not exists repurchase_check_at timestamptz;

create index if not exists idx_returns_customer_email on returns(customer_email);
create index if not exists idx_returns_customer_id on returns(customer_id);
create index if not exists idx_returns_repurchase_status on returns(repurchase_status);
