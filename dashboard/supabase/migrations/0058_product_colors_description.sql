-- Farb-Beschreibung pro Farbe (für Bot-Suche / Color-Matching)
-- Bot kann z.B. "braun" suchen und findet RAW über die Beschreibung
-- ("warmes Mittelbraun"), auch wenn der Produktname kein "braun" enthält.
alter table product_colors
  add column if not exists description text;

comment on column product_colors.description is
  'Freitext-Beschreibung des Farbtons (z.B. "warmes Mittelbraun, leichte Karamell-Töne"). Wird im Chatbot get_available_colors als Suchfeld verwendet.';
