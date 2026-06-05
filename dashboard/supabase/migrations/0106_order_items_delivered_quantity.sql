-- Tatsächlich gelieferte Menge pro Bestellposition.
--
-- order_items.quantity = was BESTELLT wurde (immutabel, historisch)
-- order_items.delivered_quantity = was TATSÄCHLICH geliefert wurde
--
-- Wenn delivered_quantity gesetzt ist und von quantity abweicht, hat der
-- Lieferant mehr (oder weniger) geschickt. Shopify-Push nutzt
-- delivered_quantity wenn gesetzt — damit Mehrlieferungen auch im
-- Shopify-Bestand ankommen.
--
-- Wird automatisch gesetzt vom Lieferschein-Check (shipment_only-Modus)
-- wenn Überschuss erkannt wird. Kann nachträglich manuell in der UI
-- editiert werden.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS delivered_quantity integer;

COMMENT ON COLUMN order_items.delivered_quantity IS
  'Tatsächlich gelieferte Menge (Gramm) — kann von der bestellten quantity abweichen wenn der Lieferant mehr/weniger geschickt hat. NULL = bisher keine Lieferung erfasst oder identisch mit quantity. Shopify-Push: delivered_quantity || quantity.';
