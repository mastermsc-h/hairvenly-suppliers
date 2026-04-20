-- Existing return_items.refund_amount was backfilled from returns.refund_amount
-- which comes from Shopify totalRefundedSet (includes VAT for DE stores).
-- Shopify's "Gross Sales" metric is net of tax, so we must align refunds to the
-- same basis. Divide existing values by 1.19 (German 19% VAT, default rate).
-- New syncs will store the net value directly by subtracting totalTaxSet.

update return_items
set refund_amount = round((refund_amount / 1.19)::numeric, 2)
where refund_amount is not null and refund_amount > 0;
