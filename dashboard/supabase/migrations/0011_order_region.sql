-- Add region tag for suppliers with multiple origins (e.g. Eyfel Ebru CN/TR)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS region text;

-- Recreate view to include new column
DROP VIEW IF EXISTS orders_with_totals;

CREATE VIEW orders_with_totals AS
SELECT
  o.*,
  COALESCE(o.invoice_total, 0)
    + COALESCE(o.shipping_cost, 0)
    + COALESCE(o.customs_duty, 0)
    + COALESCE(o.import_vat, 0) AS landed_cost,
  COALESCE(p.paid, 0) AS paid_total,
  COALESCE(o.invoice_total, 0) - COALESCE(p.paid, 0) AS remaining_balance
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id
) p ON p.order_id = o.id;

-- Add regions config to suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS regions text[];
UPDATE suppliers SET regions = ARRAY['CN', 'TR'] WHERE name = 'Eyfel Ebru (CN + TR)';
