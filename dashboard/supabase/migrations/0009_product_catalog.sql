-- Product catalog: Methods → Lengths → Colors (per supplier)
-- Plus order_items for wizard-created orders

-- Methoden pro Lieferant (Bondings, Standard Tapes, Clip-ins etc.)
CREATE TABLE product_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(supplier_id, name)
);
CREATE INDEX product_methods_supplier_idx ON product_methods(supplier_id);

-- Längen/Varianten pro Methode (60cm, 45cm, 100g etc.)
CREATE TABLE product_lengths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_id uuid NOT NULL REFERENCES product_methods(id) ON DELETE CASCADE,
  value text NOT NULL,
  unit text NOT NULL DEFAULT 'g',
  sort_order int DEFAULT 0,
  UNIQUE(method_id, value)
);
CREATE INDEX product_lengths_method_idx ON product_lengths(method_id);

-- Farben/Produkte pro Länge mit 3-fach Name-Mapping
CREATE TABLE product_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  length_id uuid NOT NULL REFERENCES product_lengths(id) ON DELETE CASCADE,
  name_hairvenly text NOT NULL,
  name_supplier text,
  name_shopify text,
  sort_order int DEFAULT 0,
  UNIQUE(length_id, name_hairvenly)
);
CREATE INDEX product_colors_length_idx ON product_colors(length_id);

-- Bestellpositionen (line items einer Wizard-Bestellung)
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  color_id uuid REFERENCES product_colors(id) ON DELETE SET NULL,
  method_name text NOT NULL,
  length_value text NOT NULL,
  color_name text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'g',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX order_items_order_idx ON order_items(order_id);

-- ===== RLS =====
ALTER TABLE product_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_lengths ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Admins: full access on all catalog tables
CREATE POLICY admin_all_methods ON product_methods FOR ALL USING (is_admin());
CREATE POLICY admin_all_lengths ON product_lengths FOR ALL USING (is_admin());
CREATE POLICY admin_all_colors  ON product_colors  FOR ALL USING (is_admin());
CREATE POLICY admin_all_items   ON order_items     FOR ALL USING (is_admin());

-- Everyone can read catalog (needed for wizard)
CREATE POLICY anyone_read_methods ON product_methods FOR SELECT USING (true);
CREATE POLICY anyone_read_lengths ON product_lengths FOR SELECT USING (true);
CREATE POLICY anyone_read_colors  ON product_colors  FOR SELECT USING (true);

-- Suppliers can read their own order items
CREATE POLICY supplier_read_items ON order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items.order_id
      AND o.supplier_id = current_supplier_id()
  )
);
