-- Track ob eine Bestellung nach manueller Bearbeitung re-export
-- (Sheet + PDF) braucht. Wird von order-edit-actions auf true gesetzt
-- und bei erfolgreicher Re-Synchronisation wieder auf false geclear-t.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_resync boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN orders.pending_resync IS
  'true wenn order_items nach letztem Sheet/PDF-Export geändert wurden — UI zeigt dann Resync-Banner';
