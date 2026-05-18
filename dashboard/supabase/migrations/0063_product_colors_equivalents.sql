-- Cross-Linien Farb-Entsprechungen
-- z.B. Russisch LATTE BROWN → "5A, 6A" (passende usbekische Codes)
--      Usbekisch 5A → "LATTE BROWN, AUTUMN, FAWN" (passende russische Farben)
-- Bot nutzt das primär bei Code-Anfragen, statt fuzzy description-search.
alter table product_colors
  add column if not exists equivalent_in_other_line text;

comment on column product_colors.equivalent_in_other_line is
  'Komma-getrennte Farbnamen aus der ANDEREN Lieferanten-Linie die als Match passen. Bei russischen Farben: usbekische Codes (z.B. "5A, 6A"). Bei usbekischen Codes: russische Farbnamen (z.B. "LATTE BROWN, AUTUMN, FAWN").';
