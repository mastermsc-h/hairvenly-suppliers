-- Add missing products to Amanda catalog that appear in order suggestions

DO $$
DECLARE
  v_amanda_id uuid;
  v_method_id uuid;
  v_length_id uuid;
BEGIN

  SELECT id INTO v_amanda_id FROM suppliers WHERE name = 'Amanda';

  -- Add missing Standard Tapes colors
  SELECT pl.id INTO v_length_id
  FROM product_lengths pl
  JOIN product_methods pm ON pm.id = pl.method_id
  WHERE pm.supplier_id = v_amanda_id AND pm.name = 'Standard Tapes' AND pl.value = '60cm';

  IF v_length_id IS NOT NULL THEN
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'SMOKY BROWN', 30),
      (v_length_id, 'DIRTY BLOND', 31),
      (v_length_id, 'LATTE BROWN', 32),
      (v_length_id, 'ASH MELT', 33),
      (v_length_id, 'BERRY VELVET', 34),
      (v_length_id, 'PINK', 35)
    ON CONFLICT (length_id, name_hairvenly) DO NOTHING;
  END IF;

  -- Add missing Minitapes colors
  SELECT pl.id INTO v_length_id
  FROM product_lengths pl
  JOIN product_methods pm ON pm.id = pl.method_id
  WHERE pm.supplier_id = v_amanda_id AND pm.name = 'Minitapes' AND pl.value = '60cm';

  IF v_length_id IS NOT NULL THEN
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'BISQUID BLOND', 20),
      (v_length_id, 'HONEY', 21),
      (v_length_id, 'CHAMPAGNE', 22),
      (v_length_id, 'PLATIN', 23)
    ON CONFLICT (length_id, name_hairvenly) DO NOTHING;
  END IF;

  -- Add missing Bondings colors
  SELECT pl.id INTO v_length_id
  FROM product_lengths pl
  JOIN product_methods pm ON pm.id = pl.method_id
  WHERE pm.supplier_id = v_amanda_id AND pm.name = 'Bondings' AND pl.value = '60cm';

  IF v_length_id IS NOT NULL THEN
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'ASH MELT', 30),
      (v_length_id, 'VANILLA MOCHA', 31),
      (v_length_id, 'LATTE BROWN', 32)
    ON CONFLICT (length_id, name_hairvenly) DO NOTHING;
  END IF;

  -- Add missing Classic Weft colors
  SELECT pl.id INTO v_length_id
  FROM product_lengths pl
  JOIN product_methods pm ON pm.id = pl.method_id
  WHERE pm.supplier_id = v_amanda_id AND pm.name = 'Classic Weft' AND pl.value = '60cm';

  IF v_length_id IS NOT NULL THEN
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'LATTE BROWN', 25),
      (v_length_id, 'BEACH BLOND', 26),
      (v_length_id, 'MACADAMIA', 27),
      (v_length_id, 'ASH MELT', 28),
      (v_length_id, 'VANILLA MOCHA', 29),
      (v_length_id, 'SMOKY BROWN', 30)
    ON CONFLICT (length_id, name_hairvenly) DO NOTHING;
  END IF;

  -- Add missing Invisible Weft colors
  SELECT pl.id INTO v_length_id
  FROM product_lengths pl
  JOIN product_methods pm ON pm.id = pl.method_id
  WHERE pm.supplier_id = v_amanda_id AND pm.name = 'Invisible Weft' AND pl.value = '60cm';

  IF v_length_id IS NOT NULL THEN
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'LATTE BROWN', 15),
      (v_length_id, 'LATTE BALAYAGE', 16),
      (v_length_id, 'ASH MELT', 17),
      (v_length_id, 'BISQUID BLONDE', 18),
      (v_length_id, 'VANILLA MOCHA', 19),
      (v_length_id, 'BEACH BLOND', 20),
      (v_length_id, 'SMOKY BROWN', 21),
      (v_length_id, 'COOL TONED', 22),
      (v_length_id, 'SMOKY TAUPE', 23),
      (v_length_id, 'DIRTY BLONDE', 24),
      (v_length_id, 'ESPRESSO BROWN', 25),
      (v_length_id, 'COLDNESS', 26),
      (v_length_id, 'MOCHA MELT', 27),
      (v_length_id, 'HONEY', 28),
      (v_length_id, 'AUTUMN', 29),
      (v_length_id, 'SNOWY', 30),
      (v_length_id, 'PLATIN', 31),
      (v_length_id, 'SUN-KISSED', 32)
    ON CONFLICT (length_id, name_hairvenly) DO NOTHING;
  END IF;

  -- Add Genius Weft method for Amanda (was missing!)
  INSERT INTO product_methods (supplier_id, name, sort_order)
  VALUES (v_amanda_id, 'Genius Weft', 7)
  ON CONFLICT (supplier_id, name) DO NOTHING
  RETURNING id INTO v_method_id;

  IF v_method_id IS NOT NULL THEN
    INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, '60cm', 'g', 1) RETURNING id INTO v_length_id;
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'LATTE BALAYAGE', 1),
      (v_length_id, 'BUTTER CREAM', 2),
      (v_length_id, 'BISQUID BLOND', 3),
      (v_length_id, 'BEACH BLOND', 4),
      (v_length_id, 'MACADAMIA GLOW', 5),
      (v_length_id, 'RAW', 6),
      (v_length_id, 'PEARL WHITE', 7),
      (v_length_id, 'CARAMEL FUDGE', 8),
      (v_length_id, 'EBONY', 9),
      (v_length_id, 'ESPRESSO BROWN', 10),
      (v_length_id, 'SMOKY TAUPE', 11),
      (v_length_id, 'NORVEGIAN', 12);
  END IF;

  -- Add Ponytail method for Amanda
  INSERT INTO product_methods (supplier_id, name, sort_order)
  VALUES (v_amanda_id, 'Ponytail', 8)
  ON CONFLICT (supplier_id, name) DO NOTHING
  RETURNING id INTO v_method_id;

  IF v_method_id IS NOT NULL THEN
    INSERT INTO product_lengths (method_id, value, unit, sort_order) VALUES (v_method_id, 'one size', 'g', 1) RETURNING id INTO v_length_id;
    INSERT INTO product_colors (length_id, name_hairvenly, sort_order) VALUES
      (v_length_id, 'NATURAL', 1),
      (v_length_id, 'RAW', 2),
      (v_length_id, 'PEARL WHITE', 3),
      (v_length_id, 'EBONY', 4),
      (v_length_id, 'CARAMEL FUDGE', 5);
  END IF;

END $$;
