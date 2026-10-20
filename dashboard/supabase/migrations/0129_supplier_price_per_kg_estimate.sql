-- Fester Kilopreis pro Lieferant (Ebru: 1125 USD/kg). Ebru schickt die Rechnung erst beim Versand –
-- bis dahin wird der Rechnungsbetrag aus weight_kg × Kilopreis geschätzt, damit "Offen" stimmt.
-- Sobald invoice_total eingetragen ist, gilt immer der echte Betrag.
alter table public.suppliers add column if not exists price_per_kg_usd numeric(10,2);
update public.suppliers set price_per_kg_usd = 1125 where name ilike 'ebru%' and price_per_kg_usd is null;

-- CREATE OR REPLACE VIEW erlaubt nur angehängte Spalten → neue Spalten am Ende
create or replace view public.orders_with_totals as
select
  o.id, o.supplier_id, o.label, o.description, o.tags, o.sheet_url, o.status,
  o.invoice_total, o.goods_value, o.shipping_cost, o.customs_duty, o.import_vat,
  o.weight_kg, o.package_count, o.tracking_number, o.tracking_url, o.eta,
  o.last_supplier_update, o.notes, o.created_by, o.created_at, o.updated_at,
  o.order_date, o.region,
  coalesce(o.invoice_total, 0) + coalesce(o.shipping_cost, 0) + coalesce(o.customs_duty, 0) + coalesce(o.import_vat, 0) as landed_cost,
  coalesce(p.paid, 0) as paid_total,
  coalesce(o.invoice_total, est.amount, 0) - coalesce(p.paid, 0) as remaining_balance,
  coalesce(o.invoice_total, est.amount) as invoice_effective,
  (o.invoice_total is null and est.amount is not null) as invoice_is_estimated
from public.orders o
left join (
  select payments.order_id, sum(payments.amount) as paid
  from public.payments
  group by payments.order_id
) p on p.order_id = o.id
left join public.suppliers s on s.id = o.supplier_id
left join lateral (
  select round(o.weight_kg * s.price_per_kg_usd, 2) as amount
  where s.price_per_kg_usd is not null
    and o.weight_kg is not null and o.weight_kg > 0
    and o.status not in ('draft', 'cancelled', 'hidden')
) est on true;
