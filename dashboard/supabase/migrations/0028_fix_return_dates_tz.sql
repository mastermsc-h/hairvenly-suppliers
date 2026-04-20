-- Fix initiated_at for Shopify-imported returns where UTC-based date
-- was 1 day earlier than Europe/Berlin date. Uses resolved_at (which is a
-- proper timestamp) to compute the correct Berlin date.
--
-- This does NOT touch returns without shopify_refund_id (manual/sheet entries
-- should keep their user-entered date).

update returns
set initiated_at = (resolved_at at time zone 'Europe/Berlin')::date
where shopify_refund_id is not null
  and resolved_at is not null
  and initiated_at <> (resolved_at at time zone 'Europe/Berlin')::date;
