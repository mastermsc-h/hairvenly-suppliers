-- Verknüpfung Teillieferung ↔ Wareneingang
-- Damit eine automatisch erzeugte Teillieferung weiß, aus welcher physischen
-- Sendung sie stammt. In der UI der Bestellung kann man dann zum Wareneingang
-- springen.

ALTER TABLE order_shipments
  ADD COLUMN IF NOT EXISTS inbound_delivery_id uuid
    REFERENCES inbound_deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_shipments_inbound_idx ON order_shipments(inbound_delivery_id);

COMMENT ON COLUMN order_shipments.inbound_delivery_id IS
  'Wenn diese Teillieferung aus einem Wareneingang (cross-order shipment) erzeugt wurde, verweist sie hier zurück. NULL = manuell angelegte Teillieferung.';
