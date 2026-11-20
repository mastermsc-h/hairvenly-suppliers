-- Notizen zu Gewerbekunden (je Shopify-Kunde eine Notiz).
create table if not exists gewerbe_notizen (
  customer_id bigint primary key,
  notiz text not null default '',
  geaendert_von uuid references profiles(id) on delete set null,
  geaendert_am timestamptz not null default now()
);
alter table gewerbe_notizen enable row level security;
-- keine Policies: Zugriff nur über service_role (Server)
