-- Stabile Verknüpfung Katalog-Farbe → Shopify-Produkt (per ID statt Titel).
--
-- Problem (22.10.2026): Shopify-Titel wurden 2026 mehrfach umbenannt; 597 von
-- 631 name_shopify-Werten trafen keinen aktuellen Titel mehr → Namens-Lookups
-- (Positions-ETA, "Teillieferung angekommen", Chatbot-Lagerstatus) liefen ins
-- Leere. Die Produkt-ID ändert sich bei Umbenennungen nie.
--
-- name_shopify bleibt als Fallback bestehen und wird vom Sync auf den
-- aktuellen Titel gezogen (lib/shopify-product-link.ts, Cron /api/cron/refresh).

ALTER TABLE product_colors
  ADD COLUMN IF NOT EXISTS shopify_product_id  text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id  text,
  ADD COLUMN IF NOT EXISTS shopify_title       text,
  ADD COLUMN IF NOT EXISTS shopify_handle      text,
  ADD COLUMN IF NOT EXISTS shopify_link_source text,
  ADD COLUMN IF NOT EXISTS shopify_synced_at   timestamptz;

ALTER TABLE product_colors
  DROP CONSTRAINT IF EXISTS product_colors_shopify_link_source_chk;
ALTER TABLE product_colors
  ADD CONSTRAINT product_colors_shopify_link_source_chk
  CHECK (shopify_link_source IS NULL OR shopify_link_source IN ('handle', 'match', 'manual'));

CREATE INDEX IF NOT EXISTS product_colors_shopify_product_idx
  ON product_colors(shopify_product_id);

COMMENT ON COLUMN product_colors.shopify_product_id IS
  'Shopify Product GID (gid://shopify/Product/…). Stabiler Schlüssel — ändert sich bei Umbenennung nicht.';
COMMENT ON COLUMN product_colors.shopify_variant_id IS
  'Shopify Variant GID, nur bei Mehr-Varianten-Produkten (Clip-ins 100g/150g/225g).';
COMMENT ON COLUMN product_colors.shopify_title IS
  'Aktueller Shopify-Titel laut letztem Sync.';
COMMENT ON COLUMN product_colors.shopify_link_source IS
  'Wie die ID zugeordnet wurde: handle (aus shopify_url), match (Collection + Farb-Token), manual. manual wird vom Sync nie überschrieben.';

-- Titel-Historie: jeder je gesehene Titel pro Produkt. Sheets (Topseller,
-- Dashboard) hinken Shopify hinterher — über die Historie lösen auch ältere
-- Titel zur richtigen Produkt-ID auf.
CREATE TABLE IF NOT EXISTS shopify_product_titles (
  product_id    text NOT NULL,
  title         text NOT NULL,
  title_norm    text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL DEFAULT 'shopify', -- shopify = Live-Titel, catalog = alter name_shopify
  PRIMARY KEY (product_id, title_norm)
);
CREATE INDEX IF NOT EXISTS shopify_product_titles_norm_idx
  ON shopify_product_titles(title_norm);

ALTER TABLE shopify_product_titles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_shopify_product_titles ON shopify_product_titles;
CREATE POLICY admin_all_shopify_product_titles ON shopify_product_titles
  FOR ALL USING (is_admin());
