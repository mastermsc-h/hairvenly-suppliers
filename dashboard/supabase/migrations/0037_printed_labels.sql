-- Tracking welche Etiketten (mit welchen EANs) schon gedruckt wurden.
-- Damit kann das Dashboard beim nächsten Druck-Vorgang vorschlagen, wie viele
-- Etiketten ein Produkt noch braucht (Lager minus bereits gedruckt).

create table if not exists printed_labels (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  product_title text not null,
  collection text,
  quantity int not null check (quantity > 0),
  printed_at timestamptz not null default now(),
  printed_by uuid references public.profiles(id)
);

create index if not exists printed_labels_barcode_idx on printed_labels(barcode);
create index if not exists printed_labels_printed_at_idx on printed_labels(printed_at desc);

-- Aggregat-View: pro Barcode die Summe aller je gedruckten Etiketten + letztes Datum
create or replace view v_printed_labels_summary as
select
  barcode,
  sum(quantity)::int as total_printed,
  max(printed_at) as last_printed_at,
  max(product_title) as product_title
from printed_labels
group by barcode;

-- RLS: alle authenticated User dürfen schreiben/lesen
alter table printed_labels enable row level security;

drop policy if exists "Authenticated read printed_labels" on printed_labels;
create policy "Authenticated read printed_labels" on printed_labels
  for select to authenticated using (true);

drop policy if exists "Authenticated write printed_labels" on printed_labels;
create policy "Authenticated write printed_labels" on printed_labels
  for all to authenticated using (true) with check (true);
