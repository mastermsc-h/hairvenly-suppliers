-- Seed product catalog data from existing order sheets
-- Amanda: 6 methods, China (Eyfel Ebru): 4 methods

DO $$
DECLARE
  v_amanda_id uuid;
  v_china_id  uuid;
  v_method_id uuid;
  v_length_id uuid;
BEGIN

  SELECT id INTO v_amanda_id FROM suppliers WHERE name = 'Amanda';
  SELECT id INTO v_china_id  FROM suppliers WHERE name = 'Eyfel Ebru (CN + TR)';

  -- =============================================
  -- AMANDA — Bondings 60cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_amanda_id, 'Bondings', 1) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '60cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'PEARL WHITE', 1), (v_length_id, 'RAW RUSSISCHE', 2), (v_length_id, 'CAPPUCCINO', 3),
    (v_length_id, 'SUN-KISSED', 4), (v_length_id, 'MACADAMIA', 5), (v_length_id, 'SMOKY TAUPE', 6),
    (v_length_id, 'NORVEGIAN', 7), (v_length_id, 'CARAMEL FUDGE', 8), (v_length_id, 'COOL TONED', 9),
    (v_length_id, 'BUTTER CREAM', 10), (v_length_id, 'EBONY RUSSISCHE', 11), (v_length_id, 'SHINY RUSSISCHE', 12),
    (v_length_id, 'ESPRESSO BROWN', 13), (v_length_id, 'TOFFEE', 14), (v_length_id, 'BITTER CACAO', 15),
    (v_length_id, 'DESERT', 16), (v_length_id, 'PLATIN', 17), (v_length_id, 'DUBAI', 18),
    (v_length_id, 'AUTUMN', 19), (v_length_id, 'MOCHA MELT', 20), (v_length_id, 'MACADAMIA GLOW', 21),
    (v_length_id, 'VANILA OMBRE', 22), (v_length_id, 'SHINY', 23), (v_length_id, 'CHERRY RED', 24),
    (v_length_id, 'FAWN', 25), (v_length_id, 'EBONY', 26), (v_length_id, 'RAW', 27), (v_length_id, 'BLUE', 28);

  -- =============================================
  -- AMANDA — Standard Tapes 60cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_amanda_id, 'Standard Tapes', 2) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '60cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'MACADAMIA GLOW', 1), (v_length_id, 'PEARL WHITE', 2), (v_length_id, 'BUTTERSCOTCH', 3),
    (v_length_id, 'SNOWY', 4), (v_length_id, 'BUTTER CREAM', 5), (v_length_id, 'CARAMEL FUDGE', 6),
    (v_length_id, 'ESPRESSO BROWN', 7), (v_length_id, 'TOFFEE', 8), (v_length_id, 'BITTER CACAO', 9),
    (v_length_id, 'CAPPUCCINO', 10), (v_length_id, 'BLUE', 11), (v_length_id, 'BISQUID BLOND', 12),
    (v_length_id, 'COLDNESS', 13), (v_length_id, 'RAW RUSSISCHE', 14), (v_length_id, 'COOL TONED', 15),
    (v_length_id, 'SUN-KISSED', 16), (v_length_id, 'NORVEGIAN', 17), (v_length_id, 'SMOKY TAUPE', 18),
    (v_length_id, 'EBONY RUSSISCHE', 19), (v_length_id, 'SHINY RUSSISCHE', 20),
    (v_length_id, 'LATTE BALAYAGE', 21), (v_length_id, 'DESERT', 22), (v_length_id, 'PLATIN', 23), (v_length_id, 'DUBAI', 24);

  -- =============================================
  -- AMANDA — Minitapes 60cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_amanda_id, 'Minitapes', 3) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '60cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'EBONY', 1), (v_length_id, 'CARAMEL FUDGE', 2), (v_length_id, 'BEACH BLOND', 3),
    (v_length_id, 'GLOW', 4), (v_length_id, 'SNOWY', 5), (v_length_id, 'BUTTER CREAM', 6),
    (v_length_id, 'LATTE BALAYAGE', 7), (v_length_id, 'BITTER CACAO', 8), (v_length_id, 'RAW MINI TAPE', 9),
    (v_length_id, 'MACADAMIA GLOW', 10), (v_length_id, 'PEARL WHITE', 11), (v_length_id, 'CAPPUCCINO', 12),
    (v_length_id, 'TOFFEE', 13), (v_length_id, 'ESPRESSO BROWN', 14), (v_length_id, 'NORVEGIAN', 15),
    (v_length_id, 'SUN-KISSED', 16), (v_length_id, 'COOL TONED', 17);

  -- =============================================
  -- AMANDA — Classic Weft 60cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_amanda_id, 'Classic Weft', 4) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '60cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'FROSTY', 1), (v_length_id, 'CAPPUCCINO', 2), (v_length_id, 'RAW', 3),
    (v_length_id, 'CARAMEL FUDGE', 4), (v_length_id, 'CHAMPAGNE', 5), (v_length_id, 'SUN-KISSED', 6),
    (v_length_id, 'SNOWY', 7), (v_length_id, 'SHINY', 8), (v_length_id, 'NORVEGIAN', 9),
    (v_length_id, 'BUTTER CREAM', 10), (v_length_id, 'PEARL WHITE', 11), (v_length_id, 'MACADAMIA GLOW', 12),
    (v_length_id, 'TOFFEE', 13), (v_length_id, 'BITTER CACAO', 14), (v_length_id, 'EBONY', 15),
    (v_length_id, 'LATTE BALAYAGE', 16), (v_length_id, 'DESERT', 17), (v_length_id, 'GLOW', 18), (v_length_id, 'COOL TONED', 19);

  -- =============================================
  -- AMANDA — Invisible Weft 60cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_amanda_id, 'Invisible Weft', 5) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '60cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'SUN-KISSED', 1), (v_length_id, 'BITTER CACAO', 2), (v_length_id, 'GLOW', 3),
    (v_length_id, 'PLATIN RU GLATT', 4), (v_length_id, 'PEARL WHITE', 5), (v_length_id, 'CARAMEL FUDGE', 6),
    (v_length_id, 'SNOWY', 7), (v_length_id, 'CAPPUCCINO', 8), (v_length_id, 'BUTTER CREAM', 9),
    (v_length_id, 'NORVEGIAN', 10), (v_length_id, 'RAW', 11), (v_length_id, 'MACADAMIA GLOW', 12);

  -- =============================================
  -- AMANDA — Clip-ins (3 lengths)
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_amanda_id, 'Clip-ins', 6) RETURNING id INTO v_method_id;

  -- 100g
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '100g', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'LATTE BALAYAGE', 1), (v_length_id, 'DESERT', 2), (v_length_id, 'PLATIN', 3),
    (v_length_id, 'BITTER CACAO', 4), (v_length_id, 'DUBAI', 5), (v_length_id, 'AUTUMN', 6),
    (v_length_id, 'MOCHA MELT', 7), (v_length_id, 'BUTTER CREAM', 8), (v_length_id, 'MACADAMIA GLOW', 9),
    (v_length_id, 'VANILA OMBRE', 10), (v_length_id, 'SHINY', 11), (v_length_id, 'PEARL WHITE', 12),
    (v_length_id, 'CHERRY RED', 13), (v_length_id, 'FAWN', 14), (v_length_id, 'CARAMEL FUDGE', 15),
    (v_length_id, 'EBONY', 16), (v_length_id, 'RAW', 17), (v_length_id, 'CAPPUCCINO', 18),
    (v_length_id, 'SNOWY', 19), (v_length_id, 'TOFFEE', 20), (v_length_id, 'SUN-KISSED', 21), (v_length_id, 'NORVEGIAN', 22);

  -- 150g
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '150g', 'g', 2) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'GLOW', 1), (v_length_id, 'VANILA OMBRE', 2), (v_length_id, 'PEARL WHITE', 3),
    (v_length_id, 'BITTER CACAO', 4), (v_length_id, 'CARAMEL FUDGE', 5), (v_length_id, 'BUTTER CREAM', 6),
    (v_length_id, 'DESERT', 7), (v_length_id, 'RAW', 8), (v_length_id, 'MACADAMIA GLOW', 9),
    (v_length_id, 'SNOWY', 10), (v_length_id, 'LATTE BALAYAGE', 11);

  -- 225g
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '225g', 'g', 3) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'RAW', 1), (v_length_id, 'BITTER CACAO', 2), (v_length_id, 'SMOKY BROWN', 3),
    (v_length_id, 'PEARL WHITE', 4), (v_length_id, 'CARAMEL FUDGE', 5), (v_length_id, 'DESERT', 6),
    (v_length_id, 'SNOWY', 7), (v_length_id, 'MACADAMIA GLOW', 8);

  -- =============================================
  -- EYFEL EBRU (CN + TR) — Tapes (4 lengths)
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_china_id, 'Tapes', 1) RETURNING id INTO v_method_id;

  -- 45cm
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '45cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'Soft Blond Balayage', 1), (v_length_id, '99J', 2), (v_length_id, 'Mochamelt', 3),
    (v_length_id, '5MSilver', 4), (v_length_id, '3A', 5), (v_length_id, 'Norwegian', 6),
    (v_length_id, '1A', 7), (v_length_id, '27', 8), (v_length_id, 'Silver', 9),
    (v_length_id, 'Natural', 10), (v_length_id, '2E', 11), (v_length_id, 'Bergen blond', 12),
    (v_length_id, 'Pearl White', 13), (v_length_id, 'Dubai', 14);

  -- 55cm
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '55cm', 'g', 2) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, '2E', 1), (v_length_id, 'Dubai', 2), (v_length_id, 'Natural', 3),
    (v_length_id, 'Silver', 4), (v_length_id, '27', 5), (v_length_id, 'Norwegian', 6),
    (v_length_id, '1A', 7), (v_length_id, '99J', 8), (v_length_id, 'Soft Blond Balayage', 9),
    (v_length_id, '5MSilver', 10), (v_length_id, '3A', 11), (v_length_id, 'Mochamelt', 12),
    (v_length_id, 'Bergen blond', 13), (v_length_id, 'Pearl White', 14);

  -- 65cm
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '65cm', 'g', 3) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'Natural', 1), (v_length_id, '27', 2), (v_length_id, 'Silver', 3),
    (v_length_id, 'Viking blond', 4), (v_length_id, '2E', 5), (v_length_id, '1A', 6),
    (v_length_id, 'Soft Blond Balayage', 7), (v_length_id, '99J', 8), (v_length_id, '5MSilver', 9),
    (v_length_id, '3A', 10), (v_length_id, 'Norwegian', 11), (v_length_id, 'Dubai', 12),
    (v_length_id, 'Bergen blond', 13), (v_length_id, 'Mochamelt', 14), (v_length_id, 'Pearl White', 15);

  -- 85cm
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '85cm', 'g', 4) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, '1A', 1), (v_length_id, '2E', 2), (v_length_id, 'Natural', 3),
    (v_length_id, '4A', 4), (v_length_id, '5A', 5), (v_length_id, 'Bergen blond', 6),
    (v_length_id, 'Silver', 7), (v_length_id, 'Dubai', 8), (v_length_id, '27', 9),
    (v_length_id, 'Norwegian', 10), (v_length_id, '99J', 11), (v_length_id, 'Pearl White', 12),
    (v_length_id, 'Soft Blond Balayage', 13), (v_length_id, '3A', 14), (v_length_id, '5MSilver', 15);

  -- =============================================
  -- EYFEL EBRU (CN + TR) — Bondings (2 lengths)
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_china_id, 'Bondings', 2) RETURNING id INTO v_method_id;

  -- 65cm
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '65cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'Bergen blond', 1), (v_length_id, '2T14A', 2), (v_length_id, '1A', 3),
    (v_length_id, '5M/Silver', 4), (v_length_id, '10', 5), (v_length_id, 'Lila', 6),
    (v_length_id, '5T18A', 7), (v_length_id, '2E', 8), (v_length_id, 'Soft blond balayage', 9),
    (v_length_id, '27', 10), (v_length_id, '4/27T24', 11), (v_length_id, '99J', 12),
    (v_length_id, 'Pearl White', 13), (v_length_id, '3TPearl White', 14), (v_length_id, 'Natural', 15),
    (v_length_id, '3A', 16), (v_length_id, '5P18A', 17), (v_length_id, '3T8A', 18),
    (v_length_id, '24A', 19), (v_length_id, '60', 20), (v_length_id, 'Norwegian', 21), (v_length_id, '4', 22);

  -- 85cm
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '85cm', 'g', 2) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'Pearl White', 1), (v_length_id, '3TPearl White', 2), (v_length_id, '1A', 3),
    (v_length_id, '2E', 4), (v_length_id, 'Natural', 5), (v_length_id, 'Bergen blond', 6),
    (v_length_id, 'Silver', 7), (v_length_id, '27', 8), (v_length_id, '5A', 9), (v_length_id, 'Norwegian', 10);

  -- =============================================
  -- EYFEL EBRU (CN + TR) — Classic Tressen 65cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_china_id, 'Classic Tressen', 3) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '65cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'Natural', 1), (v_length_id, 'Soft Blond Balayage', 2), (v_length_id, '2', 3),
    (v_length_id, '5P18A', 4), (v_length_id, '3T8A', 5), (v_length_id, '24A', 6),
    (v_length_id, '3A', 7), (v_length_id, '2E', 8), (v_length_id, '60', 9),
    (v_length_id, 'Norwegian', 10), (v_length_id, '4', 11), (v_length_id, 'Mochamelt', 12),
    (v_length_id, 'Viking Blond', 13), (v_length_id, '1A', 14), (v_length_id, '27', 15),
    (v_length_id, 'Pearl White', 16), (v_length_id, 'Bergen blond', 17), (v_length_id, 'Silver', 18),
    (v_length_id, '99J', 19), (v_length_id, 'Dubai', 20);

  -- =============================================
  -- EYFEL EBRU (CN + TR) — Genius Weft 65cm
  -- =============================================
  INSERT INTO product_methods (supplier_id, name, sort_order) VALUES (v_china_id, 'Genius Weft', 4) RETURNING id INTO v_method_id;
  INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '65cm', 'g', 1) RETURNING id INTO v_length_id;
  INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
    (v_length_id, 'Soft Blond Balayage', 1), (v_length_id, 'Mochamelt', 2), (v_length_id, 'Viking Blond', 3),
    (v_length_id, 'Norwegian', 4), (v_length_id, '5P18A', 5), (v_length_id, '5A', 6),
    (v_length_id, 'Bergen Blond', 7), (v_length_id, '2E', 8), (v_length_id, '1A', 9),
    (v_length_id, 'Natural', 10), (v_length_id, '3A', 11), (v_length_id, 'Pearl White', 12),
    (v_length_id, '27', 13), (v_length_id, 'Silver', 14), (v_length_id, '99J', 15), (v_length_id, 'Dubai', 16);

END $$;
