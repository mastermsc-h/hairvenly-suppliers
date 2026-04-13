-- Add updated_at to product_colors for tracking last modification
ALTER TABLE product_colors ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Auto-update on changes
CREATE OR REPLACE FUNCTION touch_color_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS color_touch_updated ON product_colors;
CREATE TRIGGER color_touch_updated
  BEFORE UPDATE ON product_colors
  FOR EACH ROW EXECUTE FUNCTION touch_color_updated_at();
