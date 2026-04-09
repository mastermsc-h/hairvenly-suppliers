-- Add order_date column: the actual date of the order (chosen by user)
ALTER TABLE orders ADD COLUMN order_date date;

-- Backfill: try to parse date from label, otherwise use created_at date
UPDATE orders SET order_date = created_at::date WHERE order_date IS NULL;

-- Update the orders_with_totals view to include order_date
CREATE OR REPLACE VIEW orders_with_totals AS
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
