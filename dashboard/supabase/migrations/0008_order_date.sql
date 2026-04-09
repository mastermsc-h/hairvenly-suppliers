-- Add order_date column: the actual date of the order (chosen by user)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_date date;

-- Backfill: use created_at date for existing orders
UPDATE orders SET order_date = created_at::date WHERE order_date IS NULL;

-- Must drop + recreate view because new column in o.* shifts column positions
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
