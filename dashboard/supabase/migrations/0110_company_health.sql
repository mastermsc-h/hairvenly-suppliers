-- Firmen-Gesundheits-Kennzahl ("Health Score")
--
-- Formel: score = lager_kg + (konten_summe_eur / 1000) - (schulden_eur / 1000)
-- Beispiel: 440 kg + 200k€ - 300k€ → 440 + 200 - 300 = 340
--
-- Lager-kg wird beim Anzeigen LIVE aus dem Stock-Sheet geholt.
-- Konten (Treatwell / Shopify / Targobank) + Schulden werden manuell gepflegt.
-- Append-only Snapshots: jede Änderung erzeugt eine neue Zeile — damit gibt
-- es automatisch eine Historie der Kennzahl über die Zeit (der beim Speichern
-- gültige kg-Stand + Score werden mit eingefroren).

CREATE TABLE company_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatwell_eur numeric NOT NULL DEFAULT 0,
  shopify_eur numeric NOT NULL DEFAULT 0,
  targobank_eur numeric NOT NULL DEFAULT 0,
  debt_eur numeric NOT NULL DEFAULT 0,
  -- beim Speichern eingefrorener Lagerstand (für Historie-Vergleich)
  stock_kg_russian numeric,
  stock_kg_uzbek numeric,
  score numeric,
  note text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX company_health_snapshots_created_idx ON company_health_snapshots(created_at DESC);

-- RLS: hochsensible Finanzdaten (Kontostände, Schulden) → NUR Admins.
-- Kein Supplier-Zugriff, auch nicht lesend.
ALTER TABLE company_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_company_health ON company_health_snapshots
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

COMMENT ON TABLE company_health_snapshots IS
  'Manuelle Eingaben (Kontostände + Schulden) für die Firmen-Gesundheits-Kennzahl. Append-only: neueste Zeile = aktuelle Werte, ältere Zeilen = Historie.';
