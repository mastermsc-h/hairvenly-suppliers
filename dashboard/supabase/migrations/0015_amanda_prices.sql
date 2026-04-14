-- Amanda (Russisch) Price List
-- Prices from Amanda's official price list + clip-in prices derived from invoices
-- Categories: Dark color, Blonde, Piano, Ombre balayage
-- All products 60cm

DO $$
DECLARE
  v_amanda_id uuid;
  v_list_id uuid;
  v_lg_60 uuid;
  v_cc_dark uuid;
  v_cc_blonde uuid;
  v_cc_piano uuid;
  v_cc_ombre uuid;
BEGIN
  SELECT id INTO v_amanda_id FROM suppliers WHERE name = 'Amanda';

  -- Create price list
  INSERT INTO supplier_price_lists (supplier_id, name, methods) VALUES (
    v_amanda_id,
    'Amanda Russisch Preise',
    '[
      {"name": "Tape", "surcharge": 0},
      {"name": "Mini Tape", "surcharge": 0},
      {"name": "Bondings", "surcharge": 0},
      {"name": "Classic Tressen", "surcharge": 0},
      {"name": "Genius Weft", "surcharge": 0},
      {"name": "Invisible Tressen", "surcharge": 0},
      {"name": "Clip-in 100g", "surcharge": 0},
      {"name": "Clip-in 150g", "surcharge": 0},
      {"name": "Clip-in 225g", "surcharge": 0}
    ]'::jsonb
  ) RETURNING id INTO v_list_id;

  -- One length group: 60 CM (all Amanda products)
  -- VK from Google Sheet: Tapes/Bondings = €2900 brutto, Tressen = €2500, Invisible Tressen = €3900
  INSERT INTO price_length_groups (price_list_id, label, length_values, selling_prices, sort_order) VALUES (
    v_list_id, '60 CM', '{"60cm","100g","150g","225g"}',
    '{
      "Tape":              {"brutto": 290, "netto": 243.70, "gewerbe": 210},
      "Mini Tape":         {"brutto": 290, "netto": 243.70, "gewerbe": 210},
      "Bondings":          {"brutto": 290, "netto": 243.70, "gewerbe": 210},
      "Classic Tressen":   {"brutto": 250, "netto": 210.08, "gewerbe": 169.70},
      "Genius Weft":       {"brutto": 250, "netto": 210.08, "gewerbe": 169.70},
      "Invisible Tressen": {"brutto": 390, "netto": 327.73, "gewerbe": 294.10},
      "Clip-in 100g": {"brutto": 159, "netto": 133.61, "gewerbe": 0},
      "Clip-in 150g": {"brutto": 225, "netto": 189.08, "gewerbe": 0},
      "Clip-in 225g": {"brutto": 330, "netto": 277.31, "gewerbe": 0}
    }'::jsonb,
    1
  ) RETURNING id INTO v_lg_60;

  -- Color categories
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'Dark color', 1) RETURNING id INTO v_cc_dark;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'Blonde', 2) RETURNING id INTO v_cc_blonde;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'Piano', 3) RETURNING id INTO v_cc_piano;
  INSERT INTO price_color_categories (price_list_id, name, sort_order) VALUES (v_list_id, 'Ombre balayage', 4) RETURNING id INTO v_cc_ombre;

  -- =============================================
  -- PRICE ENTRIES: 60 CM — all prices per KG ($)
  -- Tape/Mini Tape/Bondings: price list × 10 (100g → 1kg)
  -- Wefts (Classic/Genius/Invisible): price list × 20 (50g → 1kg)
  -- Clip-ins: per pack (not per kg, VK is also per pack)
  -- =============================================

  -- All prices per 100g (except Clip-ins = per pack)
  -- Tape/Bondings: already per 100g from price list
  -- Wefts (50g): ×2 to get per 100g

  -- Dark color
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES (
    v_lg_60, v_cc_dark,
    '{
      "Tape": 114.81, "Mini Tape": 114.81, "Bondings": 109.20,
      "Classic Tressen": 107.46, "Genius Weft": 115.56, "Invisible Tressen": 150.84,
      "Clip-in 100g": 58.66, "Clip-in 150g": 88.03, "Clip-in 225g": 132.00
    }'
  );

  -- Blonde
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES (
    v_lg_60, v_cc_blonde,
    '{
      "Tape": 125.58, "Mini Tape": 125.58, "Bondings": 119.97,
      "Classic Tressen": 118.22, "Genius Weft": 126.52, "Invisible Tressen": 174.04,
      "Clip-in 100g": 68.86, "Clip-in 150g": 103.29, "Clip-in 225g": 154.93
    }'
  );

  -- Piano
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES (
    v_lg_60, v_cc_piano,
    '{
      "Tape": 126.89, "Mini Tape": 126.89, "Bondings": 121.28,
      "Classic Tressen": 122.26, "Genius Weft": 128.76, "Invisible Tressen": 175.00,
      "Clip-in 100g": 70.36, "Clip-in 150g": 105.79, "Clip-in 225g": 158.31
    }'
  );

  -- Ombre balayage
  INSERT INTO price_entries (length_group_id, color_category_id, prices) VALUES (
    v_lg_60, v_cc_ombre,
    '{
      "Tape": 129.61, "Mini Tape": 129.61, "Bondings": 124.00,
      "Classic Tressen": 122.26, "Genius Weft": 130.64, "Invisible Tressen": 177.98,
      "Clip-in 100g": 71.86, "Clip-in 150g": 107.79, "Clip-in 225g": 161.68
    }'
  );

  -- =============================================
  -- AUTO-MAP: Amanda catalog colors → price categories
  -- (verified against invoice prices)
  -- =============================================

  -- Dark color → Ebony, Raw, Espresso Brown, Bitter Cacao, Autumn + russische variants
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_dark, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_amanda_id
    AND pc.name_hairvenly IN (
      'EBONY', 'RAW', 'RAW RUSSISCHE', 'RAW MINI TAPE', 'EBONY RUSSISCHE',
      'ESPRESSO BROWN', 'BITTER CACAO', 'SMOKY BROWN', 'AUTUMN'
    )
  ON CONFLICT (product_color_id) DO NOTHING;

  -- Blonde → Pearl White, Cappuccino, Norwegian, Snowy, Shiny, Fawn, Platin, etc.
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_blonde, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_amanda_id
    AND pc.name_hairvenly IN (
      'PEARL WHITE', 'CAPPUCCINO', 'NORVEGIAN', 'SMOKY TAUPE', 'SHINY',
      'SHINY RUSSISCHE', 'FAWN', 'PLATIN', 'PLATIN RU GLATT', 'BLUE',
      'SNOWY', 'BISQUID BLOND', 'COLDNESS', 'CHERRY RED', 'CHAMPAGNE',
      'BEACH BLOND', 'GLOW', 'FROSTY'
    )
  ON CONFLICT (product_color_id) DO NOTHING;

  -- Piano → Macadamia Glow, Butter Cream, Toffee, Mocha Melt
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_piano, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_amanda_id
    AND pc.name_hairvenly IN (
      'MACADAMIA GLOW', 'MACADAMIA', 'BUTTER CREAM', 'TOFFEE', 'MOCHA MELT'
    )
  ON CONFLICT (product_color_id) DO NOTHING;

  -- Ombre balayage → Latte Balayage, Caramel Fudge, Cool Toned, Dubai, Desert, etc.
  INSERT INTO price_product_mappings (color_category_id, product_color_id)
  SELECT v_cc_ombre, pc.id
  FROM product_colors pc
  JOIN product_lengths pl ON pc.length_id = pl.id
  JOIN product_methods pm ON pl.method_id = pm.id
  WHERE pm.supplier_id = v_amanda_id
    AND pc.name_hairvenly IN (
      'LATTE BALAYAGE', 'CARAMEL FUDGE', 'BUTTERSCOTCH', 'COOL TONED',
      'SUN-KISSED', 'VANILA OMBRE', 'DESERT', 'DUBAI'
    )
  ON CONFLICT (product_color_id) DO NOTHING;

END $$;
