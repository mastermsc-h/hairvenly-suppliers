-- Salon: variant_id Spalte fuer Produkte OHNE Barcode (Schnellpicker-Flow).
-- Wenn barcode leer ist, identifiziert variant_id (Shopify GID) den pack
-- bei Rueckgabe + Shopify-Inventory-Adjust.

alter table salon_entnahmen
  add column if not exists variant_id text,
  add column if not exists inventory_item_id text;

create index if not exists salon_entnahmen_variant_open_idx
  on salon_entnahmen(variant_id) where status = 'open';

-- barcode darf jetzt leer/null sein bei Picker-Entnahmen
alter table salon_entnahmen alter column barcode drop not null;
