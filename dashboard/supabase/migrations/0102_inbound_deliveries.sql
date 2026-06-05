-- Inbound deliveries ("Wareneingänge")
--
-- Eine physische Sendung eines Lieferanten, die N Bestellungen abdeckt.
-- Im Gegensatz zu order_shipments NICHT an EINE Bestellung gebunden — sie
-- enthält delivery_items (was wirklich physisch kam) und wird in Phase 2
-- per Auto-Match gegen offene Bestellpositionen zugeordnet.

CREATE TABLE inbound_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  label text,
  tracking_number text,
  tracking_url text,
  eta date,
  shipped_at date,
  arrived_at date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX inbound_deliveries_supplier_idx ON inbound_deliveries(supplier_id);
CREATE INDEX inbound_deliveries_eta_idx ON inbound_deliveries(eta);

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION touch_inbound_delivery() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inbound_deliveries_touch ON inbound_deliveries;
CREATE TRIGGER inbound_deliveries_touch
  BEFORE UPDATE ON inbound_deliveries
  FOR EACH ROW EXECUTE FUNCTION touch_inbound_delivery();

CREATE TABLE inbound_delivery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_delivery_id uuid NOT NULL REFERENCES inbound_deliveries(id) ON DELETE CASCADE,
  color_id uuid REFERENCES product_colors(id) ON DELETE SET NULL,
  method_name text NOT NULL,
  length_value text NOT NULL,
  color_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'g',
  notes text,
  -- In Phase 2 setzbar: zur welcher Bestellung wurde diese Position zugeordnet
  -- (mehrere Zuordnungen pro Item möglich → eigene Tabelle in Phase 2).
  -- Für Phase 1 nur das physische "was kam an".
  created_at timestamptz DEFAULT now()
);

CREATE INDEX inbound_delivery_items_delivery_idx ON inbound_delivery_items(inbound_delivery_id);
CREATE INDEX inbound_delivery_items_color_idx ON inbound_delivery_items(color_id);

-- Lieferschein-Dokument: documents-Tabelle bekommt FK zu inbound_delivery
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS inbound_delivery_id uuid REFERENCES inbound_deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_inbound_delivery_idx ON documents(inbound_delivery_id);

-- RLS
ALTER TABLE inbound_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_delivery_items ENABLE ROW LEVEL SECURITY;

-- inbound_deliveries
CREATE POLICY admin_all_inbound_deliveries ON inbound_deliveries
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY supplier_read_own_inbound ON inbound_deliveries
  FOR SELECT USING (supplier_id = current_supplier_id());

CREATE POLICY supplier_insert_own_inbound ON inbound_deliveries
  FOR INSERT WITH CHECK (supplier_id = current_supplier_id());

CREATE POLICY supplier_update_own_inbound ON inbound_deliveries
  FOR UPDATE USING (supplier_id = current_supplier_id())
              WITH CHECK (supplier_id = current_supplier_id());

CREATE POLICY supplier_delete_own_inbound ON inbound_deliveries
  FOR DELETE USING (supplier_id = current_supplier_id());

-- inbound_delivery_items: vererbt vom parent
CREATE POLICY admin_all_inbound_items ON inbound_delivery_items
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY supplier_read_own_inbound_items ON inbound_delivery_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM inbound_deliveries d
    WHERE d.id = inbound_delivery_items.inbound_delivery_id
      AND d.supplier_id = current_supplier_id()
  ));

CREATE POLICY supplier_modify_own_inbound_items ON inbound_delivery_items
  FOR ALL USING (EXISTS (
    SELECT 1 FROM inbound_deliveries d
    WHERE d.id = inbound_delivery_items.inbound_delivery_id
      AND d.supplier_id = current_supplier_id()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM inbound_deliveries d
    WHERE d.id = inbound_delivery_items.inbound_delivery_id
      AND d.supplier_id = current_supplier_id()
  ));

COMMENT ON TABLE inbound_deliveries IS
  'Physische Sendungen eines Lieferanten (Wareneingänge). Decken N Bestellungen ab. Phase 1: rein deskriptiv. Phase 2: Auto-Match gegen offene Bestellpositionen.';
COMMENT ON TABLE inbound_delivery_items IS
  'Was physisch in der Sendung enthalten war (laut Lieferschein). Zuordnung zu Bestellungen folgt in Phase 2.';
